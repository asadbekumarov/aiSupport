// src/bot.js – grammY Telegram bot
// Handles owner-only interactions: draft approval, rewrite, feedback, commands.
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { config } from './config.js';
import {
  getDraft,
  getDraftByMessageId,
  setDraftMessageId,
  updateDraftText,
  markDraftPublished,
  addPost,
  getStats,
  getPendingDrafts,
  getKv,
} from './db.js';
import { stripTags } from './format.js';

export const bot = new Bot(config.BOT_TOKEN);

// ─── Circular-import break: handlers injected at startup ────────────────────
/** @type {((reason: string, opts?: object) => Promise<void>) | null} */
let _generateHandler = null;
/** @type {((reason: string) => Promise<void>) | null} */
let _digestHandler = null;

/**
 * Called from index.js to set blog pipeline handler.
 * @param {(reason: string, opts?: object) => Promise<void>} fn
 */
export function setGenerateHandler(fn) {
  _generateHandler = fn;
}

/**
 * Called from index.js to set personal digest handler.
 * @param {(reason: string) => Promise<void>} fn
 */
export function setDigestHandler(fn) {
  _digestHandler = fn;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build inline keyboard for a draft.
 * @param {number} draftId
 * @returns {InlineKeyboard}
 */
function draftKeyboard(draftId) {
  return new InlineKeyboard()
    .text('✅ Tasdiqlash va chiqarish', `ok:${draftId}`)
    .text('🔄 Qayta yozish', `rw:${draftId}`);
}

/**
 * Send a plain text notification to the owner.
 * Never throws – errors are logged.
 * @param {string} text
 */
export async function notifyOwner(text) {
  try {
    await bot.api.sendMessage(config.MY_CHAT_ID, text);
  } catch (err) {
    console.error('[bot] notifyOwner failed:', err.message ?? err);
  }
}

/**
 * Send a draft to the owner's chat with approve / rewrite buttons.
 * Saves the sent message_id to the DB.
 *
 * @param {number} draftId
 */
export async function sendDraft(draftId) {
  const draft = getDraft(draftId);
  if (!draft) {
    console.error(`[bot] sendDraft: draft #${draftId} not found.`);
    return;
  }

  try {
    const msg = await bot.api.sendMessage(config.MY_CHAT_ID, draft.text, {
      parse_mode: 'HTML',
      reply_markup: draftKeyboard(draftId),
      link_preview_options: { is_disabled: true },
    });
    setDraftMessageId({ id: draftId, message_id: msg.message_id });
    console.log(`[bot] Draft #${draftId} sent to owner (msg_id=${msg.message_id}).`);
  } catch (err) {
    console.error(`[bot] Failed to send draft #${draftId}:`, err.message ?? err);
    // Try plain text fallback if Telegram rejects HTML
    if (err.message?.includes("can't parse entities")) {
      try {
        const plain = stripTags(draft.text);
        const msg = await bot.api.sendMessage(config.MY_CHAT_ID, plain, {
          reply_markup: draftKeyboard(draftId),
        });
        setDraftMessageId({ id: draftId, message_id: msg.message_id });
        console.log(`[bot] Draft #${draftId} sent as plain text fallback.`);
      } catch (fallbackErr) {
        console.error(`[bot] Plain-text fallback also failed:`, fallbackErr.message ?? fallbackErr);
      }
    }
  }
}

// ─── Owner-only middleware ─────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  console.log(`[bot] Update from user id=${fromId} (expected MY_CHAT_ID=${config.MY_CHAT_ID})`);
  if (fromId !== config.MY_CHAT_ID) {
    console.warn(`[bot] Ignored update from unauthorized user ${fromId}. Agar bu siz bo'lsangiz, .env dagi MY_CHAT_ID=${fromId} qilib yangilang.`);
    return;
  }
  await next();
});

// ─── Callback query: approve ───────────────────────────────────────────────

bot.callbackQuery(/^ok:(\d+)$/, async (ctx) => {
  const draftId = Number(ctx.match[1]);
  const draft = getDraft(draftId);

  if (!draft) {
    await ctx.answerCallbackQuery({ text: 'Draft topilmadi.' });
    return;
  }
  if (draft.status === 'published') {
    await ctx.answerCallbackQuery({ text: `Bu draft allaqachon e'lon qilingan.` });
    return;
  }

  await ctx.answerCallbackQuery({ text: `📤 E'lon qilinmoqda…` });

  try {
    const sent = await bot.api.sendMessage(config.CHANNEL_USERNAME, draft.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });

    markDraftPublished(draftId);
    addPost({
      topic: draft.topic,
      text: draft.text,
      channel_message_id: sent.message_id,
    });

    // Remove buttons from the owner's message
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });

    // Notify the owner with a link to the published post
    const postLink = `https://t.me/${config.CHANNEL_USERNAME.replace('@', '')}/${sent.message_id}`;
    await ctx.reply(`✅ Post e'lon qilindi!\n${postLink}`);

    console.log(`[bot] Draft #${draftId} published to channel (msg=${sent.message_id}).`);
  } catch (err) {
    console.error(`[bot] Failed to publish draft #${draftId}:`, err.message ?? err);

    let hint = '';
    if (err.message?.includes('not enough rights') || err.message?.includes('admin')) {
      hint = `\n\nEslatma: Bot kanalga admin bo'lishi kerak!`;
    }

    // Try plain-text fallback if HTML is rejected
    if (err.message?.includes("can't parse entities")) {
      try {
        const plain = stripTags(draft.text);
        const sent = await bot.api.sendMessage(config.CHANNEL_USERNAME, plain);
        markDraftPublished(draftId);
        addPost({ topic: draft.topic, text: plain, channel_message_id: sent.message_id });
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        const postLink = `https://t.me/${config.CHANNEL_USERNAME.replace('@', '')}/${sent.message_id}`;
        await ctx.reply(`✅ Post oddiy matn sifatida e'lon qilindi!\n${postLink}`);
        return;
      } catch (fallbackErr) {
        console.error('[bot] Plain-text publish fallback failed:', fallbackErr.message);
      }
    }

    await ctx.reply(`❌ E'lon qilishda xatolik: ${err.message}${hint}`);
  }
});

