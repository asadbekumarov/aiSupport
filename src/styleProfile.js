// src/styleProfile.js – computes local statistics and manages Gemini-generated style guides per category
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { config, getCategoryStyleChannels } from './config.js';
import {
  getAllSamples,
  refreshStyleSources,
  getCategoryChannelMap,
  getStyleCounts,
} from './styleSources.js';
import { stripTags } from './format.js';

mkdirSync(config.STYLE_DIR, { recursive: true });

/**
 * Returns the guide cache file path for a category or general guide.
 * @param {string} [category]
 * @returns {string}
 */
export function getGuideFilePath(category) {
  if (category && category !== 'general' && category !== 'all') {
    return join(config.STYLE_DIR, `guide.${category.toLowerCase()}.json`);
  }
  return join(config.STYLE_DIR, 'guide.json');
}

/**
 * Compute local statistics for an array of sample texts without AI.
 *
 * @param {Array<string|{ text: string }>} samples
 * @returns {object}
 */
export function computeStats(samples = []) {
  const texts = (samples || [])
    .map((s) => (typeof s === 'string' ? s : s?.text || ''))
    .filter((t) => t.trim().length > 0);

  if (texts.length === 0) {
    return {
      sampleCount: 0,
      avgSentenceLength: 9.5,
      medianSentenceLength: 9.0,
      sentenceStdDev: 4.8,
      avgParagraphs: 4.2,
      avgPostLength: 750,
      emojisPerPost: 3.2,
      emojiPlacement: { lineStart: 0.8, inline: 1.8, lineEnd: 0.6 },
      exclamationsPerPost: 0.9,
      questionsPerPost: 0.8,
      hashtagsPerPost: 2.1,
      boldShare: 0.85,
      bulletShare: 0.25,
      emDashShare: 0.05,
      avgFirstLineLength: 38,
      foreignWordShare: 0.12,
      endsWithQuestionShare: 0.35,
    };
  }

  const allSentenceLengths = [];
  let totalParagraphs = 0;
  let totalChars = 0;
  let totalEmojis = 0;
  let totalEmojiLineStart = 0;
  let totalEmojiInline = 0;
  let totalEmojiLineEnd = 0;
  let totalExclamations = 0;
  let totalQuestions = 0;
  let totalHashtags = 0;
  let postsWithBold = 0;
  let postsWithBullets = 0;
  let postsWithEmDash = 0;
  let totalFirstLineLength = 0;
  let totalForeignWordRatio = 0;
  let postsEndingWithQuestion = 0;

  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const hashtagRegex = /#[\p{L}\w_-]+/gu;

  for (const rawText of texts) {
    const plain = stripTags(rawText);
    totalChars += rawText.length;

    // 1. Sentences
    const sentences = plain
      .split(/[.!?]+(?:\s+|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sent of sentences) {
      const words = sent.split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        allSentenceLengths.push(words.length);
      }
    }

    // 2. Paragraphs (non-empty lines or blocks)
    const paragraphs = rawText
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    totalParagraphs += Math.max(1, paragraphs.length);

    // 3. First line length
    if (paragraphs.length > 0) {
      totalFirstLineLength += stripTags(paragraphs[0]).length;
    }

    // 4. Emojis and placement
    const postEmojis = rawText.match(emojiRegex) || [];
    totalEmojis += postEmojis.length;

    const lines = rawText.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const trimmed = line.trim();
      const lineEmojis = trimmed.match(emojiRegex);
      if (!lineEmojis) continue;

      const startsWithEmoji = /^\p{Extended_Pictographic}/u.test(trimmed);
      const endsWithEmoji = /\p{Extended_Pictographic}$/u.test(trimmed);

      if (startsWithEmoji) totalEmojiLineStart += 1;
      if (endsWithEmoji) totalEmojiLineEnd += 1;
      if (!startsWithEmoji && !endsWithEmoji) totalEmojiInline += lineEmojis.length;
    }

    // 5. Punctuation
    totalExclamations += (rawText.match(/!/g) || []).length;
    totalQuestions += (rawText.match(/\?/g) || []).length;
    totalHashtags += (rawText.match(hashtagRegex) || []).length;

    // 6. Formatting shares
    if (/<b>|<strong>|\*\*/i.test(rawText)) postsWithBold++;
    if (/^[ \t]*(?:[•\-*]|\d+\.)\s+/m.test(rawText)) postsWithBullets++;
    if (/[—–]/.test(rawText)) postsWithEmDash++;

    // 7. English/Russian words ratio
    const allWords = plain.split(/\s+/).filter(Boolean);
    const foreignWords = allWords.filter((w) =>
      /[a-zA-Z]{3,}|[\u0400-\u04FF]{3,}/.test(w)
    );
    if (allWords.length > 0) {
      totalForeignWordRatio += foreignWords.length / allWords.length;
    }

    // 8. Ends with question
    const lastLine = paragraphs[paragraphs.length - 1] || '';
    if (lastLine.endsWith('?') || lastLine.includes('?')) {
      postsEndingWithQuestion++;
    }
  }

  const n = texts.length;

  allSentenceLengths.sort((a, b) => a - b);
  const totalSentences = allSentenceLengths.length || 1;
  const avgSentenceLength =
    allSentenceLengths.reduce((acc, len) => acc + len, 0) / totalSentences;

  const mid = Math.floor(allSentenceLengths.length / 2);
  const medianSentenceLength =
    allSentenceLengths.length === 0
      ? 9
      : allSentenceLengths.length % 2 !== 0
      ? allSentenceLengths[mid]
      : (allSentenceLengths[mid - 1] + allSentenceLengths[mid]) / 2;

  const variance =
    allSentenceLengths.reduce((acc, len) => acc + Math.pow(len - avgSentenceLength, 2), 0) /
    totalSentences;
  const sentenceStdDev = Math.sqrt(variance);

  return {
    sampleCount: n,
    avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
    medianSentenceLength: Number(medianSentenceLength.toFixed(1)),
    sentenceStdDev: Number(sentenceStdDev.toFixed(1)),
    avgParagraphs: Number((totalParagraphs / n).toFixed(1)),
    avgPostLength: Math.round(totalChars / n),
    emojisPerPost: Number((totalEmojis / n).toFixed(1)),
    emojiPlacement: {
      lineStart: Number((totalEmojiLineStart / n).toFixed(1)),
      inline: Number((totalEmojiInline / n).toFixed(1)),
      lineEnd: Number((totalEmojiLineEnd / n).toFixed(1)),
    },
    exclamationsPerPost: Number((totalExclamations / n).toFixed(1)),
    questionsPerPost: Number((totalQuestions / n).toFixed(1)),
    hashtagsPerPost: Number((totalHashtags / n).toFixed(1)),
    boldShare: Number((postsWithBold / n).toFixed(2)),
    bulletShare: Number((postsWithBullets / n).toFixed(2)),
    emDashShare: Number((postsWithEmDash / n).toFixed(2)),
    avgFirstLineLength: Math.round(totalFirstLineLength / n),
    foreignWordShare: Number((totalForeignWordRatio / n).toFixed(2)),
    endsWithQuestionShare: Number((postsEndingWithQuestion / n).toFixed(2)),
  };
}

