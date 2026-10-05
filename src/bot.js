// src/bot.js – grammY Telegram bot
// Handles owner-only interactions and public contest / lead magnet handlers.
import { Bot, InlineKeyboard, Keyboard, Composer } from 'grammy';
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
  getCategoryStats,
} from './db.js';
import { getActiveCategories, getAllCategories, getCategoryById } from './topics.js';
import { stripTags } from './format.js';
import {
  handleOwnerMagnit,
  handleOwnerMagnetSave,
  handleOwnerMagnetRewrite,
  handleStartMagnet,
  handleSubscriptionCheck,
  handleOwnerMagnitlar,
} from './magnet.js';
import { generateGrowthPack } from './growthPack.js';

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
    .row()
    .text('🔄 Qayta yozish', `rw:${draftId}`)
    .row()
    .text('🔀 Boshqa mavzu', `tp:${draftId}`);
}

/**
 * Build inline keyboard for selecting a category before generating a post.
 * @returns {InlineKeyboard}
 */
export function categorySelectionKeyboard() {
  const active = getActiveCategories();
  const keyboard = new InlineKeyboard();

  keyboard.text("🎲 Avtomatik (Vaznlar bo'yicha)", 'gen_cat:auto').row();

  const labels = {
    it: '💻 IT va Texnologiyalar',
    karyera: '💼 Karyera va Ish',
    imkoniyatlar: '🎓 Imkoniyatlar & Grantlar',
    oqish: "📚 Ta'lim & Samaradorlik",
    fan: '🔬 Ilm-fan va Kelajak',
    pul: '💰 Moliyaviy savodxonlik',
  };

  const rows = [
    ['it', 'karyera'],
    ['imkoniyatlar', 'oqish'],
    ['fan', 'pul'],
  ];

  for (const pair of rows) {
    const present = pair.filter((id) => active.some((c) => c.id === id));
    if (present.length === 2) {
      keyboard.text(labels[present[0]], `gen_cat:${present[0]}`)
              .text(labels[present[1]], `gen_cat:${present[1]}`)
              .row();
    } else if (present.length === 1) {
      keyboard.text(labels[present[0]], `gen_cat:${present[0]}`).row();
    }
  }

  // Any other active categories not in predefined pairs
  for (const cat of active) {
    if (!rows.flat().includes(cat.id)) {
      keyboard.text(`📌 ${cat.name}`, `gen_cat:${cat.id}`).row();
    }
  }

  return keyboard;
}

/**
 * Send an HTML notification to the owner.
 * Never throws – errors are logged.
 * @param {string} text
 * @param {object} [options]
 */
