// src/pipeline.js – core orchestration: collect → generate → send draft
import { config } from './config.js';
import { fetchRecentMessages } from './userbot.js';
import { fetchRssItems } from './rss.js';
import { pickStyleSamples } from './styleExamples.js';
import { generatePost, pickCta } from './aiService.js';
import { createDraft, getDraft, updateDraftText, getRecentTopics } from './db.js';
import { bot, sendDraft, notifyOwner } from './bot.js';
import { InlineKeyboard } from 'grammy';

/** Guard: prevent overlapping pipeline runs */
let _running = false;
let _lastRunTime = 0;
const MANUAL_COOLDOWN_MS = 25 * 1000; // 25 soniyalik cooldown

/**
 * The main pipeline. Collects material, generates a post, stores the draft,
 * and sends it to the owner for approval.
 *
 * @param {string} reason – label for logs ("cron" | "manual" | "rewrite")
 * @param {object} [opts]
 * @param {number} [opts.existingDraftId] – if set, regenerate an existing draft
 * @param {string} [opts.feedback]        – owner's feedback text for rewrites
 */
export async function runPipeline(reason, opts = {}) {
  if (!config.BLOG_ENABLED) {
    console.log('[pipeline] Blog pipeline is disabled (BLOG_ENABLED=false).');
    if (reason === 'manual' || reason === 'rewrite') {
      await notifyOwner('⚠️ Blog pipeline o\'chirilgan (BLOG_ENABLED=false).');
    }
    return;
  }

  if (_running) {
    console.warn('[pipeline] Already running — skipping duplicate trigger.');
    await notifyOwner(
      '⏳ <b>Post yaratish jarayoni allaqachon ketmoqda!</b>\n\n' +
        'AI yangiliklarni yig\'ib, qoralama tayyorlamoqda. Iltimos, biroz kuting.'
    );
    return;
  }

  // Ketma-ket tez bosilganda cooldown
  if (reason === 'manual' && Date.now() - _lastRunTime < MANUAL_COOLDOWN_MS) {
    const remainSec = Math.ceil((MANUAL_COOLDOWN_MS - (Date.now() - _lastRunTime)) / 1000);
    await notifyOwner(
      `⏳ <b>Iltimos, biroz kuting!</b>\n\n` +
        `Yangi post yaqinda yaratildi. Gemini API cheklovlariga (503/429) tushmaslik uchun keyingi so'rovni <b>${remainSec} soniyadan</b> keyin yuborishingiz mumkin.`
    );
    return;
  }

  _running = true;
  console.log(`[pipeline] Starting (reason: ${reason})…`);

  try {
    const { existingDraftId, feedback } = opts;

    // ── 1. Collect material ──────────────────────────────────────────────
    // Run UserBot and RSS fetch in parallel; each failure → empty array
    const [groupMessages, rssItems] = await Promise.all([
      fetchRecentMessages().catch((err) => {
        console.error('[pipeline] UserBot fetch failed:', err.message ?? err);
        return [];
      }),
      fetchRssItems().catch((err) => {
        console.error('[pipeline] RSS fetch failed:', err.message ?? err);
        return [];
      }),
    ]);

    console.log(
      `[pipeline] Collected ${groupMessages.reduce((s, g) => s + g.messages.length, 0)} group msg(s), ` +
        `${rssItems.length} RSS item(s).`
    );

    // ── 2. Pick style samples, topics to avoid, CTA ──────────────────────
    const styleSamples = pickStyleSamples(3);
    const recentTopics = getRecentTopics(15);
    const cta = pickCta();

    // ── 3. Get previous draft context (for rewrites) ──────────────────────
    let previousDraft;
    let storedContext;

    if (existingDraftId != null) {
      const draft = getDraft(existingDraftId);
      if (draft) {
        previousDraft = draft.text;
        // Re-use the original context so the model sees the same material
        storedContext = draft.context;
      }
    }

    // The context to pass to Gemini (and to store with the draft)
    const contextForAI = {
      groupMessages: storedContext?.groupMessages ?? groupMessages,
      rssItems: storedContext?.rssItems ?? rssItems,
      styleSamples,
      recentTopics,
      cta,
      previousDraft,
      feedback,
    };

    // ── 4. Generate post via Gemini ───────────────────────────────────────
    const { topic, text } = await generatePost(contextForAI);

    // ── 5. Store or update draft, then send to owner ──────────────────────
    if (existingDraftId != null) {
      // Rewrite: update the existing row (rewrite counter is incremented in DB)
      updateDraftText({ id: existingDraftId, topic, text });

      // Edit the owner's existing message in-place via the bot
      const draft = getDraft(existingDraftId);
      if (draft?.message_id) {
        try {
          const keyboard = new InlineKeyboard()
            .text('✅ Tasdiqlash va chiqarish', `ok:${existingDraftId}`)
            .text('🔄 Qayta yozish', `rw:${existingDraftId}`);

          await bot.api.editMessageText(config.MY_CHAT_ID, draft.message_id, text, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
          });
          console.log(`[pipeline] Draft #${existingDraftId} rewritten and message edited.`);
        } catch (editErr) {
          console.error('[pipeline] Could not edit owner message:', editErr.message);
          // Fall back to sending a new message
          await sendDraft(existingDraftId);
        }
      } else {
        await sendDraft(existingDraftId);
      }
    } else {
      // New draft: persist context so rewrites can reuse it
      const draftId = createDraft({
        topic,
        text,
        context: {
          groupMessages: contextForAI.groupMessages,
          rssItems: contextForAI.rssItems,
        },
      });
      console.log(`[pipeline] Draft #${draftId} created: "${topic}"`);
      await sendDraft(draftId);
    }
  } catch (err) {
    console.error('[pipeline] Fatal error:', err.message ?? err, err.stack ?? '');
    const msg = String(err.message ?? err);

    if (
      msg.includes('503') ||
      msg.includes('high demand') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('rate limit')
    ) {
      await notifyOwner(
        '⏳ <b>Sun\'iy intellekt (Gemini) ayni daqiqada band!</b>\n\n' +
          'Ketma-ket so\'rovlar yoki Google serverlaridagi yuqori yuklama sababli post yaratish vaqtincha to\'xtatildi.\n\n' +
          '💡 <i>Iltimos, 1-2 daqiqa kuting va qaytadan urinib ko\'ring.</i>'
      );
    } else {
      await notifyOwner(`❌ <b>Pipeline xatosi (${reason}):</b>\n<code>${msg.slice(0, 300)}</code>`);
    }
  } finally {
    _running = false;
    _lastRunTime = Date.now();
  }
}


