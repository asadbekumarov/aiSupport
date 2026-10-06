// src/styleSources.js – collects writing samples from brand exports, live channels, and owner voice
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, getCategoryStyleChannels } from './config.js';
import { getClient } from './userbot.js';

// Ensure data directories exist
mkdirSync(config.EXPORTS_DIR, { recursive: true });
mkdirSync(config.STYLE_DIR, { recursive: true });
mkdirSync(config.VOICE_DIR, { recursive: true });

/** In-memory cache for parsed desktop exports */
const _exportsCache = new Map();

/**
 * Parse a single Telegram Desktop export JSON file.
 * Telegram Desktop exports messages in result.json.
 * Text can be a string or array of strings/objects.
 *
 * @param {string} filePath
 * @returns {Array<{ text: string, source: 'brand', origin: string }>}
 */
function parseExportFile(filePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[styleSources] Could not parse ${filePath}:`, err.message);
    return [];
  }

  const messages = raw?.messages ?? [];
  const results = [];

  for (const msg of messages) {
    if (msg.type !== 'message') continue;
    if (msg.forwarded_from) continue;

    let text = '';
    if (typeof msg.text === 'string') {
      text = msg.text;
    } else if (Array.isArray(msg.text)) {
      text = msg.text
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') return part.text ?? '';
          return '';
        })
        .join('');
    }

    text = text.trim();
    if (text.length >= 300 && text.length <= 2500) {
      results.push({
        text,
        source: 'brand',
        origin: `export:${filePath.replace(/\\/g, '/')}`,
      });
    }
  }

  return results;
}

/**
 * Find all JSON files in a directory recursively.
 * @param {string} dir
 * @returns {string[]}
 */
function findJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        files.push(...findJsonFiles(fullPath));
      }
    }
  } catch (err) {
    console.warn(`[styleSources] Error reading dir ${dir}:`, err.message);
  }
  return files;
}

/**
 * Load desktop export samples for a specific category or fallback.
 * @param {string} [categoryId]
 * @returns {Array<{ text: string, source: 'brand', origin: string }>}
 */
export function getExportSamples(categoryId) {
  const catKey = categoryId ? String(categoryId).toLowerCase() : '__default__';
  if (_exportsCache.has(catKey)) {
    return _exportsCache.get(catKey);
  }

  const exportsDir = config.EXPORTS_DIR;
  if (!existsSync(exportsDir)) {
    _exportsCache.set(catKey, []);
    return [];
  }

  // 1. Try category specific subfolder
  if (categoryId) {
    const catDir = join(exportsDir, categoryId.toLowerCase());
    if (existsSync(catDir)) {
      const catFiles = findJsonFiles(catDir);
      if (catFiles.length > 0) {
        const catSamples = catFiles.flatMap((f) => parseExportFile(f));
        if (catSamples.length > 0) {
          _exportsCache.set(catKey, catSamples);
          return catSamples;
        }
      }
    }
  }

  // 2. Fallback to all exports in exportsDir
  const allKey = '__all__';
  if (_exportsCache.has(allKey)) {
    const fallback = _exportsCache.get(allKey);
    _exportsCache.set(catKey, fallback);
    return fallback;
  }

  const allFiles = findJsonFiles(exportsDir);
  const allSamples = allFiles.flatMap((f) => parseExportFile(f));
  _exportsCache.set(allKey, allSamples);
  _exportsCache.set(catKey, allSamples);
  return allSamples;
}

/**
 * Fetch and cache live style channels using GramJS userbot in READ-ONLY mode.
 * Top 30% by views, 300-2500 chars, no forwards.
 * Refreshes at most weekly (config.STYLE_REFRESH_DAYS).
 * Each channel is cached once in data/style/<channel>.json regardless of how many categories use it.
 *
 * @param {{ channels?: string[], force?: boolean }} [options]
 * @returns {Promise<Array<{ text: string, source: 'brand', origin: string, views?: number, forwards?: number }>>}
 */
export async function getLiveBrandSamples({ channels, force = false } = {}) {
  const targetChannels = Array.isArray(channels) && channels.length > 0
    ? channels
    : config.STYLE_CHANNELS;

  if (!targetChannels || targetChannels.length === 0) {
    return [];
  }

  const allLive = [];

  for (const channel of targetChannels) {
    const cleanChannel = channel.replace(/^@/, '').trim();
    if (!cleanChannel) continue;

    const cacheFile = join(config.STYLE_DIR, `${cleanChannel}.json`);
    let cached = null;

    if (existsSync(cacheFile)) {
      try {
        const stat = statSync(cacheFile);
        const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays < config.STYLE_REFRESH_DAYS && !force) {
          const raw = JSON.parse(readFileSync(cacheFile, 'utf8'));
          if (Array.isArray(raw)) {
            cached = raw;
          }
        }
      } catch (err) {
        console.warn(`[styleSources] Could not read cache for channel @${cleanChannel}:`, err.message);
      }
    }

    if (cached) {
      allLive.push(
        ...cached.map((item) => ({
          text: item.text,
          source: 'brand',
          origin: `live:@${cleanChannel}`,
          views: item.views,
          forwards: item.forwards,
        }))
      );
      continue;
    }

    // Try live fetch via GramJS client
    try {
      const client = await getClient().catch(() => null);
      if (!client) {
        // Userbot client not ready; if cached file exists (even older), use it
        if (existsSync(cacheFile)) {
          const fallback = JSON.parse(readFileSync(cacheFile, 'utf8'));
          allLive.push(
            ...fallback.map((item) => ({
              text: item.text,
              source: 'brand',
              origin: `live:@${cleanChannel}`,
              views: item.views,
              forwards: item.forwards,
            }))
          );
        }
        continue;
      }

      console.log(`[styleSources] Fetching top posts from live channel @${cleanChannel} (read-only)…`);
      // Wait 800ms before call for flood safety
      await new Promise((r) => setTimeout(r, 800));

      const fetched = await client.getMessages(cleanChannel, { limit: 200 });
      const candidates = [];

      for (const msg of fetched) {
        // No forwarded messages
        if (msg.fwdFrom || msg.forward) continue;

        const rawText = msg.message ?? '';
        const text = rawText.trim();
        if (text.length < 300 || text.length > 2500) continue;

        const views = Number(msg.views ?? 0);
        const forwards = Number(msg.forwards ?? 0);

        candidates.push({
          text,
          views,
          forwards,
          date: msg.date,
        });
      }

      if (candidates.length > 0) {
        // Keep only top 30% by views relative to that channel
        candidates.sort((a, b) => b.views - a.views);
        const topCount = Math.max(1, Math.ceil(candidates.length * 0.3));
        const topPosts = candidates.slice(0, topCount);

        writeFileSync(cacheFile, JSON.stringify(topPosts, null, 2), 'utf8');
        console.log(`[styleSources] Cached ${topPosts.length} top posts for @${cleanChannel} in ${cacheFile}.`);

        allLive.push(
          ...topPosts.map((item) => ({
            text: item.text,
            source: 'brand',
            origin: `live:@${cleanChannel}`,
            views: item.views,
            forwards: item.forwards,
          }))
        );
      }
    } catch (err) {
      console.warn(`[styleSources] Failed to fetch channel @${cleanChannel}: ${err.message ?? err}`);
      // Fallback to existing disk cache if available
      if (existsSync(cacheFile)) {
        try {
          const fallback = JSON.parse(readFileSync(cacheFile, 'utf8'));
          allLive.push(
            ...fallback.map((item) => ({
              text: item.text,
              source: 'brand',
              origin: `live:@${cleanChannel}`,
              views: item.views,
              forwards: item.forwards,
            }))
          );
        } catch (_) {}
      }
    }
  }

  return allLive;
}

/**
 * Collect voice samples from data/voice/*.txt and optionally SOURCE_CHATS messages (m.out === true).
 * Highest weight in style profile.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<Array<{ text: string, source: 'voice', origin: string }>>}
 */
export async function getVoiceSamples({ force = false } = {}) {
  const voiceCacheFile = join(config.STYLE_DIR, 'voice.json');
  const voiceDir = config.VOICE_DIR;

  const samples = [];

  // 1. Read files in data/voice/*.txt
  if (existsSync(voiceDir)) {
    try {
      const files = readdirSync(voiceDir);
      for (const file of files) {
        if (!file.endsWith('.txt') || file.toLowerCase() === 'readme.txt') continue;
        const filePath = join(voiceDir, file);
        const content = readFileSync(filePath, 'utf8');
        const chunks = content.split(/^\s*---\s*$/m);

        for (const chunk of chunks) {
          const text = chunk.trim();
          if (text.length >= 120 && text.length <= 2500) {
            samples.push({
              text,
              source: 'voice',
              origin: `file:${file}`,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[styleSources] Error reading voice directory:', err.message);
    }
  }

  // 2. Read owner sent messages (m.out === true) from public chats in SOURCE_CHATS only
  if (config.VOICE_FROM_GROUPS && config.SOURCE_CHATS.length > 0) {
    try {
      const client = await getClient().catch(() => null);
      if (client) {
        for (const chat of config.SOURCE_CHATS) {
          try {
            await new Promise((r) => setTimeout(r, 600));
            const fetched = await client.getMessages(chat, { limit: 100 });
            for (const msg of fetched) {
              if (!msg.out) continue; // Only owner's own sent messages!
              const text = (msg.message ?? '').trim();
              if (text.length >= 120 && text.length <= 2500) {
                samples.push({
                  text,
                  source: 'voice',
                  origin: `group:@${chat}`,
                });
              }
            }
          } catch (chatErr) {
            console.warn(`[styleSources] Could not read voice messages from @${chat}:`, chatErr.message);
          }
        }
      }
    } catch (err) {
      console.warn('[styleSources] Voice from groups fetch error:', err.message);
    }
  }

  // Deduplicate voice samples by text
  const seen = new Set();
  const deduped = [];
  for (const s of samples) {
    const key = s.text.slice(0, 100).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  // Cache to data/style/voice.json
  try {
    writeFileSync(voiceCacheFile, JSON.stringify(deduped, null, 2), 'utf8');
  } catch (err) {
    console.warn('[styleSources] Could not write voice cache:', err.message);
  }

  return deduped;
}

/**
 * Fisher-Yates array shuffle helper.
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Returns a mix of samples: default 4 brand + 3 voice when voice exists, else 6 brand.
 * Takes brand samples first from the requested category's channels.
 * If there are fewer than 3 usable samples, fills up from general STYLE_CHANNELS and exports.
 *
 * @param {object} [options]
 * @param {string} [options.category]
 * @param {number} [options.nBrand] – default 4
 * @param {number} [options.nVoice] – default 3
 * @returns {Promise<Array<{ text: string, source: 'brand'|'voice', origin: string }>>}
 */
export async function getSamples({ category = 'it', nBrand = 4, nVoice = 3 } = {}) {
  const catId = typeof category === 'string' ? category : category?.id || 'it';

  // 1. Collect brand samples specific to this category
  const catChannels = getCategoryStyleChannels(catId);
  const catLiveBrand = await getLiveBrandSamples({ channels: catChannels });
  const catExportBrand = getExportSamples(catId);

  let brandCandidates = [...catLiveBrand, ...catExportBrand];

  // 2. If fewer than 3 usable samples, fill up from general STYLE_CHANNELS and all exports
  if (brandCandidates.length < 3) {
    const generalLiveBrand = await getLiveBrandSamples({ channels: config.STYLE_CHANNELS });
    const allExportBrand = getExportSamples(); // fallback all exports

    const seenTexts = new Set(brandCandidates.map((b) => b.text.slice(0, 100).toLowerCase()));
    for (const item of [...generalLiveBrand, ...allExportBrand]) {
      const key = item.text.slice(0, 100).toLowerCase();
      if (!seenTexts.has(key)) {
        seenTexts.add(key);
        brandCandidates.push(item);
      }
    }
  }

  // 3. Voice samples
  let voiceSamples = [];
  try {
    const voiceCacheFile = join(config.STYLE_DIR, 'voice.json');
    if (existsSync(voiceCacheFile)) {
      const parsed = JSON.parse(readFileSync(voiceCacheFile, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        voiceSamples = parsed;
      }
    }
    if (voiceSamples.length === 0) {
      voiceSamples = await getVoiceSamples();
    }
  } catch {
    voiceSamples = await getVoiceSamples().catch(() => []);
  }

  const shuffledBrand = shuffle(brandCandidates);
  const shuffledVoice = shuffle(voiceSamples);

  if (shuffledVoice.length > 0) {
    const pickedVoice = shuffledVoice.slice(0, nVoice);
    const pickedBrand = shuffledBrand.slice(0, nBrand);
    return shuffle([...pickedBrand, ...pickedVoice]);
  }

  // If no voice samples exist, return 6 brand samples
  return shuffledBrand.slice(0, Math.max(6, nBrand));
}

/**
 * Backward compatibility for pickStyleSamples: returns array of string texts.
 * @param {number} [n]
 * @param {string} [category]
 * @returns {Promise<string[]>}
 */
export async function pickStyleSamples(n = 3, category = 'it') {
  const categoryId = typeof category === 'string' ? category : category?.id || 'it';
  const samples = await getSamples({ category: categoryId, nBrand: n, nVoice: 2 });
  return samples.slice(0, n).map((s) => s.text);
}

/**
 * Get all available brand and voice samples for computing statistics for a category.
 * Takes category brand channels first, fills up from general if < 3.
 *
 * @param {object} [options]
 * @param {string} [options.category]
 * @returns {Promise<{ brand: Array<{ text: string, source: 'brand', origin: string }>, voice: Array<{ text: string, source: 'voice', origin: string }> }>}
 */
export async function getAllSamples({ category = 'it' } = {}) {
  const catId = typeof category === 'string' ? category : category?.id || 'it';
  const catChannels = getCategoryStyleChannels(catId);
  const catLiveBrand = await getLiveBrandSamples({ channels: catChannels });
  const catExportBrand = getExportSamples(catId);

  let brandCandidates = [...catLiveBrand, ...catExportBrand];

  if (brandCandidates.length < 3) {
    const generalLiveBrand = await getLiveBrandSamples({ channels: config.STYLE_CHANNELS });
    const allExportBrand = getExportSamples();

    const seenTexts = new Set(brandCandidates.map((b) => b.text.slice(0, 100).toLowerCase()));
    for (const item of [...generalLiveBrand, ...allExportBrand]) {
      const key = item.text.slice(0, 100).toLowerCase();
      if (!seenTexts.has(key)) {
        seenTexts.add(key);
        brandCandidates.push(item);
      }
    }
  }

  let voiceSamples = [];
  const voiceCacheFile = join(config.STYLE_DIR, 'voice.json');
  if (existsSync(voiceCacheFile)) {
    try {
      voiceSamples = JSON.parse(readFileSync(voiceCacheFile, 'utf8'));
    } catch (_) {}
  }
  if (!voiceSamples || voiceSamples.length === 0) {
    voiceSamples = await getVoiceSamples().catch(() => []);
  }

  return {
    brand: brandCandidates,
    voice: voiceSamples,
  };
}

/**
 * Returns a deduplicated list of all configured style channels across all categories and general fallback.
 * @returns {string[]}
 */
export function getAllConfiguredChannels() {
  const set = new Set();
  const lists = [
    config.STYLE_CHANNELS,
    config.STYLE_CHANNELS_IT,
    config.STYLE_CHANNELS_KARYERA,
    config.STYLE_CHANNELS_IMKONIYATLAR,
    config.STYLE_CHANNELS_OQISH,
    config.STYLE_CHANNELS_FAN,
  ];
  for (const list of lists) {
    if (Array.isArray(list)) {
      list.forEach((c) => {
        const clean = c.replace(/^@/, '').trim();
        if (clean) set.add(clean);
      });
    }
  }
  return Array.from(set);
}

/**
 * Returns a map of category IDs to their assigned channels.
 * @returns {Record<string, { channels: string[], isSpecific: boolean }>}
 */
export function getCategoryChannelMap() {
  const categories = ['it', 'karyera', 'imkoniyatlar', 'oqish', 'fan'];
  const map = {};

  for (const cat of categories) {
    const specificKey = `STYLE_CHANNELS_${cat.toUpperCase()}`;
    const specific = config[specificKey];
    const isSpecific = Array.isArray(specific) && specific.length > 0;
    map[cat] = {
      channels: getCategoryStyleChannels(cat),
      isSpecific,
    };
  }

  return map;
}

/**
 * Get summary counts of available samples across sources.
 * @param {string} [categoryId]
 * @returns {{ brandExports: number, brandLive: number, voice: number, total: number }}
 */
export function getStyleCounts(categoryId) {
  const catChannels = categoryId ? getCategoryStyleChannels(categoryId) : getAllConfiguredChannels();
  const exportBrand = getExportSamples(categoryId);
  let brandLiveCount = 0;

  for (const channel of catChannels) {
    const clean = channel.replace(/^@/, '').trim();
    const file = join(config.STYLE_DIR, `${clean}.json`);
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(raw)) brandLiveCount += raw.length;
      } catch (_) {}
    }
  }

  let voiceCount = 0;
  const voiceFile = join(config.STYLE_DIR, 'voice.json');
  if (existsSync(voiceFile)) {
    try {
      const raw = JSON.parse(readFileSync(voiceFile, 'utf8'));
      if (Array.isArray(raw)) voiceCount = raw.length;
    } catch (_) {}
  }

  return {
    brandExports: exportBrand.length,
    brandLive: brandLiveCount,
    voice: voiceCount,
    total: exportBrand.length + brandLiveCount + voiceCount,
  };
}

/**
 * Force refresh of live style channels and voice caches.
 * Can refresh for a specific category or for all configured channels.
 *
 * @param {{ category?: string, force?: boolean }} [options]
 * @returns {Promise<{ brandCount: number, voiceCount: number }>}
 */
export async function refreshStyleSources({ category, force = true } = {}) {
  _exportsCache.clear();
  const targetChannels = category
    ? getCategoryStyleChannels(category)
    : getAllConfiguredChannels();

  const [liveBrand, voice] = await Promise.all([
    getLiveBrandSamples({ channels: targetChannels, force }),
    getVoiceSamples({ force }),
  ]);
  const exportsBrand = getExportSamples(category);

  return {
    brandCount: exportsBrand.length + liveBrand.length,
    voiceCount: voice.length,
  };
}
