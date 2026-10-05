// src/magnet.js – Lead magnet creation, gated delivery and view tracking
import { GoogleGenAI } from '@google/genai';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { toTelegramHtml, stripTags } from './format.js';
import {
  createMagnet,
  getMagnet,
  incrementMagnetViews,
  getAllMagnets,
  createDraft,
} from './db.js';
import { sendDraft } from './bot.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

/** In-memory store for unapproved magnet previews: previewId -> previewData */
export const pendingMagnetPreviews = new Map();

/**
 * Generate a lead magnet using AI (Gemini with Google Search grounding or Groq).
 * Produces structured, genuinely useful material in Uzbek (Latin script).
 *
 * @param {object} params
 * @param {string} params.topic
 * @param {string} [params.previousContent]
 * @param {string} [params.feedback]
 * @returns {Promise<{ title: string, teaser: string, contentHtml: string }>}
 */
export async function generateLeadMagnet({ topic, previousContent = null, feedback = null }) {
  const systemPrompt = `Sen professional texnik muharrir, dasturchi va ta'lim bo'yicha mutaxassissan.
Vazifang — o'zbek tilida (lotin yozuvida) o'quvchilar uchun juda amaliy, sifatli va foydali "Lead Magnet" (checklist / roadmap / cheat sheet / ro'yxat) tayyorlash.

TALABLAR:
1. Til: O'zbek tili, lotin yozuvi. Aniq, ravon va professional.
2. Format: Telegram HTML teglari (<b>, <i>, <code>, <pre>, <a href="...">). Hech qanday markdown (* yoki **) ishlatma!
3. Uzunlik: Maksimal 3000–3500 belgi (Telegram bitta xabariga sig'ishi kerak).
4. Mazmun: Quruq gaplar bo'lmasin. Aniq qadamlar, amaliy maslahatlar, kod namunalari yoki manbalar bo'lsin.
5. FAKTLAR: Hech narsa to'qima! Grant yoki imkoniyatlar bo'lsa, faqat rasmiy tasdiqlangan muddat va rasmiy havolalarni kirit.
6. Em-tire (—) va sun'iy AI iboralaridan qoch.
7. Tuzilma:
   • Sarlavha
   • Qisqa kirish (nima uchun bu muhim)
   • Asosiy amaliy qism (ro'yxat, qadamlar yoki cheat sheet)
   • Amaliy xulosa yoki keyingi qadam

JAVOB FORMATI (aynan shu formatda javob ber, boshqa narsa qo'shma):
SARLAVHA: <aniq va jozibali sarlavha>
TEASER: <kanal uchun 2-3 jumlali qisqa anons, material nima haqida ekanligi va nima uchun foydali ekanligi, spoylersiz>
---
<Telegram HTML formatidagi to'liq lead magnit matni>`;

  let userPrompt = `Mavzu: "${topic}"\n\nIltimos, ushbu mavzu bo'yicha yuqoridagi talablarga to'liq mos keladigan amaliy qo'llanma (lead magnet) yoz.`;
  if (previousContent) {
    userPrompt += `\n\nOldingi variant:\n${previousContent}`;
  }
  if (feedback) {
    userPrompt += `\n\nQo'shimcha talab/o'zgartirish:\n${feedback}`;
  }

  // 1. Try Gemini with Google Search grounding
  if (config.GEMINI_API_KEY) {
    try {
      const model = config.GEMINI_MODEL || 'gemini-2.5-flash';
      const candidateModels = [
        model,
        'gemini-3.8-flash',
        'gemini-3.5-flash',
        'gemini-2.5-flash',
      ].filter((m, i, arr) => arr.indexOf(m) === i && Boolean(m) && m !== 'gemini-flash-latest');

      for (const m of candidateModels) {
        try {
          console.log(`[magnet] Generating lead magnet with Gemini (${m}) on topic "${topic}"…`);
          const res = await ai.models.generateContent({
            model: m,
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            config: {
              temperature: 0.7,
              systemInstruction: systemPrompt,
              tools: [{ googleSearch: {} }],
            },
          });

          if (res.text) {
            return parseMagnetResponse(res.text, topic);
          }
        } catch (mErr) {
          console.warn(`[magnet] Gemini model ${m} failed:`, mErr.message);
        }
      }
    } catch (err) {
      console.warn('[magnet] Gemini generation error, trying Groq fallback:', err.message);
    }
  }

  // 2. Groq fallback if Gemini was unavailable
  if (config.GROQ_API_KEY) {
    try {
      const groqModel = config.GROQ_MODEL || 'qwen/qwen3.8-27b';
      console.log(`[magnet] Generating lead magnet with Groq (${groqModel})…`);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? '';
        if (text) {
          return parseMagnetResponse(text, topic);
        }
      }
    } catch (err) {
      console.error('[magnet] Groq fallback error:', err.message);
    }
  }

  throw new Error('Lead magnitni yaratish uchun AI servislaridan javob olinmadi.');
}

