// src/pipeline.js – core orchestration: collect → generate → send draft
import { config } from './config.js';
import { fetchRecentMessages } from './userbot.js';
import { fetchRssItems } from './rss.js';
import { pickStyleSamples } from './styleExamples.js';
import { generatePost, pickCta } from './aiService.js';
import { pickCategory, getCategoryById, getCategoryFeeds } from './topics.js';
import {
  createDraft,
  getDraft,
  updateDraftText,
  updateDraftContext,
  getRecentTopics,
  getStats,
  getLatestMagnet,
} from './db.js';
import { bot, sendDraft, editDraftMessage, notifyOwner } from './bot.js';
import { extractUrl, fetchArticleContent } from './webReader.js';

/** Guard: prevent overlapping pipeline runs */
let _running = false;
let _lastRunTime = 0;
const MANUAL_COOLDOWN_MS = 25 * 1000; // 25 soniyalik cooldown

/**
 * Append deterministic promo line by code every PROMO_EVERY-th post.
 * If a recent lead magnet exists -> points to lead magnet deep link.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
async function appendPromoLineIfNeeded(text) {
  const promoEvery = config.PROMO_EVERY || 3;
  const stats = getStats();
  const nextPostNumber = (stats?.published_count || 0) + 1;

  if (nextPostNumber % promoEvery !== 0) {
    return text;
  }

  const recentMagnet = getLatestMagnet();
  if (!recentMagnet) {
    return text;
  }

  // Get bot username for links
  let botUsername = '';
  try {
    const me = await bot.api.getMe();
    botUsername = me.username;
  } catch {
    botUsername = 'aiSupportBot';
  }

  const promoLine = `🎁 <b>Foydali material:</b> "${recentMagnet.title}" bepul olish uchun → https://t.me/${botUsername}?start=m${recentMagnet.id}`;

  // Avoid duplicate promo lines on rewrites
  if (text.includes('🎁 <b>Foydali material:')) {
    return text;
  }

  const hashtagMatch = text.match(/(?:#[^\s#<]+(?:\s+|$))+$/);
  let result;
  if (hashtagMatch && hashtagMatch.index != null) {
    const beforeHashtags = text.slice(0, hashtagMatch.index).trimEnd();
    const hashtags = text.slice(hashtagMatch.index);
    result = `${beforeHashtags}\n\n${promoLine}\n\n${hashtags}`;
  } else {
    result = `${text.trimEnd()}\n\n${promoLine}`;
  }

  if (result.length > 4000) {
    return text;
  }
  return result;
}

/**
 * The main pipeline. Collects material, generates a post, stores the draft,
 * and sends it to the owner for approval.
 *
 * @param {string} reason – label for logs ("cron" | "manual" | "rewrite" | "switch_category" | "custom_topic")
 * @param {object} [opts]
 * @param {number} [opts.existingDraftId] – if set, regenerate an existing draft
 * @param {string} [opts.feedback]        – owner's feedback text for rewrites
 * @param {string} [opts.customTopic]     – owner's custom topic or article URL
 * @param {string} [opts.forcedCategory]  – forced category ID (e.g. from /generate <category>)
 * @param {boolean} [opts.switchCategory] – true when switching to a different category
 */
