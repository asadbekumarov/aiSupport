// src/digest.js – Personal Digest Agent orchestration
// Scans owner's Telegram dialogs (channels, groups, private chats),
// runs privacy-preserving Gemini analysis, and sends a private report to MY_CHAT_ID.
import { config } from './config.js';
import { getKv, setKv } from './db.js';
import { collectDigestMaterial } from './userbot.js';
import { analyzePublicChats, analyzePrivateChats } from './digestAi.js';
import { bot } from './bot.js';

let _running = false;

/**
 * Escape HTML special characters for Telegram HTML mode.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Normalizes text so the owner is addressed as 'Siz', not 'foydalanuvchi' or by 3rd-person name.
 * @param {string} text
 * @returns {string}
 */
function formatForOwner(text) {
  if (!text) return '';
  return String(text)
    .replace(/\bAsadbekdan\b/gi, 'Sizdan')
    .replace(/\bAsadbekga\b/gi, 'Sizga')
    .replace(/\bAsadbekka\b/gi, 'Sizga')
    .replace(/\bAsadbekda\b/gi, 'Sizda')
    .replace(/\bAsadbekni\b/gi, 'Sizni')
    .replace(/\bAsadbekning\b/gi, 'Sizning')
    .replace(/\bAsadbek\b/gi, 'Siz')
    .replace(/\bfoydalanuvchidan\b/gi, 'Sizdan')
    .replace(/\bfoydalanuvchiga\b/gi, 'Sizga')
    .replace(/\bfoydalanuvchida\b/gi, 'Sizda')
    .replace(/\bfoydalanuvchini\b/gi, 'Sizni')
    .replace(/\bfoydalanuvchining\b/gi, 'Sizning')
    .replace(/\bfoydalanuvchi\b/gi, 'Siz');
}

/**
 * Split section blocks into Telegram-safe messages under 4000 characters.
 * @param {string} header
 * @param {string[]} sections
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitIntoMessages(header, sections, maxLen = 3900) {
  const messages = [];
  let current = header;

  for (const section of sections) {
    if (!section || !section.trim()) continue;

    if ((current + '\n\n' + section).length <= maxLen) {
      current = current ? `${current}\n\n${section}` : section;
    } else {
      if (current.trim()) {
        messages.push(current.trim());
        current = '';
      }
      if (section.length <= maxLen) {
        current = section;
      } else {
        const parts = section.split('\n\n');
        for (const part of parts) {
          if ((current + '\n\n' + part).length <= maxLen) {
            current = current ? `${current}\n\n${part}` : part;
          } else {
            if (current.trim()) messages.push(current.trim());
            current = part;
          }
        }
      }
    }
  }

  if (current.trim()) {
    messages.push(current.trim());
  }

  return messages;
}

let _runningStartTime = 0;

/**
 * Execute the Personal Digest pipeline.
 *
 * @param {string} reason – "cron" | "manual"
 */
