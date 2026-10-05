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
  SOURCE_CHATS: (process.env.SOURCE_CHATS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // RSS feeds – defaults + any extras from env
  RSS_FEEDS: [
    'https://hnrss.org/frontpage',
    'https://dev.to/feed',
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    ...(process.env.RSS_FEEDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
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
  EXCLUDE_CHATS: (process.env.EXCLUDE_CHATS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  MAX_DIALOGS: Number(process.env.MAX_DIALOGS ?? 80),
  USER_INTERESTS:
    process.env.USER_INTERESTS ??
    'React, Next.js, TypeScript, React Native, frontend vakansiyalar, junior/intern imkoniyatlari, hackathon, grant, bepul kurslar, yangi texnologiyalar',

  // Tunable defaults
  LOOKBACK_DAYS: Number(process.env.LOOKBACK_DAYS ?? 3),
  MAX_REWRITES: Number(process.env.MAX_REWRITES ?? 5),
  DB_PATH: process.env.DB_PATH ?? './data/agent.db',
  EXPORTS_DIR: process.env.EXPORTS_DIR ?? './data/exports',
};
