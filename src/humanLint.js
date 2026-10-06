// src/humanLint.js – pure code linting to ensure posts do not read as AI-written
import { stripTags } from './format.js';

/**
 * Banned phrase definitions across Uzbek, Russian, and English.
 */
const BANNED_PHRASES = [
  // Uzbek
  { pattern: /xulosa\s+qilib\s+ayt(ganda|sak)/i, name: "Xulosa qilib aytganda" },
  { pattern: /bugungi\s+raqamli\s+dunyoda/i, name: "Bugungi raqamli dunyoda" },
  { pattern: /zamonaviy\s+dunyoda/i, name: "Zamonaviy dunyoda" },
  { pattern: /shuni\s+ta['’`]?kidlash\s+joizki/i, name: "Shuni ta'kidlash joizki" },
  { pattern: /muhim\s+ahamiyatga\s+ega/i, name: "Muhim ahamiyatga ega" },
  { pattern: /nafaqat\b.+?\bbalki\b/i, name: "Nafaqat ... balki ..." },
  { pattern: /\bkeling[,\s]+/i, name: "Keling, ..." },
  { pattern: /\bushbu\b/i, name: "Ushbu" },
  { pattern: /xulosa\s+o['’`]?rnida/i, name: "Xulosa o'rnida" },
  { pattern: /xulosa\s+qiladigan\s+bo['’`]?lsak/i, name: "Xulosa qiladigan bo'lsak" },
  { pattern: /e['’`]?tiborga\s+molik/i, name: "E'tiborga molik" },

  // Russian
  { pattern: /в\s+заключение/i, name: "в заключение" },
  { pattern: /в\s+современном\s+(цифровом\s+)?мире/i, name: "в современном (цифровом) мире" },
  { pattern: /следует\s+отметить/i, name: "следует отметить" },
  { pattern: /имеет\s+важное\s+значение/i, name: "имеет важное значение" },
  { pattern: /не\s+только\b.+?\bно\s+и\b/i, name: "не только ... но и" },
  { pattern: /\bдавайте\b/i, name: "давайте" },
  { pattern: /\bданный\b/i, name: "данный" },
  { pattern: /подводя\s+итоги/i, name: "подводя итоги" },

  // English
  { pattern: /in\s+conclusion/i, name: "in conclusion" },
  { pattern: /in\s+today['’]?s\s+digital\s+world/i, name: "in today's digital world" },
  { pattern: /in\s+the\s+modern\s+world/i, name: "in the modern world" },
  { pattern: /it\s+is\s+worth\s+noting/i, name: "it is worth noting" },
  { pattern: /plays\s+a\s+crucial\s+role/i, name: "plays a crucial role" },
  { pattern: /not\s+only\b.+?\bbut\s+also\b/i, name: "not only ... but also" },
  { pattern: /let['’]?s\s+dive\s+in/i, name: "let's dive in" },
  { pattern: /\bfurthermore\b/i, name: "furthermore" },
  { pattern: /\bmoreover\b/i, name: "moreover" },
  { pattern: /\bdelve\s+into\b/i, name: "delve into" },
];

/**
 * Normalizes text into an array of lowercase punctuation-free words.
 * @param {string} str
 * @returns {string[]}
 */
function toNormalizedWords(str) {
  if (!str) return [];
  const clean = stripTags(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return clean.split(/\s+/).filter(Boolean);
}

/**
 * Builds a Set of all 7-word n-grams from various text sources.
 *
 * @param {object} sources
 * @param {string[]} [sources.styleSamples]
 * @param {Array<{ messages: string[] }>} [sources.groupMessages]
 * @param {Array<{ title: string, summary: string }>} [sources.rssItems]
 * @param {string[]} [sources.recentPosts]
 * @returns {Set<string>}
 */
function buildNgramSet(sources = {}) {
  const set = new Set();

  function addText(text) {
    if (!text) return;
    const words = toNormalizedWords(text);
    if (words.length < 7) return;
    for (let i = 0; i <= words.length - 7; i++) {
      set.add(words.slice(i, i + 7).join(' '));
    }
  }

  // Style samples
  if (Array.isArray(sources.styleSamples)) {
    for (const sample of sources.styleSamples) {
      addText(typeof sample === 'string' ? sample : sample?.text);
    }
  }

  // Group messages
  if (Array.isArray(sources.groupMessages)) {
    for (const group of sources.groupMessages) {
      if (Array.isArray(group?.messages)) {
        for (const msg of group.messages) addText(msg);
      }
    }
  }

  // RSS items
  if (Array.isArray(sources.rssItems)) {
    for (const item of sources.rssItems) {
      addText(item?.title);
      addText(item?.summary);
    }
  }

  // Earlier published posts
  if (Array.isArray(sources.recentPosts)) {
    for (const post of sources.recentPosts) addText(post);
  }

  return set;
}

/**
 * Lint post text against style profile and human writing rules.
 *
 * @param {string} text
 * @param {object} [profile] – { brandStats, voiceStats, targetStats, guide }
 * @param {object} [sources] – sources for COPY CHECK (styleSamples, groupMessages, rssItems, recentPosts)
 * @returns {{ score: number, issues: Array<{ type: string, message: string, penalty: number }> }}
 */
export function lintPost(text = '', profile = {}, sources = {}) {
  const issues = [];
  let score = 100;

  if (!text || !text.trim()) {
    return {
      score: 0,
      issues: [{ type: 'EMPTY_TEXT', message: "Matn bo'sh", penalty: 100 }],
    };
  }

  const plain = stripTags(text);
  const targetStats = profile?.targetStats || profile?.voiceStats || profile?.brandStats || {};

  // ── 1. Em-dash and En-dash Check ──────────────────────────────────────────
  const dashesMatch = text.match(/[—–]/g);
  if (dashesMatch) {
    const penalty = Math.min(30, dashesMatch.length * 15);
    issues.push({
      type: 'BANNED_DASH',
      message: `Uzun tire (— yoki –) topildi (${dashesMatch.length} ta). Oddiy defis (-) yoki boshqa tinish belgisidan foydalaning.`,
      penalty,
    });
  }

  // ── 2. Banned Phrases Check ──────────────────────────────────────────────
  for (const banned of BANNED_PHRASES) {
    if (banned.pattern.test(plain)) {
      issues.push({
        type: 'BANNED_PHRASE',
        message: `Taqiqlangan shablon ibora topildi: "${banned.name}".`,
        penalty: 15,
      });
    }
  }

  // ── 3. Sentence Length Standard Deviation ────────────────────────────────
  const sentences = plain
    .split(/[.!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentenceWordCounts = sentences
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((len) => len > 0);

  if (sentenceWordCounts.length >= 4) {
    const mean = sentenceWordCounts.reduce((a, b) => a + b, 0) / sentenceWordCounts.length;
    const variance =
      sentenceWordCounts.reduce((acc, len) => acc + Math.pow(len - mean, 2), 0) /
      sentenceWordCounts.length;
    const stdDev = Math.sqrt(variance);

    const minRequiredStdDev = Math.max(2.8, (targetStats.sentenceStdDev || 4.5) * 0.55);
    if (stdDev < minRequiredStdDev) {
      issues.push({
        type: 'MONOTONOUS_SENTENCES',
        message: `Gaplar uzunligi bir xil qolipda (og'ish: ${stdDev.toFixed(1)} < ${minRequiredStdDev.toFixed(1)}). Qisqa (2-5 so'z) va uzun gaplarni aralashtiring.`,
        penalty: 15,
      });
    }
  }

  // ── 4. Paragraph Length Monotony Check ───────────────────────────────────
  const paragraphs = text
    .split(/\n\s*\n|\n(?=[•\d\-<])/)
    .map((p) => stripTags(p).trim())
    .filter(Boolean);

  if (paragraphs.length >= 3) {
    const pLengths = paragraphs.map((p) => p.length);
    const pMean = pLengths.reduce((a, b) => a + b, 0) / pLengths.length;
    const pVariance =
      pLengths.reduce((acc, l) => acc + Math.pow(l - pMean, 2), 0) / pLengths.length;
    const pStdDev = Math.sqrt(pVariance);

    // If paragraph lengths differ by barely anything
    if (pStdDev < 18 && pMean > 50) {
      issues.push({
        type: 'MONOTONOUS_PARAGRAPHS',
        message: "Abzatslar deyarli bir xil uzunlikda tuzilgan. Abzatslar ritmini o'zgartiring.",
        penalty: 10,
      });
    }
  }

  // ── 5. Emoji Count & Placement Check ─────────────────────────────────────
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const postEmojis = text.match(emojiRegex) || [];
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  let linesStartingWithEmoji = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\p{Extended_Pictographic}/u.test(trimmed)) {
      linesStartingWithEmoji++;
    }
  }

  // If emoji starts most lines (typical AI list tell)
  if (lines.length >= 3 && linesStartingWithEmoji / lines.length > 0.45) {
    issues.push({
      type: 'EMOJI_OVERUSE_OR_MISPLACEMENT',
      message: `Ko'p qatorlar emoji bilan boshlangan (${linesStartingWithEmoji}/${lines.length}). Bu yaqqol sun'iy (AI) belgisidir.`,
      penalty: 15,
    });
  } else if (postEmojis.length > Math.max(7, (targetStats.emojisPerPost || 3) * 2.5)) {
    issues.push({
      type: 'EMOJI_OVERUSE_OR_MISPLACEMENT',
      message: `Emoji soni juda ko'p (${postEmojis.length} ta). Me'yor: 2-4 ta.`,
      penalty: 10,
    });
  }

  // ── 6. Excessive Bold or Bullet Lines ────────────────────────────────────
  const boldMatches = text.match(/<b>|<strong>|\*\*/gi) || [];
  if (boldMatches.length > 5) {
    issues.push({
      type: 'EXCESSIVE_FORMATTING',
      message: `Qalin shrift (<b>) juda ko'p ishlatilgan (${boldMatches.length} ta). Faqat sarlavha va eng muhim iborani qalin qiling.`,
      penalty: 10,
    });
  }

  const bulletLines = lines.filter((l) => /^[ \t]*(?:[•\-*]|\d+\.)\s+/m.test(l));
  if (bulletLines.length >= 4 && (targetStats.bulletShare || 0) < 0.35) {
    issues.push({
      type: 'EXCESSIVE_FORMATTING',
      message: "Haddan tashqari ko'p ro'yxat (bullet list) qolipi ishlatilgan.",
      penalty: 10,
    });
  }

  // ── 7. Exclamation Count ─────────────────────────────────────────────────
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > Math.max(3, (targetStats.exclamationsPerPost || 1) + 2)) {
    issues.push({
      type: 'EXCESSIVE_EXCLAMATIONS',
      message: `Undov belgilari (!) ko'p (${exclamations} ta). Xotirjam va ishonchli ohangda yozing.`,
      penalty: 10,
    });
  }

  // ── 8. Repetitive Sentence Starters ──────────────────────────────────────
  const starters = new Map();
  for (const s of sentences) {
    const firstWord = s.split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (firstWord && firstWord.length >= 2) {
      starters.set(firstWord, (starters.get(firstWord) || 0) + 1);
    }
  }

  for (const [word, count] of starters.entries()) {
    if (count >= 3) {
      issues.push({
        type: 'REPETITIVE_SENTENCE_STARTERS',
        message: `3 yoki undan ko'p gap bir xil so'z bilan boshlangan ("${word}"). Gap boshlanishlarini o'zgartiring.`,
        penalty: 15,
      });
      break;
    }
  }

  // ── 9. Triad Patterns ("A, B va C") ──────────────────────────────────────
  const triadRegex = /\b[\p{L}\w-]+\s*,\s*[\p{L}\w-]+\s+(?:va|hamda|and|or|и|или)\s+[\p{L}\w-]+\b/gui;
  const triadMatches = plain.match(triadRegex) || [];
  if (triadMatches.length >= 2) {
    issues.push({
      type: 'TRIAD_PATTERN',
      message: "Uchtalik ro'yxat qolipi ('A, B va C') takrorlangan. Bu AI shablonidir.",
      penalty: 10,
    });
  }

  // ── 10. Headline with Colon Formula ──────────────────────────────────────
  const firstNonEmptyLine = lines[0] ? stripTags(lines[0]).trim() : '';
  if (/^[^:\n]{3,40}\s*:\s*.+/i.test(firstNonEmptyLine) || /^<b>[^:<]{3,40}:<\/b>/i.test(lines[0] || '')) {
    issues.push({
      type: 'COLON_HEADLINE',
      message: "Sarlavhada 'Sarlavha: izoh' sun'iy formulasi ishlatilgan.",
      penalty: 10,
    });
  }

  // ── 11. COPY CHECK (7+ consecutive words) ────────────────────────────────
  const ngramSet = buildNgramSet(sources);
  if (ngramSet.size > 0) {
    const draftWords = toNormalizedWords(text);
    let copyFound = false;

    for (let i = 0; i <= draftWords.length - 7; i++) {
      const phrase = draftWords.slice(i, i + 7).join(' ');
      if (ngramSet.has(phrase)) {
        copyFound = true;
        break;
      }
    }

    if (copyFound) {
      issues.push({
        type: 'COPY_DETECTED',
        message: "Boshqa manbadan yoki namunadan 7+ so'zlik to'g'ridan-to'g'ri ko'chirma aniqlandi. Post faqat muallifning o'z so'zlari bilan yozilishi shart.",
        penalty: 80,
      });
    }
  }

  // ── Calculate final score ────────────────────────────────────────────────
  const totalPenalties = issues.reduce((acc, issue) => acc + issue.penalty, 0);
  score = Math.max(0, 100 - totalPenalties);

  if (issues.some((i) => i.type === 'COPY_DETECTED')) {
    score = Math.min(score, 10);
  }

  return {
    score,
    issues,
  };
}