/**
 * Combine brand and voice stats into a single target.
 * Voice stats have priority wherever voice samples exist.
 *
 * @param {object} brandStats
 * @param {object} voiceStats
 * @returns {object}
 */
export function combineTargets(brandStats, voiceStats) {
  if (voiceStats?.sampleCount > 0) {
    return {
      ...brandStats,
      ...voiceStats,
      sentenceStdDev: Math.max(3.5, voiceStats.sentenceStdDev || brandStats.sentenceStdDev),
      priority: 'voice',
    };
  }
  return {
    ...brandStats,
    priority: 'brand',
  };
}

/**
 * Ask Gemini ONCE to produce a concise Uzbek style guide JSON.
 * Caches per category in data/style/guide.<category>.json or general data/style/guide.json.
 *
 * @param {Array<string|{ text: string, source: string }>} samples
 * @param {object} [options]
 * @param {string} [options.category]
 * @param {boolean} [options.force]
 * @returns {Promise<object>}
 */
export async function buildStyleGuide(samples = [], { category, force = false } = {}) {
  const guideFile = getGuideFilePath(category);

  if (!force && existsSync(guideFile)) {
    try {
      const cached = JSON.parse(readFileSync(guideFile, 'utf8'));
      if (cached && cached.tone && cached.rules_do_dont) {
        return cached;
      }
    } catch (err) {
      console.warn(`[styleProfile] Corrupted guide cache ${guideFile}, regenerating:`, err.message);
    }
  }

  const sampleTexts = samples
    .map((s) => (typeof s === 'string' ? s : s?.text || ''))
    .filter((t) => t.trim().length > 0)
    .slice(0, 15);

  const catLabel = category ? `[kategoriya: ${category}]` : '[umumiy]';

  // If no samples at all, return default high-quality guide
  if (sampleTexts.length === 0) {
    const defaultGuide = {
      tone: "Samimiy, do'stona, texnik jihatdan aniq, ortiqcha pafossiz suhbatdosh ohang",
      sentence_rhythm: "Qisqa (2-5 so'z) va o'rtacha gaplar almashinuvi, dinamik ritm",
      openings: [
        "To'g'ridan-to'g'ri yangilik yoki hodisa bilan boshlash",
        "Qiziqarli savol yoki kutilmagan fakt bilan boshlash",
        "Shaxsiy kuzatuv yoki sohadagi og'riqli nuqta bilan ochish",
      ],
      closings: [
        "O'quvchini fikrlashga undovchi ochiq savol",
        "Amaliy tavsiya yoki do'stlarga ulashish taklifi",
      ],
      vocabulary_and_connectors: [
        "Xullas", "Aslida", "Eng qizig'i", "Gap shundaki", "Aytmoqchi",
      ],
      formatting_habits: "Faqat sarlavha va eng muhim 1-2 iborani qalin qilish, emoji me'yorida (2-4 ta), em-dash (—) ishlatmaslik",
      never_do: [
        "Xulosa qilib aytganda kabi shablon so'zlar",
        "Har bir qatorni emoji bilan boshlash",
        "Sun'iy shaxsiy tajriba to'qish",
        "A, B va C uchtalik qolipini takrorlash",
      ],
      rules_do_dont: [
        { do: "Aniq misol, nom va raqam keltir", dont: "Umumiy mavhum gaplar yozma" },
        { do: "Gap uzunligini xilma-xil qil", dont: "Hamma gapni bir xil o'lchamda tuzma" },
        { do: "Texnik atamalarni inglizcha qoldir", dont: "G'aliz kitobiy tarjima qilma" },
        { do: "Oxirini yumshoq tugat", dont: "'Xulosa' deb alohida abzats ochma" },
        { do: "Samimiy birinchi yoki ikkinchi shaxsda gapir", dont: "Rasmiy axborot byurosi tilida yozma" },
      ],
    };
    writeFileSync(guideFile, JSON.stringify(defaultGuide, null, 2), 'utf8');
    return defaultGuide;
  }

  console.log(`[styleProfile] Generating style guide ${catLabel} via Gemini from ${sampleTexts.length} samples…`);

  try {
    const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    const model = config.GEMINI_MODEL || 'gemini-3.5-flash';

    const prompt = `Quyida Telegram kanallari mualliflarining ${sampleTexts.length} ta yozish namunasi berilgan ${catLabel}.
Namunalarni diqqat bilan o'rganib chiq. Mualliflarning haqiqiy uslubini tahlil qil va faqat quyidagi tuzilishdagi JSON formatda javob ber (boshqa hech qanday so'z yoki markdown blok bo'lmasin):

{
  "tone": "<ohang tavsifi>",
  "sentence_rhythm": "<gaplar ritmi va dinamikasi>",
  "openings": [
    "<1-boshlanish qolipi>",
    "<2-boshlanish qolipi>",
    "<3-boshlanish qolipi>"
  ],
  "closings": [
    "<1-yakunlash qolipi>",
    "<2-yakunlash qolipi>"
  ],
  "vocabulary_and_connectors": [
    "<xarakterli so'z/bog'lovchi 1>",
    "<xarakterli so'z/bog'lovchi 2>",
    "<xarakterli so'z/bog'lovchi 3>",
    "<xarakterli so'z/bog'lovchi 4>",
    "<xarakterli so'z/bog'lovchi 5>"
  ],
  "formatting_habits": "<formatlash, bold, emoji odatlari>",
  "never_do": [
    "<bu mualliflar HECH QACHON qilmaydigan 1-odati>",
    "<bu mualliflar HECH QACHON qilmaydigan 2-odati>",
    "<bu mualliflar HECH QACHON qilmaydigan 3-odati>"
  ],
  "rules_do_dont": [
    { "do": "<bajarish kerak 1>", "dont": "<qilmaslik kerak 1>" },
    { "do": "<bajarish kerak 2>", "dont": "<qilmaslik kerak 2>" },
    { "do": "<bajarish kerak 3>", "dont": "<qilmaslik kerak 3>" },
    { "do": "<bajarish kerak 4>", "dont": "<qilmaslik kerak 4>" },
    { "do": "<bajarish kerak 5>", "dont": "<qilmaslik kerak 5>" }
  ]
}

NAMUNALAR:
${sampleTexts.map((s, i) => `--- NAMUNA #${i + 1} ---\n${s}`).join('\n\n')}`;

    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    });

    const responseText = res.text?.trim() || '{}';
    const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const guide = JSON.parse(cleanJson);

    writeFileSync(guideFile, JSON.stringify(guide, null, 2), 'utf8');
    console.log(`[styleProfile] Cached guide at ${guideFile}`);
    return guide;
  } catch (err) {
    console.warn(`[styleProfile] Gemini guide generation failed for ${catLabel}:`, err.message);
    if (existsSync(guideFile)) {
      try {
        return JSON.parse(readFileSync(guideFile, 'utf8'));
      } catch (_) {}
    }
    return {
      tone: "Jonli, do'stona, texnik va ixcham",
      sentence_rhythm: "Qisqa va uzun gaplar aralash",
      openings: ["Voqea yoki fakt bilan", "Savol bilan", "Fikr bilan"],
      closings: ["Savol yoki do'stona chaqiriq"],
      vocabulary_and_connectors: ["Xullas", "Aslida", "Aytmoqchi"],
      formatting_habits: "Qalin sarlavha, me'yorida emoji",
      never_do: ["Xulosa qilib aytganda", "Em-dash", "Shablon ro'yxatlar"],
      rules_do_dont: [
        { do: "Aniq yoz", dont: "Umumiy gapir" },
        { do: "Gap uzunligini o'zgartir", dont: "Bir xil qolipda yozma" },
      ],
    };
  }
}