// ─── Callback query: rewrite ───────────────────────────────────────────────

bot.callbackQuery(/^rw:(\d+)$/, async (ctx) => {
  const draftId = Number(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: '✍️ Qayta yozilmoqda…' });
  await _doRewrite(ctx, draftId, null);
});

// ─── Main Menu Keyboard ───────────────────────────────────────────────────

export const mainKeyboard = new Keyboard()
  .text('🚀 Yangi post yaratish')
  .text('📋 Shaxsiy Dayjest')
  .row()
  .text('📊 Statistika')
  .text('⚙️ Dayjest Holati')
  .row()
  .text('ℹ️ Yordam')
  .resized();

// ─── Command & Button Handlers ─────────────────────────────────────────────

async function handleStart(ctx) {
  await ctx.reply(
    `👋 <b>IT Content Creator & Personal Digest Agent</b>ga xush kelibsiz!\n\n` +
      `Quyidagi buyruqlar va menyu tugmalari orqali botni boshqarishingiz mumkin:\n\n` +
      `<b>📰 Kanal Blog Pipeline:</b>\n` +
      `• 🚀 <b>/generate</b> — Ommaviy yangiliklardan kanal uchun yangi post qoralash\n` +
      `• 📊 <b>/status</b> — Kanal statistikasi va kutayotgan qoralamalar\n\n` +
      `<b>📋 Shaxsiy Dayjest Agent:</b>\n` +
      `• 📋 <b>/digest</b> — Telegramingiz (kanallar, guruhlar, shaxsiy yozishmalar) bo'yicha shaxsiy maxfiy hisobot tayyorlash\n` +
      `• ⚙️ <b>/digest_status</b> — Dayjest sozlamalari va oxirgi hisobot vaqti\n\n` +
      `• ℹ️ <b>/help</b> — Ushbu yordam menyusi\n\n` +
      `<i>Xavfsizlik kafolati: Shaxsiy chatlar faqat sizning shaxsiy chatingizga yuboriladi va kanalga HECH QACHON chiqmaydi. Ismlar va parollar/kodlar AIga yuborilishidan oldin tozalangan bo'ladi.</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard,
    }
  );
}

async function handleGenerate(ctx) {
  if (!config.BLOG_ENABLED) {
    await ctx.reply('⚠️ Blog pipeline o\'chirilgan (BLOG_ENABLED=false).');
    return;
  }
  if (!_generateHandler) {
    await ctx.reply('⚠️ Generator hali tayyor emas.');
    return;
  }
  await ctx.reply(
    '🚀 Yangiliklar to\'planmoqda va AI post yozishni boshladi… Biroz kuting, tayyor bo\'lgach qoralamani yuboraman!',
    { reply_markup: mainKeyboard }
  );
  // Run without awaiting so the command returns immediately
  _generateHandler('manual').catch((err) => {
    console.error('[bot] Manual generate error:', err.message ?? err);
    ctx.reply(`❌ Xatolik yuz berdi: ${err.message}`).catch(() => {});
  });
}

async function handleStatus(ctx) {
  const stats = getStats();
  const pending = getPendingDrafts();

  let text =
    `📊 <b>Blog Pipeline Statistikasi:</b>\n\n` +
    `• 📢 E'lon qilingan postlar: <b>${stats.published_count}</b>\n` +
    `• ⏳ Kutayotgan qoralamalar: <b>${stats.pending_drafts}</b>\n` +
    `• 🔌 Blog holati: <b>${config.BLOG_ENABLED ? 'Faol ✅' : 'O\'chirilgan ❌'}</b>\n\n`;

  if (pending.length > 0) {
    text += `📝 <b>Kutayotgan qoralamalar:</b>\n`;
    for (const d of pending) {
      text += `  • #${d.id} — ${d.topic} (qayta yozilgan: ${d.rewrites})\n`;
    }
    text += '\n';
  }

  text += `⏰ <b>Avtomatik reja:</b> <code>${config.CRON_EXPR}</code> (${config.TIMEZONE})\n` +
          `📢 <b>Kanal:</b> ${config.CHANNEL_USERNAME}`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard,
  });
}