export async function notifyOwner(text, options = {}) {
  try {
    await bot.api.sendMessage(config.MY_CHAT_ID, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...options,
    });
  } catch (err) {
    try {
      await bot.api.sendMessage(config.MY_CHAT_ID, text.replace(/<[^>]+>/g, ''), options);
    } catch (fallbackErr) {
      console.error('[bot] notifyOwner failed:', fallbackErr.message ?? fallbackErr);
    }
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

  const keyboard = draftKeyboard(draftId);

  try {
    const msg = await bot.api.sendMessage(config.MY_CHAT_ID, draft.text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    setDraftMessageId({ id: draftId, message_id: msg.message_id });
    console.log(`[bot] Draft #${draftId} sent to owner (msg_id=${msg.message_id}).`);
  } catch (err) {
    console.error(`[bot] Failed to send draft #${draftId}:`, err.message ?? err);
    // Plain text fallback if Telegram rejects HTML
    try {
      const plain = stripTags(draft.text);
      const msg = await bot.api.sendMessage(config.MY_CHAT_ID, plain, {
        reply_markup: keyboard,
      });
      setDraftMessageId({ id: draftId, message_id: msg.message_id });
      console.log(`[bot] Draft #${draftId} sent as plain text fallback.`);
    } catch (fallbackErr) {
      console.error(`[bot] Plain-text fallback also failed:`, fallbackErr.message ?? fallbackErr);
    }
  }
}

/**
 * Edit an existing draft message in place with the latest text and keyboard.
 * Used for "Boshqa mavzu" regeneration.
 *
 * @param {number} draftId
 */
export async function editDraftMessage(draftId) {
  const draft = getDraft(draftId);
  if (!draft) {
    console.error(`[bot] editDraftMessage: draft #${draftId} not found.`);
    return;
  }
  if (!draft.message_id) {
    return sendDraft(draftId);
  }

  const keyboard = draftKeyboard(draftId);

  try {
    await bot.api.editMessageText(config.MY_CHAT_ID, draft.message_id, draft.text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    console.log(`[bot] Draft #${draftId} edited in place (msg_id=${draft.message_id}).`);
  } catch (err) {
    console.error(`[bot] Failed to edit draft #${draftId} in place:`, err.message ?? err);
    try {
      const plain = stripTags(draft.text);
      await bot.api.editMessageText(config.MY_CHAT_ID, draft.message_id, plain, {
        reply_markup: keyboard,
      });
      console.log(`[bot] Draft #${draftId} edited in place as plain text fallback.`);
    } catch (fallbackErr) {
      console.warn('[bot] In-place edit fallback also failed, sending as new message:', fallbackErr.message ?? fallbackErr);
      await sendDraft(draftId);
    }
  }
}

// ─── Channel & Public Access Control ───────────────────────────────────────

// 1. Bot status updates in chats
bot.on('my_chat_member', async (ctx) => {
  const status = ctx.myChatMember?.new_chat_member?.status;
  console.log(`[bot] Bot status in chat ${ctx.chat?.title || ctx.chat?.id}: ${status}`);
});

// 2. In-memory rate limiter for public users (1 request per 2 seconds per user)
const publicRateLimitMap = new Map();
function checkPublicRateLimit(userId) {
  const now = Date.now();
  const last = publicRateLimitMap.get(userId) || 0;
  if (now - last < 2000) {
    return false;
  }
  publicRateLimitMap.set(userId, now);
  if (publicRateLimitMap.size > 5000) {
    for (const [k, v] of publicRateLimitMap.entries()) {
      if (now - v > 60000) publicRateLimitMap.delete(k);
    }
  }
  return true;
}

// 3. Public Composer (Allowed routes for non-owner users in private chat)
export const publicComposer = new Composer();

// Public /start
publicComposer.command('start', async (ctx) => {
  const text = ctx.message?.text?.trim() || '';
  const payload = text.replace(/^\/start(@\w+)?\s*/i, '').trim();

  if (payload.startsWith('m')) {
    await handleStartMagnet(ctx, payload.slice(1), bot);
    return;
  }

  const name = ctx.from?.first_name ? ctx.from.first_name.replace(/<[^>]+>/g, '') : 'Do\'st';
  await ctx.reply(
    `Assalomu alaykum, <b>${name}</b>! 👋\n\n` +
      `IT, dasturlash va foydali materiallar kanalimiz: ${config.CHANNEL_USERNAME}`,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }
  );
});

// Lead magnet subscription check callback
publicComposer.callbackQuery(/^subcheck:m(\d+)$/, async (ctx) => {
  await handleSubscriptionCheck(ctx, ctx.match[1], bot);
});

// Non-owner fallback handler (Prevents falling through to owner commands)
publicComposer.use(async (ctx) => {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: 'Ruxsat etilmagan amal.' }).catch(() => {});
    return;
  }
  await ctx.reply(
    `👋 Salom! IT va dasturlash bo'yicha sara maqolalar va yangiliklarni kanalimizda kuzatib boring: ${config.CHANNEL_USERNAME}`
  );
});