/**
 * Parse AI response for lead magnet.
 */
function parseMagnetResponse(rawText, fallbackTopic) {
  let title = fallbackTopic;
  let teaser = `Kanalimiz a'zolari uchun maxsus foydali qo'llanma tayyorladik.`;
  let contentHtml = rawText;

  const headerMatch = rawText.match(/^SARLAVHA:\s*(.+)$/im);
  if (headerMatch) {
    title = headerMatch[1].trim();
  }

  const teaserMatch = rawText.match(/^TEASER:\s*(.+)$/im);
  if (teaserMatch) {
    teaser = teaserMatch[1].trim();
  }

  const parts = rawText.split(/^---$/m);
  if (parts.length > 1) {
    contentHtml = parts.slice(1).join('---').trim();
  } else {
    contentHtml = rawText
      .replace(/^SARLAVHA:.*$/im, '')
      .replace(/^TEASER:.*$/im, '')
      .trim();
  }

  contentHtml = toTelegramHtml(contentHtml);

  return { title, teaser, contentHtml };
}

/**
 * Handle owner /magnit command.
 * Generates magnet and sends preview with inline action buttons.
 */
export async function handleOwnerMagnit(ctx, topic) {
  if (!topic) {
    await ctx.reply(
      `✍️ <b>Lead magnit mavzusini ko'rsating:</b>\n\n` +
        `<i>Misollar:</i>\n` +
        `• <code>/magnit Frontend intervyuda so'raladigan 20 ta savol</code>\n` +
        `• <code>/magnit 2026-yilgi bepul IT grantlar ro'yxati</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  await ctx.reply(`⏳ <b>"${topic.slice(0, 80)}"</b> bo'yicha lead magnit tayyorlanmoqda… AI ma'lumotlarni tekshirmoqda.`, {
    parse_mode: 'HTML',
  });

  try {
    const { title, teaser, contentHtml } = await generateLeadMagnet({ topic });
    const previewId = 'mp_' + Date.now();

    pendingMagnetPreviews.set(previewId, {
      previewId,
      topic,
      title,
      teaser,
      contentHtml,
      rewrites: 0,
    });

    const keyboard = new InlineKeyboard()
      .text('✅ Saqlash va e\'lon qilish', `m_save:${previewId}`)
      .row()
      .text('🔄 Qayta yozish', `m_rw:${previewId}`);

    const previewMsg =
      `🧲 <b>Yangi Lead Magnit Qoralamasi:</b>\n\n` +
      `📌 <b>Sarlavha:</b> ${title}\n\n` +
      `📝 <b>Teaser:</b>\n<i>${teaser}</i>\n\n` +
      `────────────────────────\n` +
      `<b>To'liq matn ko'rinishi:</b>\n\n` +
      contentHtml;

    try {
      await ctx.reply(previewMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch {
      // Plain text fallback if HTML entity fails
      await ctx.reply(stripTags(previewMsg), {
        reply_markup: keyboard,
      });
    }
  } catch (err) {
    console.error('[magnet] Generate error:', err.message);
    await ctx.reply(`❌ Lead magnit tayyorlashda xatolik: ${err.message}`);
  }
}

/**
 * Handle owner clicking "✅ Saqlash va e'lon qilish" on magnet preview.
 */
export async function handleOwnerMagnetSave(ctx, previewId, bot) {
  const preview = pendingMagnetPreviews.get(previewId);
  if (!preview) {
    await ctx.answerCallbackQuery({ text: 'Qoralama muddati o\'tgan yoki topilmadi.' }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery({ text: '💾 Saqlanmoqda…' }).catch(() => {});

  try {
    // 1. Save magnet in DB
    const magnetId = createMagnet({
      title: preview.title,
      content_html: preview.contentHtml,
    });

    pendingMagnetPreviews.delete(previewId);

    // 2. Get bot username for deep link
    let botUsername = '';
    try {
      const me = await bot.api.getMe();
      botUsername = me.username;
    } catch {
      botUsername = 'aiSupportBot';
    }

    const deepLink = `https://t.me/${botUsername}?start=m${magnetId}`;

    // 3. Create a post draft for channel teaser
    const draftText =
      `🎁 <b>${preview.title}</b>\n\n` +
      `${preview.teaser}\n\n` +
      `📥 <b>To'liq materialni botimizdan bepul oling:</b>\n` +
      `👉 <a href="${deepLink}">Qo'llanmani yuklab olish</a>\n\n` +
      `#foydali #qollanma #material`;

    const draftId = createDraft({
      topic: `Lead Magnit: ${preview.title}`,
      text: draftText,
      image_path: null,
      category: 'magnit',
      context: { category: 'magnit', magnetId },
    });

    // Remove buttons from preview message
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});

    await ctx.reply(
      `✅ <b>Lead magnit #${magnetId} saqlandi!</b>\n\n` +
        `Kanal uchun anons posti yaratildi (Draft #${draftId}). ` +
        `Postni tasdiqlashingiz uchun yuborilmoqda:`,
      { parse_mode: 'HTML' }
    );

    // Send the draft to owner so they can approve/publish it
    await sendDraft(draftId);
  } catch (err) {
    console.error('[magnet] Save error:', err.message);
    await ctx.reply(`❌ Saqlashda xatolik: ${err.message}`);
  }
}

