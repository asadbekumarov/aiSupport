// src/config.js – loads and validates environment variables
import 'dotenv/config';

/**
 * Throws a clear error listing all missing required env variables.
 * @param {string[]} keys – list of required variable names
 */
export function assertConfig(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[config] Missing required environment variables:\n` +
        missing.map((k) => `  • ${k}`).join('\n') +
        `\n\nCopy .env.example → .env and fill in the values.`
    );
  }
}

function parseChannels(str) {
  return (str ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
}

// ─── Parsed & typed config ─────────────────────────────────────────────────

export const config = {
  // Telegram UserBot (GramJS)
  TG_API_ID: Number(process.env.TG_API_ID),
  TG_API_HASH: process.env.TG_API_HASH ?? '',
  TG_SESSION: process.env.TG_SESSION ?? '',

  // Telegram Bot (grammY)
  BOT_TOKEN: process.env.BOT_TOKEN ?? '',

  // Owner & Channel
  MY_CHAT_ID: Number(process.env.MY_CHAT_ID),
  CHANNEL_USERNAME: process.env.CHANNEL_USERNAME ?? '',

  // Gemini & Groq AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-flash-latest',
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? '',
  GROQ_MODEL: process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b',

  // Source chats – whitelist only (never read others)
  SOURCE_CHATS: parseChannels(process.env.SOURCE_CHATS),

  // RSS feeds – defaults + any extras from env
  RSS_FEEDS: [
    'https://hnrss.org/frontpage',
    'https://dev.to/feed',
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    ...parseChannels(process.env.RSS_FEEDS),
  ],

  // Scheduler
  CRON_EXPR: process.env.CRON_EXPR ?? '0 20 * * 1,3,5',
  TIMEZONE: process.env.TIMEZONE ?? 'Asia/Tashkent',

  // Blog pipeline control
  BLOG_ENABLED: process.env.BLOG_ENABLED !== 'false',

  // Personal Digest agent
  DIGEST_CRON: process.env.DIGEST_CRON ?? '0 21 * * *',
  DIGEST_MAX_DAYS: Number(process.env.DIGEST_MAX_DAYS ?? 3),
  DIGEST_INCLUDE_PRIVATE: process.env.DIGEST_INCLUDE_PRIVATE !== 'false',
  EXCLUDE_CHATS: parseChannels(process.env.EXCLUDE_CHATS).map((s) => s.toLowerCase()),
  MAX_DIALOGS: Number(process.env.MAX_DIALOGS ?? 80),
  USER_INTERESTS:
    process.env.USER_INTERESTS ??
    'React, Next.js, TypeScript, React Native, frontend vakansiyalar, junior/intern imkoniyatlari, hackathon, grant, bepul kurslar, yangi texnologiyalar',

  // Tunable defaults
  LOOKBACK_DAYS: Number(process.env.LOOKBACK_DAYS ?? 3),
  MAX_REWRITES: Number(process.env.MAX_REWRITES ?? 5),
  DB_PATH: process.env.DB_PATH ?? './data/agent.db',
  EXPORTS_DIR: process.env.EXPORTS_DIR ?? './data/exports',

  // Topic categories
  TOPIC_WEIGHTS: process.env.TOPIC_WEIGHTS ?? 'it:50,karyera:15,imkoniyatlar:15,oqish:10,fan:10',
  ENABLE_TOPICS: parseChannels(process.env.ENABLE_TOPICS).map((s) => s.toLowerCase()),

  // Growth module
  GROWTH_PACK: process.env.GROWTH_PACK !== 'false',
  GROWTH_LANG: process.env.GROWTH_LANG ?? 'uz',
  PROMO_EVERY: Number(process.env.PROMO_EVERY ?? 3),

  // Style sources & humanizer engine
  STYLE_CHANNELS: parseChannels(process.env.STYLE_CHANNELS),
  STYLE_CHANNELS_IT: parseChannels(process.env.STYLE_CHANNELS_IT),
  STYLE_CHANNELS_KARYERA: parseChannels(process.env.STYLE_CHANNELS_KARYERA),
  STYLE_CHANNELS_IMKONIYATLAR: parseChannels(process.env.STYLE_CHANNELS_IMKONIYATLAR),
  STYLE_CHANNELS_OQISH: parseChannels(process.env.STYLE_CHANNELS_OQISH),
  STYLE_CHANNELS_FAN: parseChannels(process.env.STYLE_CHANNELS_FAN),
  STYLE_REFRESH_DAYS: Number(process.env.STYLE_REFRESH_DAYS ?? 7),
  VOICE_FROM_GROUPS: process.env.VOICE_FROM_GROUPS === 'true',
  OWNER_BIO: process.env.OWNER_BIO ?? '',
  LINT_MIN_SCORE: Number(process.env.LINT_MIN_SCORE ?? 80),
  HUMANIZE_LEVEL: process.env.HUMANIZE_LEVEL ?? 'high',
  STYLE_DIR: process.env.STYLE_DIR ?? './data/style',
  VOICE_DIR: process.env.VOICE_DIR ?? './data/voice',
};

/**
 * Return channels assigned to a category, falling back to general STYLE_CHANNELS.
 * @param {string} [categoryId]
 * @returns {string[]}
 */
export function getCategoryStyleChannels(categoryId) {
  if (!categoryId) return config.STYLE_CHANNELS;
  const key = `STYLE_CHANNELS_${String(categoryId).toUpperCase()}`;
  const specific = config[key];
  if (Array.isArray(specific) && specific.length > 0) {
    return specific;
  }
  return config.STYLE_CHANNELS;
}