/**
 * Load complete style profile for a specific category or general.
 *
 * @param {object} [options]
 * @param {string} [options.category]
 * @param {boolean} [options.refresh]
 * @returns {Promise<{
 *   category: string,
 *   brandStats: object,
 *   voiceStats: object,
 *   targetStats: object,
 *   guide: object
 * }>}
 */
export async function getStyleProfile({ category = 'it', refresh = false } = {}) {
  const catId = typeof category === 'string' ? category : category?.id || 'it';
  const { brand, voice } = await getAllSamples({ category: catId });

  const brandStats = computeStats(brand);
  const voiceStats = computeStats(voice);
  const targetStats = combineTargets(brandStats, voiceStats);

  const combinedSamples = [...voice, ...brand];
  const guide = await buildStyleGuide(combinedSamples, { category: catId, force: refresh });

  return {
    category: catId,
    brandStats,
    voiceStats,
    targetStats,
    guide,
  };
}

/**
 * Rebuild caches and style guide for one category, or for all categories if none specified.
 *
 * @param {string} [category] – specific category id or null/undefined for all
 * @returns {Promise<object>}
 */
export async function rebuildStyleProfile(category) {
  if (category && category !== 'all') {
    const catId = category.toLowerCase();
    console.log(`[styleProfile] Rebuilding style sources and guide for category "${catId}"…`);
    await refreshStyleSources({ category: catId, force: true });
    return await getStyleProfile({ category: catId, refresh: true });
  }

  console.log('[styleProfile] Rebuilding all style sources and guides for all categories…');
  await refreshStyleSources({ force: true });

  const categories = ['it', 'karyera', 'imkoniyatlar', 'oqish', 'fan'];
  const results = {};

  for (const cat of categories) {
    try {
      results[cat] = await getStyleProfile({ category: cat, refresh: true });
    } catch (err) {
      console.warn(`[styleProfile] Failed to rebuild guide for ${cat}:`, err.message);
    }
  }

  // Also general guide
  await buildStyleGuide([], { category: 'general', force: true }).catch(() => {});

  return results.it || (await getStyleProfile({ category: 'it', refresh: true }));
}

