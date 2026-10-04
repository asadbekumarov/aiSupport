// index.js – application entry point
// Validates config → starts UserBot → wires handlers → starts scheduler → starts bot
import 'dotenv/config';
import { assertConfig, config } from './src/config.js';

// ── 1. Validate required environment variables before doing anything else ──
assertConfig([
  'TG_API_ID',
  'TG_API_HASH',
  'TG_SESSION',
  'BOT_TOKEN',
  'MY_CHAT_ID',
  'CHANNEL_USERNAME',
  'GEMINI_API_KEY',
]);

// ── 2. Import modules (after env is validated) ─────────────────────────────
import { getClient, disconnectClient } from './src/userbot.js';
import { runPipeline } from './src/pipeline.js';
import { runDigest } from './src/digest.js';
import { startScheduler } from './src/scheduler.js';
import { bot, setGenerateHandler, setDigestHandler, notifyOwner } from './src/bot.js';

// ── 3. Wire the handlers (breaks circular imports) ─────────────────────────
setGenerateHandler(runPipeline);
setDigestHandler(runDigest);

// ── 4. Connect the UserBot (GramJS) ───────────────────────────────────────
console.log('[index] Connecting UserBot…');
try {
  await getClient();
  console.log('[index] UserBot connected.');
} catch (err) {
  console.error('[index] UserBot connection failed:', err.message ?? err);
  console.warn('[index] Continuing without UserBot (only RSS will be used for material).');
}

// ── 5. Start the cron scheduler ────────────────────────────────────────────
let schedulerTask;
try {
  schedulerTask = startScheduler(runPipeline, runDigest);
  console.log('[index] Schedulers started.');
} catch (err) {
  // Bad cron expression – warn but don't crash; manual commands still work
  console.error('[index] Scheduler failed to start:', err.message);
  await notifyOwner(`⚠️ Scheduler xatosi: ${err.message}`);
}

// ── 6. Start the grammY bot ────────────────────────────────────────────────
console.log('[index] Starting grammY bot (long-polling)…');
bot.start({
  onStart: async (info) => {
    console.log(`[index] Bot started as @${info.username}. Ready.`);
    try {
      await bot.api.setMyCommands([
        { command: 'start', description: 'Bosh menyu va yordam' },
        { command: 'digest', description: 'Shaxsiy dayjest hisobotini olish' },
        { command: 'digest_status', description: 'Dayjest holati va sozlamalari' },
        { command: 'generate', description: 'Yangi blog post qoralamasi yaratish' },
        { command: 'status', description: 'Blog statistikasi va holat' },
      ]);
    } catch (err) {
      console.warn('[index] Failed to register bot commands menu:', err.message);
    }
  },
});

// ── 7. Graceful shutdown ───────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[index] Received ${signal}. Shutting down…`);

  schedulerTask?.stop();

  try {
    await bot.stop();
    console.log('[index] grammY bot stopped.');
  } catch (err) {
    console.error('[index] Error stopping bot:', err.message);
  }

  try {
    await disconnectClient();
    console.log('[index] UserBot disconnected.');
  } catch (err) {
    console.error('[index] Error disconnecting UserBot:', err.message);
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