export async function runDigest(reason = 'manual', opts = {}) {
  const scope = opts.scope ?? 'all';

  // If running for more than 3 minutes, assume previous execution hung and reset lock
  if (_running && Date.now() - _runningStartTime > 180000) {
    console.warn('[digest] Lock timeout exceeded (3 min) — resetting _running lock.');
    _running = false;
  }

  if (_running) {
    console.warn(`[digest] Already running — skipping duplicate trigger (${reason}, scope: ${scope}).`);
    try {
      await bot.api.sendMessage(
        config.MY_CHAT_ID,
        `⏳ <b>Dayjest allaqachon hisoblanmoqda!</b>\nIltimos, ozgina kuting, hisobot tayyorlanmoqda…`,
        { parse_mode: 'HTML' }
      );
    } catch {}
    return;
  }

  _running = true;
  _runningStartTime = Date.now();
  console.log(`[digest] Starting Personal Digest pipeline (reason: ${reason}, scope: ${scope})…`);

  try {
    const runStartTime = Math.floor(Date.now() / 1000);

    // Calculate cutoff time: max(lastDigestTime, now - DIGEST_MAX_DAYS)
    const maxLookbackSec = runStartTime - config.DIGEST_MAX_DAYS * 86400;
    const lastTimeStr = getKv('lastDigestTime');
    let sinceUnix = maxLookbackSec;
    if (lastTimeStr) {
      const parsedLast = Number(lastTimeStr);
      if (!isNaN(parsedLast) && parsedLast > 0) {
        sinceUnix = Math.max(parsedLast, maxLookbackSec);
      }
    }

    console.log(
      `[digest] Looking back since ${new Date(sinceUnix * 1000).toLocaleString('uz-UZ', {
        timeZone: config.TIMEZONE,
      })} (sinceUnix: ${sinceUnix})`
    );

    // Collect material from UserBot according to scope
    const { material, lookup } = await collectDigestMaterial(sinceUnix, scope);

    if (!material || material.length === 0) {
      console.log('[digest] No active messages found in lookback window.');
      await bot.api.sendMessage(config.MY_CHAT_ID, 'Yangi muhim xabarlar topilmadi ✅');
      setKv('lastDigestTime', String(runStartTime));
      return;
    }

    if (reason === 'manual') {
      try {
        await bot.api.sendMessage(
          config.MY_CHAT_ID,
          `🤖 <i>${material.length} ta chatdan yangi xabarlar olindi. AI hisobotni shakllantirmoqda…</i>`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    }

    // Separate material into public (channels & groups) and private (user chats)
    const publicMaterial = material.filter(
      (m) => m.type === 'channel' || m.type === 'group'
    );
    const privateMaterial = material.filter((m) => m.type === 'private');

    console.log(
      `[digest] Material partitioned: ${publicMaterial.length} public chat(s), ${privateMaterial.length} private chat(s).`
    );

    // Run only necessary calls depending on scope
    const needPublic = scope === 'all' || scope === 'channels' || scope === 'groups';
    const needPrivate = scope === 'all' || scope === 'users';

    const [publicResult, privateResult] = await Promise.all([
      needPublic && publicMaterial.length > 0
        ? analyzePublicChats(publicMaterial, lookup).catch((err) => {
            console.error('[digest] Call A (Public) error:', err.message ?? err);
            return { chats: [], for_me: [], trends: [] };
          })
        : Promise.resolve({ chats: [], for_me: [], trends: [] }),
      needPrivate && privateMaterial.length > 0
        ? analyzePrivateChats(privateMaterial, lookup).catch((err) => {
            console.error('[digest] Call B (Private) error:', err.message ?? err);
            return { important: [], suspicious: [], need_reply: [] };
          })
        : Promise.resolve({ important: [], suspicious: [], need_reply: [] }),
    ]);

    const hasConversations = privateResult.conversations?.length > 0;
    const hasImportant = privateResult.important?.length > 0;
    const hasSuspicious = privateResult.suspicious?.length > 0;
    const hasNeedReply = privateResult.need_reply?.length > 0;
    const hasForMe = publicResult.for_me?.length > 0;
    const hasChats = publicResult.chats?.length > 0;
    const hasTrends = publicResult.trends?.length > 0;

    const hasAnyContent =
      hasConversations ||
      hasImportant ||
      hasSuspicious ||
      hasNeedReply ||
      hasForMe ||
      hasChats ||
      hasTrends;

    if (!hasAnyContent) {
      console.log('[digest] Analysis complete: nothing noteworthy found.');
      await bot.api.sendMessage(config.MY_CHAT_ID, 'Yangi muhim narsa yo\'q ✅');
      setKv('lastDigestTime', String(runStartTime));
      return;
    }

    // Build the Report in Telegram HTML format
    const sectionBlocks = [];

    // 1. 🔥 Muhim
    if (hasImportant) {
      const lines = ['🔥 <b>Muhim</b>\n'];
      for (const item of privateResult.important) {
        const msgInfo = lookup.messages.get(item.msg);
        const chatInfo = msgInfo ? lookup.chats.get(msgInfo.chatRef) : null;
        const chatTitle = chatInfo?.title || 'Shaxsiy chat';
        const quote = (msgInfo?.originalText || '').slice(0, 200);
        const link = msgInfo?.link || '';

        lines.push(
          `• <b>${escapeHtml(chatTitle)}</b>: ${escapeHtml(formatForOwner(item.why))}\n` +
            (quote ? `<blockquote>${escapeHtml(quote)}</blockquote>\n` : '') +
            (link ? `🔗 <a href="${escapeHtml(link)}">Xabarga o'tish ↗</a>\n` : '')
        );
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // 2. ⚠️ Shubhali
    if (hasSuspicious) {
      const lines = ['⚠️ <b>Shubhali</b>\n'];
      for (const item of privateResult.suspicious) {
        const msgInfo = lookup.messages.get(item.msg);
        const chatInfo = msgInfo ? lookup.chats.get(msgInfo.chatRef) : null;
        const chatTitle = chatInfo?.title || 'Suhbatdosh';
        const quote = (msgInfo?.originalText || '').slice(0, 200);
        const link = msgInfo?.link || '';

        const emoji =
          item.risk === 'high' ? '🔴' : item.risk === 'low' ? '🟡' : '🟠';

        lines.push(
          `• ${emoji} <b>${escapeHtml(chatTitle)}</b>: ${escapeHtml(formatForOwner(item.why))}\n` +
            (quote ? `<blockquote>${escapeHtml(quote)}</blockquote>\n` : '') +
            `💡 <i>Eslatma: tekshirib ko'ring, kod/pul yubormang</i>\n` +
            (link ? `🔗 <a href="${escapeHtml(link)}">Xabarga o'tish ↗</a>\n` : '')
        );
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // 3. 💬 Javob kutilmoqda
    if (hasNeedReply) {
      const lines = ['💬 <b>Javob kutilmoqda</b>\n'];
      for (const item of privateResult.need_reply) {
        const msgInfo = lookup.messages.get(item.msg);
        const chatInfo = msgInfo ? lookup.chats.get(msgInfo.chatRef) : null;
        const chatTitle = chatInfo?.title || 'Suhbatdosh';
        const quote = (msgInfo?.originalText || '').slice(0, 200);
        const link = msgInfo?.link || '';

        lines.push(
          `• <b>${escapeHtml(chatTitle)}</b>: ${escapeHtml(formatForOwner(item.why))}\n` +
            (quote ? `<blockquote>${escapeHtml(quote)}</blockquote>\n` : '') +
            (link ? `🔗 <a href="${escapeHtml(link)}">Xabarga o'tish ↗</a>\n` : '')
        );
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // 4. 👤 Shaxsiy yozishmalar (odamlar bilan suhbatlar)
    if (hasConversations) {
      const lines = ['👤 <b>Shaxsiy yozishmalar (odamlar bilan)</b>\n'];
      for (const conv of privateResult.conversations) {
        const chatInfo = lookup.chats.get(conv.ref);
        const chatTitle = chatInfo?.title || 'Suhbatdosh';
        const chatLink = chatInfo?.link || '';

        const titleText = chatLink
          ? `<a href="${escapeHtml(chatLink)}"><b>${escapeHtml(chatTitle)}</b></a>`
          : `<b>${escapeHtml(chatTitle)}</b>`;

        lines.push(`• ${titleText}:`);
        if (conv.summary) {
          lines.push(`  💬 <i>${escapeHtml(formatForOwner(conv.summary))}</i>`);
        }
        for (const kp of conv.key_points || []) {
          lines.push(`  – ${escapeHtml(formatForOwner(kp))}`);
        }
        lines.push('');
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // Separate groups and channels from Call A
    const groupChats = (publicResult.chats || []).filter(
      (c) => lookup.chats.get(c.ref)?.type === 'group'
    );
    const channelChats = (publicResult.chats || []).filter(
      (c) => lookup.chats.get(c.ref)?.type === 'channel'
    );

    // 5. 👥 Guruhlar muhokamasi
    if (groupChats.length > 0) {
      const lines = ['👥 <b>Guruhlar muhokamasi</b>\n'];
      for (const c of groupChats) {
        const chatInfo = lookup.chats.get(c.ref);
        const chatTitle = chatInfo?.title || c.ref;
        const chatLink = chatInfo?.link || '';

        const titleText = chatLink
          ? `<a href="${escapeHtml(chatLink)}"><b>${escapeHtml(chatTitle)}</b></a>`
          : `<b>${escapeHtml(chatTitle)}</b>`;

        lines.push(`• ${titleText}:`);
        for (const topic of c.topics || []) {
          lines.push(`   – ${escapeHtml(formatForOwner(topic))}`);
        }
        lines.push('');
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // 6. 📢 Kanallar yangiliklari
    if (channelChats.length > 0) {
      const lines = ['📢 <b>Kanallar yangiliklari</b>\n'];
      for (const c of channelChats) {
        const chatInfo = lookup.chats.get(c.ref);
        const chatTitle = chatInfo?.title || c.ref;
        const chatLink = chatInfo?.link || '';

        const titleText = chatLink
          ? `<a href="${escapeHtml(chatLink)}"><b>${escapeHtml(chatTitle)}</b></a>`
          : `<b>${escapeHtml(chatTitle)}</b>`;

        lines.push(`• ${titleText}:`);
        for (const topic of c.topics || []) {
          lines.push(`   – ${escapeHtml(formatForOwner(topic))}`);
        }
        lines.push('');
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // 7. 🎯 Sizga kerakli
    if (hasForMe) {
      const lines = ['🎯 <b>Sizga kerakli</b>\n'];
      for (const item of publicResult.for_me) {
        const msgInfo = lookup.messages.get(item.msg);
        const chatInfo = msgInfo ? lookup.chats.get(msgInfo.chatRef) : null;
        const chatTitle = chatInfo?.title || 'Kanal/Guruh';
        const link = msgInfo?.link || '';

        lines.push(
          `• <b>${escapeHtml(chatTitle)}</b>: ${escapeHtml(formatForOwner(item.why))}\n` +
            (link ? `🔗 <a href="${escapeHtml(link)}">Xabarga o'tish ↗</a>\n` : '')
        );
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    // 8. 📈 Umumiy trendlar
    if (hasTrends) {
      const lines = ['📈 <b>Umumiy trendlar</b>\n'];
      for (const trend of publicResult.trends) {
        lines.push(`• ${escapeHtml(formatForOwner(trend))}`);
      }
      sectionBlocks.push(lines.join('\n').trim());
    }

    let scopeTitle = '📋 <b>Shaxsiy Telegram Dayjest</b>';
    if (scope === 'users') scopeTitle = '👤 <b>Shaxsiy Yozishmalar (Userlar) Dayjesti</b>';
    else if (scope === 'groups') scopeTitle = '👥 <b>Guruhlar bo\'yicha Dayjest</b>';
    else if (scope === 'channels') scopeTitle = '📢 <b>Kanallar bo\'yicha Dayjest</b>';

    const header =
      `${scopeTitle}\n` +
      `<i>${new Date().toLocaleString('uz-UZ', { timeZone: config.TIMEZONE })}</i>\n` +
      `──────────────────`;

    const messages = splitIntoMessages(header, sectionBlocks, 3900);

    console.log(`[digest] Sending report in ${messages.length} message(s) to MY_CHAT_ID…`);

    for (const msg of messages) {
      try {
        await bot.api.sendMessage(config.MY_CHAT_ID, msg, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (sendErr) {
        console.error('[digest] Failed to send HTML message:', sendErr.message ?? sendErr);
        // Fallback without parse_mode if entity fails
        await bot.api.sendMessage(config.MY_CHAT_ID, msg.replace(/<[^>]+>/g, ''), {
          link_preview_options: { is_disabled: true },
        });
      }
    }

    // Update lastDigestTime only after successful delivery
    setKv('lastDigestTime', String(runStartTime));
    console.log(`[digest] Personal Digest finished successfully. lastDigestTime=${runStartTime}`);
  } catch (err) {
    console.error('[digest] Fatal error in runDigest:', err.message ?? err, err.stack ?? '');
    const msg = String(err.message ?? err);

    let friendly = `❌ <b>Dayjest tayyorlashda xatolik yuz berdi:</b>\n<code>${msg.slice(0, 300)}</code>`;
    if (
      msg.includes('503') ||
      msg.includes('high demand') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('rate limit')
    ) {
      friendly =
        '⏳ <b>Sun\'iy intellekt (Gemini) ayni paytda band!</b>\n\n' +
        'Dayjest uchun so\'rovlar ko\'p bo\'lgani sababli Google serveri vaqtinchalik yuklamaga tushdi.\n\n' +
        '💡 <i>Iltimos, 1-2 daqiqa kuting va qaytadan /digest buyrug\'ini yuboring.</i>';
    }

    try {
      await bot.api.sendMessage(config.MY_CHAT_ID, friendly, { parse_mode: 'HTML' });
    } catch {}
  } finally {
    _running = false;
  }
}