/**
 * Handle owner clicking "🔄 Qayta yozish" on magnet preview.
 */
export async function handleOwnerMagnetRewrite(ctx, previewId) {
  const preview = pendingMagnetPreviews.get(previewId);
  if (!preview) {
    await ctx.answerCallbackQuery({ text: 'Qoralama topilmadi.' }).catch(() => {});
    return;
  }

  if (preview.rewrites >= (config.MAX_REWRITES || 5)) {
    await ctx.answerCallbackQuery({ text: 'Qayta yozish limiti tugadi.' }).catch(() => {});
    await ctx.reply(`⚠️ Qayta yozish limiti (${config.MAX_REWRITES}) tugadi. Yangi buyruq yuboring: /magnit <mavzu>`);
    return;
  }

  await ctx.answerCallbackQuery({ text: '✍️ Qayta yozilmoqda…' }).catch(() => {});

  try {
    const updated = await generateLeadMagnet({
      topic: preview.topic,
      previousContent: preview.contentHtml,
    });

    preview.title = updated.title;
    preview.teaser = updated.teaser;
    preview.contentHtml = updated.contentHtml;
    preview.rewrites += 1;

    const keyboard = new InlineKeyboard()
      .text('✅ Saqlash va e\'lon qilish', `m_save:${previewId}`)
      .row()
      .text('🔄 Qayta yozish', `m_rw:${previewId}`);

    const previewMsg =
      `🧲 <b>Lead Magnit Qoralamasi (qayta yozildi #${preview.rewrites}):</b>\n\n` +
      `📌 <b>Sarlavha:</b> ${preview.title}\n\n` +
      `📝 <b>Teaser:</b>\n<i>${preview.teaser}</i>\n\n` +
      `────────────────────────\n` +
      `<b>To'liq matn ko'rinishi:</b>\n\n` +
      preview.contentHtml;

    try {
      await ctx.editMessageText(previewMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch {
      await ctx.editMessageText(stripTags(previewMsg), {
        reply_markup: keyboard,
      });
    }
  } catch (err) {
    console.error('[magnet] Rewrite error:', err.message);
    await ctx.reply(`❌ Qayta yozishda xatolik: ${err.message}`);
  }
}

/**
 * Deliver magnet content to a verified subscriber.
 */
export async function deliverMagnetContent(ctx, magnet, bot) {
  // Increment view counter
  incrementMagnetViews(magnet.id);

  const cleanChannel = config.CHANNEL_USERNAME.replace('@', '');

  let closing = `\n\n────────────────────────\n` +
    `📢 <b>Kanalimizga do'stlaringizni taklif qiling:</b> https://t.me/${cleanChannel}\n` +
    `Foydali maqola va yangiliklar har kuni shu yerda!`;

  const fullText = magnet.content_html + closing;

  // Split into chunks if > 4000 characters
  const chunks = splitText(fullText, 4000);

  for (let i = 0; i < chunks.length; i++) {
    const opts = {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };

    try {
      await ctx.reply(chunks[i], opts);
    } catch {
      await ctx.reply(stripTags(chunks[i]));
    }
  }
}

/**
 * Handle user arriving via deep link /start m<id>.
 */
export async function handleStartMagnet(ctx, magnetIdStr, bot) {
  const magnetId = Number(magnetIdStr);
  if (isNaN(magnetId) || magnetId <= 0) {
    await ctx.reply('⚠️ Noto\'g\'ri material kodi.');
    return;
  }

  const magnet = getMagnet(magnetId);
  if (!magnet) {
    await ctx.reply('Kechirasiz, so\'ralgan material topilmadi yoki o\'chirilgan.');
    return;
  }

  // Check channel subscription
  let isSubscribed = false;
  try {
    const member = await bot.api.getChatMember(config.CHANNEL_USERNAME, ctx.from.id);
    isSubscribed = ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error(`[magnet] getChatMember error for ${ctx.from.id}:`, err.message);
  }

  if (isSubscribed) {
    await deliverMagnetContent(ctx, magnet, bot);
  } else {
    const cleanChannel = config.CHANNEL_USERNAME.replace('@', '');
    const keyboard = new InlineKeyboard()
      .url('📢 Kanalga a\'zo bo\'lish', `https://t.me/${cleanChannel}`)
      .row()
      .text('✅ Tekshirish', `subcheck:m${magnet.id}`);

    await ctx.reply(
      `🔒 <b>To'liq matn kanal obunachilari uchun!</b>\n\n` +
        `"<b>${magnet.title}</b>" materialini olish uchun avval kanalimizga a'zo bo'ling, ` +
        `so'ngra pastdagi <b>"✅ Tekshirish"</b> tugmasini bosing:`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      }
    );
  }
}

/**
 * Handle user clicking "✅ Tekshirish" on subscription gate.
 */
export async function handleSubscriptionCheck(ctx, magnetIdStr, bot) {
  const magnetId = Number(magnetIdStr);
  const magnet = getMagnet(magnetId);

  if (!magnet) {
    await ctx.answerCallbackQuery({ text: 'Material topilmadi.' }).catch(() => {});
    return;
  }

  let isSubscribed = false;
  try {
    const member = await bot.api.getChatMember(config.CHANNEL_USERNAME, ctx.from.id);
    isSubscribed = ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error(`[magnet] subcheck getChatMember error for ${ctx.from.id}:`, err.message);
  }

  if (isSubscribed) {
    await ctx.answerCallbackQuery({ text: '✅ Obuna tasdiqlandi! Material yuborilmoqda…' }).catch(() => {});
    // Remove gate buttons
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
    await deliverMagnetContent(ctx, magnet, bot);
  } else {
    await ctx.answerCallbackQuery({
      text: '❌ Siz hali kanalga a\'zo bo\'lmadingiz. Iltimos, avval kanalga obuna bo\'ling!',
      show_alert: true,
    }).catch(() => {});
  }
}

/**
 * Handle owner /magnitlar command.
 */
export async function handleOwnerMagnitlar(ctx) {
  const magnets = getAllMagnets();

  if (magnets.length === 0) {
    await ctx.reply(
      `📚 <b>Hozircha hech qanday lead magnit yaratilmagan.</b>\n\n` +
        `Yangi lead magnit yaratish uchun: <code>/magnit &lt;mavzu&gt;</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  let text = `📚 <b>Yaratilgan Lead Magnitlar ro'yxati:</b>\n\n`;
  for (const m of magnets) {
    text += `• <b>#${m.id}:</b> ${m.title}\n`;
    text += `  👁️ Ko'rishlar soni: <b>${m.views} ta</b> | 📅 ${m.created_at}\n`;
    text += `  🔗 Deep link: <code>https://t.me/${config.BOT_TOKEN.split(':')[0]}?start=m${m.id}</code>\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
}

/**
 * Split text safely into chunks under maxLength.
 */
function splitText(text, maxLength = 4000) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