// 4. Access control router middleware
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;

  // Channel posts or updates without user ID pass through or ignore
  if (!fromId) return;

  // Owner passes through to owner commands and workflows
  if (fromId === config.MY_CHAT_ID) {
    return next();
  }

  // Non-owner users are strictly restricted to private chat
  if (ctx.chat?.type !== 'private') {
    return;
  }

  // Rate limiter check for public users
  if (!checkPublicRateLimit(fromId)) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: '⏳ Iltimos, biroz kuting (2 soniya)...' }).catch(() => {});
    } else {
      await ctx.reply('⏳ Iltimos, biroz kuting (2 soniya)...').catch(() => {});
    }
    return;
  }

  // Route to publicComposer and never continue to owner handlers
  return publicComposer.middleware()(ctx, async () => {});
});

// ─── Global Error Handler (Prevents crashes on expired queries) ───────────

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[bot] Error handling update ${ctx?.update?.update_id}:`, err.error?.message ?? err.error ?? err);
});

// ─── Callback query: approve ───────────────────────────────────────────────

bot.callbackQuery(/^ok:(\d+)$/, async (ctx) => {
  const draftId = Number(ctx.match[1]);
  const draft = getDraft(draftId);

  if (!draft) {
    await ctx.answerCallbackQuery({ text: 'Draft topilmadi.' }).catch(() => {});
    return;
  }
  if (draft.status === 'published') {
    await ctx.answerCallbackQuery({ text: `Bu draft allaqachon e'lon qilingan.` }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery({ text: `📤 E'lon qilinmoqda…` }).catch(() => {});

  try {
    const sent = await bot.api.sendMessage(config.CHANNEL_USERNAME, draft.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });

    markDraftPublished(draftId);
    addPost({
      topic: draft.topic,
      text: draft.text,
      image_path: null,
      category: draft.category || 'it',
      channel_message_id: sent.message_id,
    });

    // Remove buttons from the owner's message
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});

    // Notify the owner with a link to the published post
    const postLink = `https://t.me/${config.CHANNEL_USERNAME.replace('@', '')}/${sent.message_id}`;
    await ctx.reply(`✅ Post e'lon qilindi!\n${postLink}`);

    console.log(`[bot] Draft #${draftId} published to channel (msg=${sent.message_id}).`);

    // Trigger Growth Pack if enabled (async, non-blocking)
    if (config.GROWTH_PACK) {
      generateGrowthPack({
        postTopic: draft.topic,
        postText: draft.text,
        channelUsername: config.CHANNEL_USERNAME,
        botApi: bot.api,
        ownerChatId: config.MY_CHAT_ID,
      }).catch((err) => {
        console.error('[bot] Growth pack error:', err.message);
      });
    }
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
        addPost({ topic: draft.topic, text: plain, image_path: null, category: draft.category || 'it', channel_message_id: sent.message_id });
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
        const postLink = `https://t.me/${config.CHANNEL_USERNAME.replace('@', '')}/${sent.message_id}`;
        await ctx.reply(`✅ Post oddiy matn sifatida e'lon qilindi!\n${postLink}`);

        if (config.GROWTH_PACK) {
          generateGrowthPack({
            postTopic: draft.topic,
            postText: plain,
            channelUsername: config.CHANNEL_USERNAME,
            botApi: bot.api,
            ownerChatId: config.MY_CHAT_ID,
          }).catch((err) => {
            console.error('[bot] Growth pack error:', err.message);
          });
        }
        return;
      } catch (fallbackErr) {
        console.error('[bot] Plain-text publish fallback failed:', fallbackErr.message);
      }
    }

    await ctx.reply(`❌ E'lon qilishda xatolik: ${err.message}${hint}`);
  }
});

// ─── Callback query: rewrite (same category) ───────────────────────────────

bot.callbackQuery(/^rw:(\d+)$/, async (ctx) => {
  const draftId = Number(ctx.match[1]);
  await ctx.answerCallbackQuery({ text: '✍️ Qayta yozilmoqda…' }).catch(() => {});
  await _doRewrite(ctx, draftId, null);
});

// ─── Callback query: switch topic (different category) ────────────────────