async function handleDigest(ctx) {
  if (!_digestHandler) {
    await ctx.reply('⚠️ Shaxsiy Dayjest generatori hali tayyor emas.');
    return;
  }
  await ctx.reply(
    '📋 Shaxsiy hisobot tayyorlanmoqda… Kanallar, guruhlar va shaxsiy chatlar tahlil qilinmoqda, biroz kuting!',
    { reply_markup: mainKeyboard }
  );
  _digestHandler('manual').catch((err) => {
    console.error('[bot] Manual digest error:', err.message ?? err);
    ctx.reply(`❌ Dayjestda xatolik yuz berdi: ${err.message}`).catch(() => {});
  });
}

async function handleDigestStatus(ctx) {
  const lastTimeStr = getKv('lastDigestTime');
  let lastTimeFormatted = 'Mavjud emas (hali ishga tushmagan)';
  if (lastTimeStr) {
    const t = Number(lastTimeStr);
    if (!isNaN(t) && t > 0) {
      lastTimeFormatted = new Date(t * 1000).toLocaleString('uz-UZ', {
        timeZone: config.TIMEZONE,
      });
    }
  }

  const text =
    `📋 <b>Shaxsiy Dayjest Holati:</b>\n\n` +
    `• ⏰ <b>Oxirgi hisobot vaqti:</b> <code>${lastTimeFormatted}</code>\n` +
    `• 🔄 <b>Avtomatik reja:</b> <code>${config.DIGEST_CRON}</code> (${config.TIMEZONE})\n` +
    `• 📅 <b>Tahlil chuqurligi:</b> ${config.DIGEST_MAX_DAYS} kun\n` +
    `• 💬 <b>Maksimal dialoglar:</b> ${config.MAX_DIALOGS}\n` +
    `• 🔒 <b>Shaxsiy chatlar tahlili:</b> ${config.DIGEST_INCLUDE_PRIVATE ? 'Yoqilgan ✅' : 'O\'chirilgan ❌'}\n` +
    `• 🚫 <b>Istisno qilingan chatlar soni:</b> ${config.EXCLUDE_CHATS.length}\n` +
    `• 🎯 <b>Qiziqishlar:</b> <i>${config.USER_INTERESTS}</i>\n\n` +
    `<i>Hisobotni hoziroq olish uchun:</i> /digest`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard,
  });
}

// Register commands
bot.command('start', handleStart);
bot.command('generate', handleGenerate);
bot.command('status', handleStatus);
bot.command('digest', handleDigest);
bot.command('digest_status', handleDigestStatus);
bot.command('help', handleStart);

// Register button text handlers
bot.hears('🚀 Yangi post yaratish', handleGenerate);
bot.hears('📋 Shaxsiy Dayjest', handleDigest);
bot.hears('📊 Statistika', handleStatus);
bot.hears('⚙️ Dayjest Holati', handleDigestStatus);
bot.hears('ℹ️ Yordam', handleStart);

// ─── Reply with feedback ───────────────────────────────────────────────────

// If the owner REPLIES to a draft message with text → treat as feedback
bot.on('message:text', async (ctx, next) => {
  const replyTo = ctx.message?.reply_to_message?.message_id;

  if (!replyTo) {
    return next();
  }

  const draft = getDraftByMessageId(replyTo);
  if (!draft) {
    return next();
  }

  const feedback = ctx.message.text.trim();
  if (!feedback) {
    return next();
  }

  console.log(`[bot] Feedback received for draft #${draft.id}: "${feedback.slice(0, 80)}"`);
  await ctx.reply('🔄 Izohingizga qarab qayta yozilmoqda…');
  await _doRewrite(ctx, draft.id, feedback);
});

// ─── Shared rewrite logic ──────────────────────────────────────────────────

/**
 * Regenerate a draft (for both the button and feedback-reply paths).
 * @param {import('grammy').Context} ctx
 * @param {number} draftId
 * @param {string|null} feedback – owner's textual feedback, or null
 */
async function _doRewrite(ctx, draftId, feedback) {
  const draft = getDraft(draftId);
  if (!draft) {
    await ctx.reply('Draft topilmadi.');
    return;
  }

  if (draft.rewrites >= config.MAX_REWRITES) {
    await ctx.reply(
      `⚠️ Bu draft uchun qayta yozish limiti (${config.MAX_REWRITES}) tugadi. Yangi pipeline ishga tushiring: /generate`
    );
    return;
  }

  if (!_generateHandler) {
    await ctx.reply('⚠️ Generator hali tayyor emas. Biroz kuting.');
    return;
  }

  try {
    // Re-run generation with stored context + previous draft + feedback
    await _generateHandler('rewrite', {
      existingDraftId: draftId,
      feedback: feedback ?? undefined,
    });
  } catch (err) {
    console.error(`[bot] Rewrite failed for draft #${draftId}:`, err.message ?? err);
    await ctx.reply(`❌ Qayta yozishda xatolik: ${err.message}`);
  }
}