/**
 * Format a readable HTML summary for the /uslub Telegram command.
 * Shows which channels feed each category, sample counts, and profile highlights.
 *
 * @param {object} profile
 * @param {string} [requestedCategory]
 * @returns {string}
 */
export function formatProfileSummary(profile, requestedCategory) {
  const categoryMap = getCategoryChannelMap();
  const overallCounts = getStyleCounts();

  let msg = `🎨 <b>Kanalning Uslub Profili (Humanizer Engine):</b>\n\n`;

  // 1. Categories & Assigned Channels Map
  msg += `<b>📂 Kategoriyalar va ularning kanallari:</b>\n`;
  const catIcons = {
    it: '💻',
    karyera: '💼',
    imkoniyatlar: '🎓',
    oqish: '📚',
    fan: '🔬',
    pul: '💰',
  };

  for (const [cat, data] of Object.entries(categoryMap)) {
    const icon = catIcons[cat] || '📌';
    const channelsStr = data.channels.map((c) => `@${c}`).join(', ') || 'mavjud emas';
    const badge = data.isSpecific ? '<i>(alohida)</i>' : '<i>(umumiy)</i>';
    const catCounts = getStyleCounts(cat);
    const guideFile = getGuideFilePath(cat);
    const hasGuide = existsSync(guideFile) ? '✅' : '⏳';

    msg += `• ${icon} <b>${cat}</b> ${badge}: ${channelsStr}\n`;
    msg += `  Namuna: <b>${catCounts.brandLive} ta</b> live | Qo'llanma: ${hasGuide}\n`;
  }
  msg += `\n`;

  // 2. Specific / Active Category Stats
  const activeCat = requestedCategory || profile.category || 'it';
  const { brandStats, voiceStats, targetStats, guide } = profile;

  msg += `<b>🎯 Faol kategoriya uslubi [<code>${activeCat}</code>]:</b>\n`;
  msg += `• Brand namunalari: <b>${brandStats.sampleCount} ta</b>\n`;
  msg += `• Muallif ovozi (Voice): <b>${voiceStats.sampleCount} ta</b> (ustuvor)\n`;
  msg += `• O'rtacha gap: <b>${targetStats.avgSentenceLength} so'z</b> (std dev: ${targetStats.sentenceStdDev})\n`;
  msg += `• O'rtacha post: <b>${targetStats.avgPostLength} belgi</b> (${targetStats.avgParagraphs} abzats)\n`;
  msg += `• Emojilar: <b>${targetStats.emojisPerPost} ta</b> (qator boshida: ${targetStats.emojiPlacement?.lineStart || 0})\n\n`;

  if (guide) {
    msg += `<b>🎭 Uslubiy qo'llanma highlights [${activeCat}]:</b>\n`;
    if (guide.tone) msg += `• <b>Ohang:</b> <i>${guide.tone}</i>\n`;
    if (guide.sentence_rhythm) msg += `• <b>Ritm:</b> <i>${guide.sentence_rhythm}</i>\n`;

    if (Array.isArray(guide.openings) && guide.openings.length > 0) {
      msg += `• <b>Boshlanish:</b> ${guide.openings.slice(0, 2).map((o) => `"${o}"`).join(', ')}\n`;
    }

    if (Array.isArray(guide.vocabulary_and_connectors) && guide.vocabulary_and_connectors.length > 0) {
      msg += `• <b>Xarakterli so'zlar:</b> <code>${guide.vocabulary_and_connectors.slice(0, 4).join(', ')}</code>\n`;
    }

    if (Array.isArray(guide.never_do) && guide.never_do.length > 0) {
      msg += `• <b>Taqiqlangan:</b> ${guide.never_do.slice(0, 2).map((n) => `<i>${n}</i>`).join('; ')}\n`;
    }
  }

  msg += `\n💡 <i>Buyruqlar:</i>\n`;
  msg += `• Boshqa kategoriya: <code>/uslub &lt;kategoriya&gt;</code> (masalan: <code>/uslub karyera</code>)\n`;
  msg += `• Bitta kategoriyani yangilash: <code>/uslub_yangila &lt;kategoriya&gt;</code>\n`;
  msg += `• Barchasini yangilash: <code>/uslub_yangila</code>`;

  return msg;
}