bot.callbackQuery(/^tp:(\d+)$/, async (ctx) => {
  const draftId = Number(ctx.match[1]);
  const draft = getDraft(draftId);

  if (!draft) {
    await ctx.answerCallbackQuery({ text: 'Draft topilmadi.' }).catch(() => {});
    return;
  }
  if (draft.status === 'published') {
    await ctx.answerCallbackQuery({ text: `Bu draft allaqachon e'lon qilingan.` }).catch(() => {});
    return;
  }
  if (draft.rewrites >= config.MAX_REWRITES) {
    await ctx.answerCallbackQuery({ text: `Qayta yozish limiti (${config.MAX_REWRITES}) tugagan.` }).catch(() => {});
    await ctx.reply(
      `⚠️ Bu draft uchun qayta yozish limiti (${config.MAX_REWRITES}) tugadi. Yangi pipeline ishga tushiring: /generate`
    );
    return;
  }
  if (!_generateHandler) {
    await ctx.answerCallbackQuery({ text: 'Generator hali tayyor emas.' }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery({ text: '🔀 Yangi mavzu tanlanmoqda va qayta yozilmoqda…' }).catch(() => {});

  try {
    await _generateHandler('switch_category', {
      existingDraftId: draftId,
      switchCategory: true,
    });
  } catch (err) {
    console.error(`[bot] Switch category failed for draft #${draftId}:`, err.message ?? err);
    await ctx.reply(`❌ Yangi mavzuda qayta yozishda xatolik: ${err.message}`);
  }
});

// ─── Callback query: generate category selection ──────────────────────────

bot.callbackQuery(/^gen_cat:(.+)$/, async (ctx) => {
  const choice = ctx.match[1];
  await ctx.answerCallbackQuery().catch(() => {});

  if (!config.BLOG_ENABLED) {
    await ctx.reply('⚠️ Blog pipeline o\'chirilgan (BLOG_ENABLED=false).');
    return;
  }
  if (!_generateHandler) {
    await ctx.reply('⚠️ Generator hali tayyor emas.');
    return;
  }

  // Remove the inline buttons from the selection message
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});

  if (choice === 'auto') {
    await ctx.reply(
      `🚀 Yangiliklar to'planmoqda va AI post yozishni boshladi (avtomatik vaznlar asosida)… Biroz kuting, tayyor bo'lgach qoralamani yuboraman!`,
      { reply_markup: mainKeyboard }
    );
    _generateHandler('manual').catch((err) => {
      console.error('[bot] Manual generate error:', err.message ?? err);
    });
  } else {
    const cat = getCategoryById(choice);
    const catName = cat ? cat.name : choice;
    await ctx.reply(
      `🚀 <b>${catName}</b> yo'nalishida ma'lumotlar to'planmoqda va AI post yozishni boshladi… Biroz kuting, tayyor bo'lgach qoralamani yuboraman!`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    );
    _generateHandler('manual', { forcedCategory: choice }).catch((err) => {
      console.error('[bot] Manual generate error:', err.message ?? err);
    });
  }
});

// ─── Main Menu Keyboard ───────────────────────────────────────────────────

export const mainKeyboard = new Keyboard()
  .text('🚀 Yangi post yaratish')
  .text('✍️ Maxsus mavzuda post')
  .row()
  .text('📋 Shaxsiy Dayjest')
  .text('📊 Statistika')
  .row()
  .text('⚙️ Dayjest Holati')
  .text('ℹ️ Yordam')
  .resized();

export const cancelKeyboard = new Keyboard()
  .text('❌ Bekor qilish')
  .resized();

let _waitingForTopic = false;

// ─── Command & Button Handlers ─────────────────────────────────────────────

