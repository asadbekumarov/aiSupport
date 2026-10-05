// src/topics.js – topic categories, weighted random selection, and feeds
import { config } from './config.js';
import { getLastPublishedCategories } from './db.js';

/**
 * All supported topic categories with their metadata and guidance.
 */
export const CATEGORIES = [
  {
    id: 'it',
    name: 'IT va Texnologiyalar',
    defaultWeight: 50,
    enabledByDefault: true,
    guidance: "IT yangiliklari, dasturlash, AI, vositalar, o'zbekistonlik dasturchi uchun foydasi.",
    feeds: [],
    searchHint: "IT yangiliklari, dasturlash, sun'iy intellekt, yangi texnologiyalar",
  },
  {
    id: 'karyera',
    name: 'Karyera va Kasbiy Rivojlanish',
    defaultWeight: 15,
    enabledByDefault: true,
    guidance: "Ish topish, intervyu, rezyume, freelance, soft skills, ish bozori. O'zbekiston kontekstida, amaliy va aniq maslahatlar.",
    feeds: [],
    searchHint: "IT va zamonaviy kasblarda ish topish, intervyu sirlari, rezyume tayyorlash, freelance, soft skills maslahatlar",
  },
  {
    id: 'imkoniyatlar',
    name: 'Imkoniyatlar, Grantlar va Tanlovlar',
    defaultWeight: 15,
    enabledByDefault: true,
    guidance: "Grantlar, stipendiyalar, tanlovlar, hackathon, bepul kurslar va dasturlar. QOIDA: faqat Google qidiruvi orqali tasdiqlangan, muddati (deadline) hali o'tmagan imkoniyat; muddat va rasmiy havola postda albatta bo'lsin; ishonchli havola yoki aniq muddat topilmasa, boshqa mavzu tanla va hech narsa to'qima.",
    feeds: [],
    searchHint: "O'zbekiston yoshlari uchun xalqaro va mahalliy grantlar, stipendiyalar, hackathonlar, tanlovlar, bepul ta'lim dasturlari",
  },
  {
    id: 'oqish',
    name: "Ta'lim va Shaxsiy Samaradorlik",
    defaultWeight: 10,
    enabledByDefault: true,
    guidance: "O'rganish usullari, til o'rganish, kitoblar, odatlar, vaqtni boshqarish, mahsuldorlik.",
    feeds: [],
    searchHint: "Samarali o'rganish usullari, chet tillarini o'rganish, vaqtni boshqarish, kitoblar tavsiyasi, mahsuldorlik",
  },
  {
    id: 'fan',
    name: 'Ilm-fan va Kelajak',
    defaultWeight: 10,
    enabledByDefault: true,
    guidance: "Fan va qiziqarli faktlar, kosmos, kelajak texnologiyalari; faqat ishonchli manbaga tayanib.",
    feeds: [],
    searchHint: "Ilm-fan kashfiyotlari, kosmos yangiliklari, ilmiy faktlar, kelajak texnologiyalari",
  },
  {
    id: 'pul',
    name: 'Moliyaviy Savodxonlik',
    defaultWeight: 0,
    enabledByDefault: false,
    guidance: "Moliyaviy savodxonlik, shaxsiy byudjet, tejash va rejalashtirish. MUHIM TALAB: Hech qachon investitsiya maslahati berma, daromad va'da qilma va post oxirida qisqa bitta jumla qo'sh: 'Bu moliyaviy maslahat emas.'",
    feeds: [],
    searchHint: "Shaxsiy byudjet, tejash usullari, moliyaviy savodxonlik asoslari",
  },
];

/**
 * Hard exclusions applicable to all categories.
 */
export const HARD_EXCLUSIONS = [
  'siyosat',
  'din',
  "tibbiy/sog'liq maslahatlari",
  'investitsiya maslahati',
  'mish-mish',
  'shaxsiy hayot',
];

/**
 * Return all categories.
 */
export function getAllCategories() {
  return CATEGORIES.map((c) => ({ ...c }));
}

/**
 * Find category by ID (case-insensitive).
 * @param {string} id
 * @returns {object|null}
 */
export function getCategoryById(id) {
  if (!id || typeof id !== 'string') return null;
  const target = id.trim().toLowerCase();
  return CATEGORIES.find((c) => c.id.toLowerCase() === target) ?? null;
}

/**
 * Parse TOPIC_WEIGHTS and ENABLE_TOPICS to calculate active categories and normalized weights.
 *
 * @returns {Array<object & { weight: number, normalizedWeight: number }>}
 */