export async function runPipeline(reason, opts = {}) {
  if (!config.BLOG_ENABLED) {
    console.log('[pipeline] Blog pipeline is disabled (BLOG_ENABLED=false).');
    if (reason === 'manual' || reason === 'rewrite' || reason === 'switch_category' || reason === 'custom_topic') {
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
    const { existingDraftId, feedback, customTopic, forcedCategory, switchCategory } = opts;

    // ── 1. Determine category ─────────────────────────────────────────────
    let category;
    let storedContext = null;
    let previousDraft = null;

    if (existingDraftId != null) {
      const draft = getDraft(existingDraftId);
      if (draft) {
        previousDraft = draft.text;
        storedContext = draft.context;
        if (switchCategory) {
          // Exclude existing category to guarantee a different one
          const currentCatId = draft.category || storedContext?.category || 'it';
          category = pickCategory(null, { exclude: [currentCatId] });
        } else {
          // Regular rewrite keeps the existing draft's category
          const catId = draft.category || storedContext?.category || 'it';
          category = getCategoryById(catId) || getCategoryById('it');
        }
      } else {
        category = pickCategory(forcedCategory);
      }
    } else {
      category = pickCategory(forcedCategory);
    }

    // ── 2. If custom topic contains a URL, fetch article content ──────────
    let customUrlContent = null;
    if (customTopic) {
      const url = extractUrl(customTopic);
      if (url) {
        customUrlContent = await fetchArticleContent(url);
      }
    }

    // ── 3. Collect material ───────────────────────────────────────────────
    let groupMessages = [];
    let rssItems = [];

    if (!customTopic) {
      if (existingDraftId != null && !switchCategory) {
        // Regular rewrite: reuse stored material
        groupMessages = storedContext?.groupMessages ?? [];
        rssItems = storedContext?.rssItems ?? [];
      } else {
        // New draft or category switch: fetch category-specific sources
        if (category.id === 'it') {
          // IT category: current behavior (public SOURCE_CHATS messages + RSS feeds)
          const [msgs, items] = await Promise.all([
            fetchRecentMessages().catch((err) => {
              console.error('[pipeline] UserBot fetch failed:', err.message ?? err);
              return [];
            }),
            fetchRssItems().catch((err) => {
              console.error('[pipeline] RSS fetch failed:', err.message ?? err);
              return [];
            }),
          ]);
          groupMessages = msgs;
          rssItems = items;
        } else {
          // Non-IT categories: do NOT use userbot messages at all!
          groupMessages = [];
          const catFeeds = getCategoryFeeds(category.id);
          if (catFeeds.length > 0) {
            rssItems = await fetchRssItems(catFeeds).catch((err) => {
              console.error(`[pipeline] RSS fetch failed for category ${category.id}:`, err.message ?? err);
              return [];
            });
          }
        }

        console.log(
          `[pipeline] Category: "${category.id}" — Collected ${groupMessages.reduce((s, g) => s + g.messages.length, 0)} group msg(s), ` +
            `${rssItems.length} RSS item(s).`
        );
      }
    }

    // ── 4. Pick style samples, topics to avoid, CTA ──────────────────────
    const styleSamples = pickStyleSamples(3, category.id);
    const recentTopics = getRecentTopics(15);
    const cta = pickCta();

    // ── 5. Prepare context for AI ─────────────────────────────────────────
    const contextForAI = {
      category,
      groupMessages,
      rssItems,
      styleSamples,
      recentTopics,
      cta,
      previousDraft,
      feedback,
      customTopic: storedContext?.customTopic ?? customTopic,
      customUrlContent: storedContext?.customUrlContent ?? customUrlContent,
    };

    // ── 6. Generate post via AI ───────────────────────────────────────────
    const { topic, text } = await generatePost(contextForAI);
    const postText = await appendPromoLineIfNeeded(text);

    // ── 7. Store or update draft, then present to owner ───────────────────
    if (existingDraftId != null) {
      // Update draft row with new topic, text, and category (increments rewrites counter in DB)
      updateDraftText({
        id: existingDraftId,
        topic,
        text: postText,
        image_path: null,
        category: category.id,
      });

      if (switchCategory) {
        // Update stored context so future rewrites keep the new category and material
        updateDraftContext(existingDraftId, {
          category: category.id,
          groupMessages: contextForAI.groupMessages,
          rssItems: contextForAI.rssItems,
          customTopic: contextForAI.customTopic,
          customUrlContent: contextForAI.customUrlContent,
        });
        // Edit the same message in place
        await editDraftMessage(existingDraftId);
      } else {
        // Regular rewrite: send draft message
        await sendDraft(existingDraftId);
      }
    } else {
      // New draft: persist category and context so rewrites retain it
      const draftId = createDraft({
        topic,
        text: postText,
        image_path: null,
        category: category.id,
        context: {
          category: category.id,
          groupMessages: contextForAI.groupMessages,
          rssItems: contextForAI.rssItems,
          customTopic: contextForAI.customTopic,
          customUrlContent: contextForAI.customUrlContent,
        },
      });
      console.log(`[pipeline] Draft #${draftId} created: "${topic}" [category: ${category.id}]`);
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
