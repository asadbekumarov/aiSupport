// scripts/test-all.js – Comprehensive health check & verification for aiSupport
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Bot } from 'grammy';
import { GoogleGenAI } from '@google/genai';
import Parser from 'rss-parser';
import { config } from '../src/config.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function pass(title, detail = '') {
  console.log(`  ${colors.green}✔ [PASS]${colors.reset} ${colors.bold}${title}${colors.reset} ${detail}`);
}

function fail(title, error) {
  console.log(`  ${colors.red}✖ [FAIL]${colors.reset} ${colors.bold}${title}${colors.reset} ${colors.red}${error}${colors.reset}`);
}

function warn(title, detail = '') {
  console.log(`  ${colors.yellow}⚠ [WARN]${colors.reset} ${colors.bold}${title}${colors.reset} ${colors.yellow}${detail}${colors.reset}`);
}

function header(title) {
  console.log(`\n${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
}

const summary = { passed: 0, failed: 0, warned: 0 };

async function runTest(name, fn) {
  try {
    const res = await fn();
    summary.passed++;
    return res;
  } catch (err) {
    summary.failed++;
    fail(name, err.message ?? err);
    return null;
  }
}

async function main() {
  console.log(`\n${colors.bold}🔍 aiSupport Tizimini Diagnostika Qilish Boshlandi...${colors.reset}`);

  // ── 1. CONFIG & ENV CHECK ───────────────────────────────────────────────────
  header('1. Konfiguratsiya (.env) Tekshiruvi');
  const requiredKeys = [
    'TG_API_ID',
    'TG_API_HASH',
    'TG_SESSION',
    'BOT_TOKEN',
    'MY_CHAT_ID',
    'CHANNEL_USERNAME',
    'GEMINI_API_KEY',
  ];

  let configOk = true;
  for (const key of requiredKeys) {
    if (!process.env[key]) {
      fail(`Env o'zgaruvchi: ${key}`, 'Mavjud emas yoki bo\'sh!');
      configOk = false;
      summary.failed++;
    } else {
      let mask = process.env[key];
      if (mask.length > 8) {
        mask = mask.slice(0, 4) + '...' + mask.slice(-4);
      }
      pass(`Env o'zgaruvchi: ${key}`, `(${mask})`);
      summary.passed++;
    }
  }

  if (isNaN(config.TG_API_ID)) {
    fail('TG_API_ID raqam bo\'lishi kerak', config.TG_API_ID);
    summary.failed++;
  }
  if (isNaN(config.MY_CHAT_ID)) {
    fail('MY_CHAT_ID raqam bo\'lishi kerak', config.MY_CHAT_ID);
    summary.failed++;
  }

  // ── 2. DATABASE INTEGRITY CHECK ─────────────────────────────────────────────
  header('2. SQLite Ma\'lumotlar Bazasi Tekshiruvi');
  await runTest('SQLite Bazasi va Jadvallar', async () => {
    const db = new DatabaseSync(config.DB_PATH);
    const integrity = db.prepare('PRAGMA integrity_check;').get();
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`Integrity xatosi: ${JSON.stringify(integrity)}`);
    }

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table';")
      .all()
      .map((t) => t.name);

    pass('SQLite Integrity check', 'Baza holati: OK');
    pass('Mavjud jadvallar', `[ ${tables.join(', ')} ]`);

    // Drafts / posts count
    const postCount = db.prepare('SELECT COUNT(*) as count FROM posts;').get()?.count ?? 0;
    const draftCount = db.prepare('SELECT COUNT(*) as count FROM drafts;').get()?.count ?? 0;
    pass('Ma\'lumotlar soni', `Postlar: ${postCount} ta, Qoralamalar: ${draftCount} ta`);
  });

  // ── 3. TELEGRAM BOT (grammY) CHECK ──────────────────────────────────────────
  header('3. Telegram Bot (grammY) Tekshiruvi');
  let botUser = null;
  await runTest('Bot Ulanishi va getMe()', async () => {
    const bot = new Bot(config.BOT_TOKEN);
    botUser = await bot.api.getMe();
    pass('Bot profil ma\'lumotlari', `@${botUser.username} (ID: ${botUser.id}, Ismi: ${botUser.first_name})`);

    // Check channel admin status
    try {
      const chat = await bot.api.getChat(config.CHANNEL_USERNAME);
      pass('Kanal topildi', `Nomi: "${chat.title}" (${config.CHANNEL_USERNAME})`);

      const member = await bot.api.getChatMember(config.CHANNEL_USERNAME, botUser.id);
      if (member.status === 'administrator' || member.status === 'creator') {
        const canPost = member.status === 'creator' || member.can_post_messages;
        if (canPost) {
          pass('Kanal huquqi', 'Bot kanalda administrator va xabar yuborish huquqiga ega.');
        } else {
          warn('Kanal huquqi', 'Bot admin, lekin "can_post_messages" huquqi yo\'q!');
          summary.warned++;
        }
      } else {
        warn('Kanal huquqi', `Bot kanalda admin emas! Hozirgi status: ${member.status}`);
        summary.warned++;
      }
    } catch (err) {
      warn('Kanal tekshiruvi', `Kanalni tekshirib bo'lmadi (${config.CHANNEL_USERNAME}): ${err.message}`);
      summary.warned++;
    }
  });

  // ── 4. TELEGRAM USERBOT (GramJS) CHECK ──────────────────────────────────────
  header('4. Telegram UserBot (GramJS) Tekshiruvi');
  await runTest('UserBot Ulanishi va Dialoglar', async () => {
    const client = new TelegramClient(
      new StringSession(config.TG_SESSION),
      config.TG_API_ID,
      config.TG_API_HASH,
      { connectionRetries: 2, timeout: 10000 }
    );

    console.log('   Ulanilmoqda...');
    await client.connect();

    const me = await client.getMe();
    pass('UserBot hisobi', `Ismi: ${me.firstName} | Username: @${me.username ?? 'yo\'q'} | Telefon: +${me.phone}`);

    const dialogs = await client.getDialogs({ limit: 5 });
    pass('Dialoglarni o\'qish', `${dialogs.length} ta dialog muvaffaqiyatli o'qildi.`);

    await client.disconnect();
    pass('UserBot seansi', 'Xavfsiz yakunlandi.');
  });

  // ── 5. GEMINI AI CHECK ──────────────────────────────────────────────────────
  header('5. Gemini AI API Tekshiruvi');
  await runTest('Gemini API Javob Qaytarishi', async () => {
    const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    const modelsToTry = [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      config.GEMINI_MODEL,
      'gemini-flash-latest',
    ].filter((m, i, arr) => arr.indexOf(m) === i && Boolean(m));

    let workedModel = null;
    let replyText = '';

    for (const m of modelsToTry) {
      try {
        const start = Date.now();
        const res = await ai.models.generateContent({
          model: m,
          contents: 'Salom! O\'zbek tilida 1 ta qisqa jumla bilan IT yangiliklar botiga salom ber.',
        });
        const elapsed = Date.now() - start;
        workedModel = m;
        replyText = res.text?.trim() ?? '';
        pass(`Gemini Model [${m}]`, `Muvaffaqiyatli (${elapsed}ms): "${replyText.slice(0, 80)}..."`);
        break;
      } catch (err) {
        warn(`Model [${m}]`, `Xato: ${err.message}`);
        summary.warned++;
      }
    }

    if (!workedModel) {
      throw new Error('Hech bir Gemini modeli orqali javob olib bo\'lmadi!');
    }
  });

  // ── 6. RSS FEEDS CHECK ──────────────────────────────────────────────────────
  header('6. RSS Yangilik Tasmalari Tekshiruvi');
  await runTest('RSS Tasmalaridan Ma\'lumot Olish', async () => {
    const parser = new Parser({ timeout: 8000 });
    let totalItems = 0;

    for (const feedUrl of config.RSS_FEEDS.slice(0, 3)) {
      try {
        const feed = await parser.parseURL(feedUrl);
        pass(`RSS Manba: ${feed.title ?? feedUrl}`, `${feed.items?.length ?? 0} ta yangilik topildi`);
        totalItems += feed.items?.length ?? 0;
      } catch (err) {
        warn(`RSS Manba: ${feedUrl}`, `Yuklab bo'lmadi: ${err.message}`);
        summary.warned++;
      }
    }

    if (totalItems === 0) {
      warn('RSS Tasmalar', 'Hech qanday yangilik o\'qib bo\'lmadi.');
    }
  });

  // ── NATIJALAR ───────────────────────────────────────────────────────────────
  header('XULOSA VA NATIJALAR');
  console.log(`  ${colors.green}Muvaffaqiyatli testlar: ${summary.passed}${colors.reset}`);
  if (summary.warned > 0) {
    console.log(`  ${colors.yellow}Ogohlantirishlar:       ${summary.warned}${colors.reset}`);
  }
  if (summary.failed > 0) {
    console.log(`  ${colors.red}Xatoliklar:             ${summary.failed}${colors.reset}`);
  } else {
    console.log(`\n  ${colors.bold}${colors.green}🎉 Barcha asosiy tekshiruvlar muvaffaqiyatli yakunlandi! Tizim to'liq ishga tayyor.${colors.reset}\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\nDiagnostikada kutilmagan xatolik:', err);
  process.exit(1);
});