async function handleStart(ctx) {
  await ctx.reply(
    `👋 <b>IT Content Creator & Personal Digest Agent</b>ga xush kelibsiz!\n\n` +
      `Quyidagi buyruqlar va menyu tugmalari orqali botni boshqarishingiz mumkin:\n\n` +
      `<b>📰 Kanal Blog Pipeline:</b>\n` +
      `• 🚀 <b>/generate [kategoriya]</b> — Ommaviy yangiliklardan yangi post qoralash (ixtiyoriy kategoriya bilan)\n` +
      `• 📊 <b>/topics</b> — Mavzular kategoriyalari, vaznlari va e'lon qilingan postlar statistikasi\n` +
      `• ✍️ <b>/write [mavzu/link]</b> — Maxsus mavzu yoki havola (URL) bo'yicha post yozish\n` +
      `• 📊 <b>/status</b> — Kanal statistikasi va kutayotgan qoralamalar\n\n` +
      `<b>📋 Shaxsiy Dayjest Agent:</b>\n` +
      `• 📋 <b>/digest</b> — Telegramingiz (kanallar, guruhlar, shaxsiy yozishmalar) bo'yicha shaxsiy maxfiy hisobot tayyorlash\n` +
      `<b>🧲 Lead Magnitlar:</b>\n` +
      `• 🧲 <b>/magnit [mavzu]</b> — Yangi lead magnit tayyorlash va e'lon qilish\n` +
      `• 📚 <b>/magnitlar</b> — Lead magnitlar ro'yxati va ko'rishlar soni\n\n` +
      `• ℹ️ <b>/help</b> — Ushbu yordam menyusi\n\n` +
      `<i>Xavfsizlik kafolati: Shaxsiy chatlar faqat sizning shaxsiy chatingizga yuboriladi va kanalga HECH QACHON chiqmaydi. Ismlar va parollar/kodlar AIga yuborilishidan oldin tozalangan bo'ladi.</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard,
    }
  );
}

async function handleWrite(ctx) {
  if (!config.BLOG_ENABLED) {
    await ctx.reply('⚠️ Blog pipeline o\'chirilgan (BLOG_ENABLED=false).');
    return;
  }
  if (!_generateHandler) {
    await ctx.reply('⚠️ Generator hali tayyor emas.');
    return;
  }

  const text = ctx.message?.text?.trim() || '';
  const arg = text.replace(/^\/write(@\w+)?\s*/i, '').trim();

  if (arg) {
    _waitingForTopic = false;
    await ctx.reply(
      `✍️ <b>Mavzu qabul qilindi:</b> <i>"${arg.slice(0, 100)}"</i>\n\nAI post tayyorlamoqda, biroz kuting…`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    );
    _generateHandler('custom_topic', { customTopic: arg }).catch((err) => {
      console.error('[bot] Custom topic error:', err.message);
    });
    return;
  }

  _waitingForTopic = true;
  await ctx.reply(
    `✍️ <b>Qaysi mavzuda post yozmoqchisiz?</b>\n\n` +
      `Mavzu nomini, qisqa g'oyangizni yoki qiziqarli IT maqolaning <b>havolasini (URL link)</b> yuboring:\n\n` +
      `<i>Misollar:</i>\n` +
      `• <code>React 19 dagi Server Actions va uning afzalliklari</code>\n` +
      `• <code>https://techcrunch.com/2026/...</code>`,
    {
      parse_mode: 'HTML',
      reply_markup: cancelKeyboard,
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

  const text = ctx.message?.text?.trim() || '';
  const isCommand = /^\/generate(@\w+)?/i.test(text);
  const arg = isCommand ? text.replace(/^\/generate(@\w+)?\s*/i, '').trim().toLowerCase() : '';

  // If user explicitly specified category like `/generate karyera`
  if (arg) {
    const cat = getCategoryById(arg);
    if (!cat) {
      const valid = getAllCategories().map((c) => c.id).join(', ');
      await ctx.reply(
        `⚠️ <b>Noma'lum kategoriya:</b> <code>${arg}</code>\n\n` +
          `Mavjud kategoriyalar: <code>${valid}</code>\n\n` +
          `<i>Misol:</i> <code>/generate karyera</code>`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard }
      );
      return;
    }

    await ctx.reply(
      `🚀 <b>${cat.name}</b> (${cat.id}) yo'nalishida yangiliklar to'planmoqda va AI post yozishni boshladi… Biroz kuting, tayyor bo'lgach qoralamani yuboraman!`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    );

    _generateHandler('manual', { forcedCategory: cat.id }).catch((err) => {
      console.error('[bot] Manual generate error:', err.message ?? err);
    });
    return;
  }

  // If button clicked or `/generate` without argument: show category selection buttons
  await ctx.reply(
    `🎯 <b>Qaysi yo'nalishda post yaratmoqchisiz?</b>\n\n` +
      `Quyidagi tugmalardan birini tanlang yoki avtomatik (vaznlangan) tanlovdan foydalaning:`,
    {
      parse_mode: 'HTML',
      reply_markup: categorySelectionKeyboard(),
    }
  );
}

async function handleTopics(ctx) {
  const active = getActiveCategories();
  const stats = getCategoryStats();
  const counts = Object.fromEntries(stats.map((s) => [s.category, s.count]));

  let text = `📊 <b>Blog Mavzulari va Kategoriyalari:</b>\n\n`;
  for (const cat of active) {
    const publishedCount = counts[cat.id] ?? 0;
    text += `• <b>${cat.name}</b> (<code>${cat.id}</code>)\n`;
    text += `  Vazni: <b>${cat.normalizedWeight}%</b> | E'lon qilingan: <b>${publishedCount} ta post</b>\n\n`;
  }

  const all = getAllCategories();
  const disabled = all.filter((c) => !active.some((a) => a.id === c.id));
  if (disabled.length > 0) {
    text += `<i>Nofaol kategoriyalar:</i> ${disabled.map((d) => `<code>${d.id}</code>`).join(', ')}\n` +
      `<i>(Faollashtirish uchun: <code>ENABLE_TOPICS=${disabled[0].id}</code>)</i>\n\n`;
  }

  text += `💡 <i>Aniq kategoriya bo'yicha post yaratish:</i> <code>/generate &lt;kategoriya&gt;</code>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard,
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

export const digestScopeKeyboard = new InlineKeyboard()
  .text('👥 Guruhlar', 'digest:groups')
  .text('📢 Kanallar', 'digest:channels')
  .row()
  .text('👤 Userlar (Shaxsiy)', 'digest:users')
  .text('🌐 Hammasi', 'digest:all');

async function handleDigest(ctx) {
  if (!_digestHandler) {
    await ctx.reply('⚠️ Shaxsiy Dayjest generatori hali tayyor emas.');
    return;
  }
  await ctx.reply(
    '📋 <b>Qaysi bo\'lim bo\'yicha hisobot olmoqchisiz?</b>\n\n' +
      'Quyidagi tugmalardan birini tanlang:\n\n' +
      '• 👥 <b>Guruhlar</b> — Faqat guruhlardagi muhokamalar va muhim mavzular\n' +
      '• 📢 <b>Kanallar</b> — Kanallardagi yangiliklar va trendlar\n' +
      '• 👤 <b>Userlar</b> — Shaxsiy chatlar (javob kutilayotgan/muhim xabarlar)\n' +
      '• 🌐 <b>Hammasi</b> — Barcha chatlar bo\'yicha to\'liq hisobot',
    {
      parse_mode: 'HTML',
      reply_markup: digestScopeKeyboard,
    }
  );
}

// ─── Callback query: digest scope selection ───────────────────────────────

bot.callbackQuery(/^digest:(groups|channels|users|all)$/, async (ctx) => {
  const scope = ctx.match[1];
  await ctx.answerCallbackQuery().catch(() => {});

  let scopeLabel = 'Barcha chatlar';
  if (scope === 'groups') scopeLabel = '👥 Guruhlar';
  else if (scope === 'channels') scopeLabel = '📢 Kanallar';
  else if (scope === 'users') scopeLabel = '👤 Shaxsiy yozishmalar (Userlar)';

  await ctx.reply(
    `⏳ <b>${scopeLabel}</b> bo'yicha ma'lumotlar tahlil qilinmoqda… Biroz kuting!`,
    { parse_mode: 'HTML' }
  );

  _digestHandler('manual', { scope }).catch((err) => {
    console.error(`[bot] Manual digest error (${scope}):`, err.message ?? err);
  });
});

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

async function handleOwnerStart(ctx) {
  const text = ctx.message?.text?.trim() || '';
  const payload = text.replace(/^\/start(@\w+)?\s*/i, '').trim();
  if (payload.startsWith('m')) {
    await handleStartMagnet(ctx, payload.slice(1), bot);
    return;
  }
  await handleStart(ctx);
}

// Register commands
bot.command('start', handleOwnerStart);
bot.command('write', handleWrite);
bot.command('generate', handleGenerate);
bot.command('topics', handleTopics);
bot.command('status', handleStatus);
bot.command('digest', handleDigest);
bot.command('digest_status', handleDigestStatus);
bot.command('help', handleStart);

// Lead magnet owner commands
bot.command('magnit', async (ctx) => {
  const text = ctx.message?.text?.trim() || '';
  const topic = text.replace(/^\/magnit(@\w+)?\s*/i, '').trim();
  await handleOwnerMagnit(ctx, topic);
});

bot.command('magnitlar', async (ctx) => {
  await handleOwnerMagnitlar(ctx);
});

// Lead magnet preview callback handlers
bot.callbackQuery(/^m_save:(.+)$/, async (ctx) => {
  await handleOwnerMagnetSave(ctx, ctx.match[1], bot);
});

bot.callbackQuery(/^m_rw:(.+)$/, async (ctx) => {
  await handleOwnerMagnetRewrite(ctx, ctx.match[1]);
});

// Register button text handlers
bot.hears('🚀 Yangi post yaratish', handleGenerate);
bot.hears('✍️ Maxsus mavzuda post', handleWrite);
bot.hears('❌ Bekor qilish', async (ctx) => {
  _waitingForTopic = false;
  await ctx.reply('❌ Bekor qilindi.', { reply_markup: mainKeyboard });
});
bot.hears('📋 Shaxsiy Dayjest', handleDigest);
bot.hears('📊 Statistika', handleStatus);
bot.hears('⚙️ Dayjest Holati', handleDigestStatus);
bot.hears('ℹ️ Yordam', handleStart);

// ─── Reply with feedback / Custom topic input ─────────────────────────────

bot.on('message:text', async (ctx, next) => {
  // If waiting for custom topic input
  if (_waitingForTopic) {
    _waitingForTopic = false;
    const topic = ctx.message.text.trim();
    if (topic === '❌ Bekor qilish') {
      await ctx.reply('❌ Bekor qilindi.', { reply_markup: mainKeyboard });
      return;
    }
    await ctx.reply(
      `✍️ <b>Mavzu qabul qilindi:</b> <i>"${topic.slice(0, 100)}"</i>\n\nAI post tayyorlamoqda, biroz kuting…`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    );
    _generateHandler('custom_topic', { customTopic: topic }).catch((err) => {
      console.error('[bot] Custom topic error:', err.message);
    });
    return;
  }

  // Direct URL sent without command (e.g. user simply pasted an article link)
  if (/^https?:\/\//i.test(ctx.message.text.trim()) && !ctx.message?.reply_to_message) {
    const url = ctx.message.text.trim();
    await ctx.reply(
      `🔗 <b>Havola qabul qilindi!</b>\nMaqola o'rganilib, kanal uchun yangi post qoralanmoqda…`,
      { parse_mode: 'HTML', reply_markup: mainKeyboard }
    );
    _generateHandler('custom_topic', { customTopic: url }).catch((err) => {
      console.error('[bot] Direct URL post error:', err.message);
    });
    return;
  }

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