export function getActiveCategories() {
  const enabledEnvList = (config.ENABLE_TOPICS || [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Parse weight string e.g. "it:50,karyera:15,imkoniyatlar:15,oqish:10,fan:10"
  const rawWeightsStr = config.TOPIC_WEIGHTS || 'it:50,karyera:15,imkoniyatlar:15,oqish:10,fan:10';
  const customWeights = new Map();

  for (const part of rawWeightsStr.split(',')) {
    const [rawId, rawWeight] = part.split(':').map((s) => s?.trim());
    if (!rawId || rawWeight === undefined) continue;
    const cat = getCategoryById(rawId);
    if (!cat) continue; // unknown ids ignored
    const parsedWeight = parseFloat(rawWeight);
    if (!isNaN(parsedWeight) && parsedWeight >= 0) {
      customWeights.set(cat.id, parsedWeight);
    }
  }

  // Determine which categories are enabled
  const activeList = [];

  for (const cat of CATEGORIES) {
    const isExplicitlyEnabled = enabledEnvList.includes(cat.id);
    const hasCustomWeight = customWeights.has(cat.id);
    const weightFromEnv = customWeights.get(cat.id);

    let isEnabled = cat.enabledByDefault || isExplicitlyEnabled;
    let weight = cat.defaultWeight;

    if (hasCustomWeight) {
      weight = weightFromEnv;
    } else if (isExplicitlyEnabled && weight === 0) {
      // If enabled via ENABLE_TOPICS and defaultWeight was 0 without explicit weight
      weight = 10;
    }

    // A category is considered active if enabled and has weight > 0
    if (isEnabled && weight > 0) {
      activeList.push({ ...cat, weight });
    }
  }

  // Normalization
  const totalWeight = activeList.reduce((sum, item) => sum + item.weight, 0);

  return activeList.map((item) => {
    const normalized = totalWeight > 0 ? (item.weight / totalWeight) * 100 : 0;
    return {
      ...item,
      normalizedWeight: Math.round(normalized * 10) / 10,
      normalizedFraction: totalWeight > 0 ? item.weight / totalWeight : 0,
    };
  });
}

/**
 * Returns a human-readable summary of active categories and their weights.
 * Example: "it (50%), karyera (15%), imkoniyatlar (15%), oqish (10%), fan (10%)"
 */
export function getActiveCategoriesSummary() {
  const active = getActiveCategories();
  return active.map((c) => `${c.id} (${c.normalizedWeight}%)`).join(', ');
}

/**
 * Return configured RSS feeds for a given category.
 * Reads environment variable `RSS_FEEDS_<CATEGORY_ID>` (comma-separated).
 * For 'it', falls back to `config.RSS_FEEDS` if no specific env var is provided.
 *
 * @param {string} categoryId
 * @returns {string[]}
 */
export function getCategoryFeeds(categoryId) {
  const envKey = `RSS_FEEDS_${categoryId.toUpperCase()}`;
  const envFeeds = (process.env[envKey] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (envFeeds.length > 0) {
    return envFeeds;
  }

  if (categoryId === 'it') {
    return config.RSS_FEEDS;
  }

  return [];
}

/**
 * Select a category for the next blog post.
 *
 * Rules:
 * - If `forced` is provided (category id string or object), validates and uses it.
 * - Otherwise performs weighted random selection among active categories.
 * - Never picks the same category 3 times in a row (checks last 2 published posts).
 * - Can optionally exclude a specific category (e.g. for "Boshqa mavzu" regeneration).
 *
 * @param {string|object|null} [forced]
 * @param {object} [opts]
 * @param {string|string[]} [opts.exclude] – category ID(s) to exclude from random pick
 * @returns {object} Selected category definition
 */
export function pickCategory(forced = null, opts = {}) {
  // If forced category requested
  if (forced) {
    const forcedId = typeof forced === 'string' ? forced : forced.id;
    const cat = getCategoryById(forcedId);
    if (!cat) {
      const valid = CATEGORIES.map((c) => c.id).join(', ');
      throw new Error(`[topics] Noma'lum kategoriya: "${forcedId}". Mavjud kategoriyalar: ${valid}`);
    }
    console.log(`[topics] Selected category: ${cat.id} ("${cat.name}") [forced]`);
    return cat;
  }

  const activeCategories = getActiveCategories();
  if (activeCategories.length === 0) {
    console.warn('[topics] No active categories found. Falling back to default "it".');
    return getCategoryById('it');
  }

  // Determine exclusions
  const excludeIds = new Set();

  if (opts.exclude) {
    const list = Array.isArray(opts.exclude) ? opts.exclude : [opts.exclude];
    for (const ex of list) {
      if (ex) excludeIds.add(String(ex).trim().toLowerCase());
    }
  }

  // Check last 2 published posts to prevent 3 in a row
  try {
    const last2 = getLastPublishedCategories(2);
    if (last2.length >= 2 && last2[0] === last2[1] && last2[0]) {
      excludeIds.add(last2[0].toLowerCase());
      console.log(`[topics] Excluded "${last2[0]}" to prevent 3 consecutive posts of the same category.`);
    }
  } catch (err) {
    console.warn('[topics] Could not check last published categories:', err.message);
  }

  // Filter candidates
  let candidates = activeCategories.filter((c) => !excludeIds.has(c.id.toLowerCase()));

  // If all active categories were excluded, relax exclusions except opts.exclude if possible
  if (candidates.length === 0) {
    if (opts.exclude) {
      const optExcludeSet = new Set(
        (Array.isArray(opts.exclude) ? opts.exclude : [opts.exclude]).map((s) => String(s).toLowerCase())
      );
      candidates = activeCategories.filter((c) => !optExcludeSet.has(c.id.toLowerCase()));
    }
    if (candidates.length === 0) {
      candidates = activeCategories;
    }
  }

  // Weighted random pick among candidates
  const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
  let rnd = Math.random() * totalWeight;
  let chosen = candidates[candidates.length - 1];

  for (const c of candidates) {
    if (rnd < c.weight) {
      chosen = c;
      break;
    }
    rnd -= c.weight;
  }

  console.log(
    `[topics] Selected category: ${chosen.id} ("${chosen.name}") [weight: ${chosen.normalizedWeight}%]`
  );
  return chosen;
}
