// scripts/login.js – one-time GramJS login to generate a StringSession
// Run: node scripts/login.js
// Prints the session string to paste into .env as TG_SESSION.
// ⚠️  WARNING: The session string gives full access to your Telegram account.
//              Keep it secret. Never commit it to version control.

import 'dotenv/config';
import { createInterface } from 'node:readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const API_ID = Number(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH ?? '';

if (!API_ID || !API_HASH) {
  console.error('[login] TG_API_ID and TG_API_HASH must be set in .env first.');
  process.exit(1);
}

/** Prompt the user for input via readline. */
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

console.log('─'.repeat(60));
console.log(' GramJS – One-Time Login');
console.log('─'.repeat(60));
console.log('⚠️  WARNING: The session string printed below gives FULL');
console.log('   access to your Telegram account. Keep it secret!');
console.log('─'.repeat(60));

const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
  connectionRetries: 3,
});

await client.start({
  phoneNumber: async () => prompt('📱 Phone number (with country code, e.g. +998901234567): '),
  password: async () => prompt('🔐 2FA password (leave blank if none): '),
  phoneCode: async () => prompt('📩 SMS code from Telegram: '),
  onError: (err) => {
    console.error('[login] Error during login:', err.message ?? err);
  },
});

const sessionString = client.session.save();

console.log('\n' + '─'.repeat(60));
console.log('✅ Login successful!');
console.log('─'.repeat(60));
console.log('\nPaste this into your .env file as TG_SESSION=\n');
console.log(sessionString);
console.log('\n' + '─'.repeat(60));
console.log('⚠️  This string = full Telegram account access. Guard it!');
console.log('─'.repeat(60) + '\n');

await client.disconnect();
process.exit(0);
