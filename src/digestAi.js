// src/digestAi.js – AI analysis of digest material via Gemini
// Uses temperature 0.2, responseMimeType: "application/json", NO googleSearch.
// Runs two isolated calls (Call A: public channels/groups; Call B: private chats).
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

const candidateModels = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  config.GEMINI_MODEL,
].filter(
  (m, i, arr) =>
    arr.indexOf(m) === i &&
    m !== 'gemini-2.5-flash' &&
    m !== 'gemini-2.0-flash' &&
    m !== 'gemini-1.5-flash'
);

/**
 * Call Gemini model with candidate fallbacks and retry on high demand.
 */
async function callGemini(systemPrompt, userPrompt) {
  let lastError = null;
  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          config: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            systemInstruction: systemPrompt,
          },
        });

        const text = res.text ?? '';
        if (text) return text;
      } catch (err) {
        lastError = err;
        const msg = err.message || '';
        const isTransient =
          err.status === 503 ||
          msg.includes('503') ||
          msg.includes('high demand') ||
          msg.includes('UNAVAILABLE') ||
          err.status === 429;

        if (isTransient && attempt === 0) {
          console.warn(`[digestAi] Model "${model}" temporarily busy, retrying in 1.5s…`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        console.warn(`[digestAi] Model "${model}" failed: ${msg}. Trying next candidate…`);
        break;
      }
    }
  }
  throw lastError ?? new Error('[digestAi] All candidate models failed');
}

/**
 * Clean and parse JSON, with a single retry if the model returns malformed JSON.
 */
async function parseJsonWithRetry(systemPrompt, userPrompt) {
  const firstAttempt = await callGemini(systemPrompt, userPrompt);
  try {
    const cleaned = firstAttempt
      .replace(/```(?:json)?\s*/gi, '')
      .replace(/\s*```$/gi, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn('[digestAi] JSON parse failed on first attempt, retrying once…', err.message);
    const retryPrompt = `${userPrompt}\n\nDIQQAT: Oldingi javob JSON formatida bo'lmadi. Faqat va faqat valid JSON obyekt qaytar!`;
    const secondAttempt = await callGemini(systemPrompt, retryPrompt);
    const cleaned = secondAttempt
      .replace(/```(?:json)?\s*/gi, '')
      .replace(/\s*```$/gi, '')
      .trim();
    return JSON.parse(cleaned);
  }
}

/**
 * Split an array of chat blocks into chunks of ~30,000 characters.
 */
function chunkChatBlocks(blocks, maxChars = 30000) {
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const block of blocks) {
    const blockLength = block.text.length;
    if (currentLength + blockLength > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(block);
    currentLength += blockLength;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Call A: Analyze channels + groups (K* and G*).
 *
 * @param {Array<{ ref: string, type: string, messages: Array<{ ref: string, out: boolean, text: string }> }>} publicMaterial
 * @param {{ chats: Map<string, any>, messages: Map<string, any> }} lookup
 * @returns {Promise<{
 *   chats: Array<{ ref: string, topics: string[] }>,
 *   for_me: Array<{ msg: string, why: string }>,
 *   trends: string[]
 * }>}
 */
export async function analyzePublicChats(publicMaterial, lookup) {
  if (!publicMaterial || publicMaterial.length === 0) {
    return { chats: [], for_me: [], trends: [] };
  }

  const systemPrompt =
    `Sen mening shaxsiy yordamchimsan. Menga obuna bo'lgan kanal va guruhlardagi xabarlarni o'qib, hisobot tayyorla. ` +
    `Har bir chat uchun qaysi mavzular muhokama bo'lganini 1-3 ta qisqa band bilan ayt. Keyin men uchun foydali bo'lgan xabarlarni ajrat. ` +
    `Mening qiziqishlarim: ${config.USER_INTERESTS}. ` +
    `Reklama, spam va ahamiyatsiz gaplarni tashla. Faktlarni to'qima, faqat berilgan xabarlarga tayan. Faqat JSON qaytar.`;

  // Format each chat block
  const blocks = publicMaterial.map((chat) => {
    const header = `Chat [${chat.ref}] (${chat.type === 'channel' ? 'Kanal' : 'Guruh'}):\n`;
    const msgs = chat.messages.map((m) => `[${m.ref}] ${m.text}`).join('\n');
    return {
      ref: chat.ref,
      text: `${header}${msgs}\n\n`,
    };
  });

  const chunks = chunkChatBlocks(blocks, 30000);
  console.log(`[digestAi] Call A (Public): processing ${blocks.length} chat(s) in ${chunks.length} chunk(s)…`);

  const merged = {
    chats: [],
    for_me: [],
    trends: [],
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i].map((b) => b.text).join('\n');
    const userPrompt =
      `Quyidagi guruh va kanallar xabarlarini tahlil qil:\n\n${chunkText}\n\n` +
      `Kutilayotgan JSON formati:\n` +
      `{\n` +
      `  "chats": [{ "ref": "G2", "topics": ["Mavzu 1", "Mavzu 2"] }],\n` +
      `  "for_me": [{ "msg": "K1:3", "why": "Nima uchun qiziqishlarga mosligi" }],\n` +
      `  "trends": ["Umumiy trend 1", "Umumiy trend 2"]\n` +
      `}`;

    try {
      const result = await parseJsonWithRetry(systemPrompt, userPrompt);
      if (Array.isArray(result.chats)) {
        merged.chats.push(...result.chats);
      }
      if (Array.isArray(result.for_me)) {
        merged.for_me.push(...result.for_me);
      }
      if (Array.isArray(result.trends)) {
        merged.trends.push(...result.trends);
      }
    } catch (err) {
      console.error(`[digestAi] Call A chunk ${i + 1}/${chunks.length} failed:`, err.message ?? err);
    }
  }

  // Deduplicate and filter out refs not in lookup map
  const validChats = [];
  const seenChats = new Set();
  for (const c of merged.chats) {
    if (c && c.ref && lookup.chats.has(c.ref) && !seenChats.has(c.ref)) {
      seenChats.add(c.ref);
      validChats.push({
        ref: c.ref,
        topics: Array.isArray(c.topics) ? c.topics.map(String).filter(Boolean) : [],
      });
    }
  }

  const validForMe = [];
  const seenForMe = new Set();
  for (const f of merged.for_me) {
    if (f && f.msg && lookup.messages.has(f.msg) && !seenForMe.has(f.msg)) {
      seenForMe.add(f.msg);
      validForMe.push({
        msg: f.msg,
        why: String(f.why || ''),
      });
    }
  }

  const validTrends = Array.from(new Set(merged.trends.map(String).filter(Boolean)));

  return {
    chats: validChats,
    for_me: validForMe,
    trends: validTrends,
  };
}

/**
 * Call B: Analyze private chats (S*).
 * Analyzes conversations with people: provides summaries, key points,
 * important items, suspicious items, and pending replies.
 *
 * @param {Array<{ ref: string, type: string, messages: Array<{ ref: string, out: boolean, text: string }> }>} privateMaterial
 * @param {{ chats: Map<string, any>, messages: Map<string, any> }} lookup
 * @returns {Promise<{
 *   conversations: Array<{ ref: string, summary: string, key_points: string[] }>,
 *   important: Array<{ msg: string, kind: string, why: string }>,
 *   suspicious: Array<{ msg: string, risk: 'low'|'medium'|'high', why: string }>,
 *   need_reply: Array<{ msg: string, why: string }>
 * }>}
 */
export async function analyzePrivateChats(privateMaterial, lookup) {
  if (!privateMaterial || privateMaterial.length === 0) {
    return { conversations: [], important: [], suspicious: [], need_reply: [] };
  }

  const systemPrompt =
    `Sen mening shaxsiy yordamchimsan. Quyida mening odamlar bilan shaxsiy yozishmalarim (Sen = men yozganim, U = qarshi tomon). ` +
    `Menga quyidagilarni aniq, lo'nda va to'liq tahlil qilib ber: ` +
    `1) conversations: Har bir shaxsiy suhbat (chat) bo'yicha qisqacha xulosa va asosiy muhokama qilingan mavzular (ref, summary: 1-2 ta tushunarli gap, key_points: 1-3 ta band). Har bir odam bilan nima haqida gaplashilgani aniq bo'lsin. ` +
    `2) important: Muhim narsalar (muddat/deadline, uchrashuv, ish yoki HR xabari, to'lov, men bergan va'da, muhim qaror). ` +
    `3) suspicious: Shubhali xabarlar (pul, karta yoki tasdiqlash kodi so'rash, shoshiltirish va bosim, g'alati yoki qisqartirilgan link, avans to'lov evaziga ish yoki daromad va'dasi, kripto yoki investitsiya taklifi, o'zini bank/Telegram/davlat idorasi deb tanishtirish, tanish ismidan yangi raqamdan pul so'rash, tahdid, shubhali fayl .apk/.exe). ` +
    `4) need_reply: Menga berilgan, javob kutilayotgan savollar. ` +
    `MUHIM TALAB: Sen to'g'ridan-to'g'ri menga hisobot bermoqdasan. Menga murojaat qilganda HAR DOIM 'Siz' deb yoz! Hech qachon 'foydalanuvchi', 'Asadbek' yoki uchinchi shaxsda gapirma! Masalan: 'Siz unga va'da bergansiz', 'U Sizdan so'ramoqda', 'Siz yozgansiz', 'Sizning hisobingiz'. ` +
    `Aybdor qilma, 'tekshirib ko'ring' tarzida yoz. Hech narsa to'qima. Faqat JSON qaytar.`;

  // Format each private chat block
  const blocks = privateMaterial.map((chat) => {
    const header = `Chat [${chat.ref}] (Yozishma):\n`;
    const msgs = chat.messages
      .map((m) => `[${m.ref}] ${m.out ? 'Sen' : 'U'}: ${m.text}`)
      .join('\n');
    return {
      ref: chat.ref,
      text: `${header}${msgs}\n\n`,
    };
  });

  const chunks = chunkChatBlocks(blocks, 30000);
  console.log(`[digestAi] Call B (Private): processing ${blocks.length} chat(s) in ${chunks.length} chunk(s)…`);

  const merged = {
    conversations: [],
    important: [],
    suspicious: [],
    need_reply: [],
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i].map((b) => b.text).join('\n');
    const userPrompt =
      `Quyidagi shaxsiy yozishmalarni tahlil qil:\n\n${chunkText}\n\n` +
      `Kutilayotgan JSON formati:\n` +
      `{\n` +
      `  "conversations": [{ "ref": "S2", "summary": "Suhbat xulosasi", "key_points": ["Mavzu 1", "Mavzu 2"] }],\n` +
      `  "important": [{ "msg": "S3:4", "kind": "deadline|meeting|work|payment|promise|other", "why": "Sababi" }],\n` +
      `  "suspicious": [{ "msg": "S1:2", "risk": "low|medium|high", "why": "Nega shubhali" }],\n` +
      `  "need_reply": [{ "msg": "S2:9", "why": "Qanday savol berilgan" }]\n` +
      `}`;

    try {
      const result = await parseJsonWithRetry(systemPrompt, userPrompt);
      if (Array.isArray(result.conversations)) {
        merged.conversations.push(...result.conversations);
      }
      if (Array.isArray(result.important)) {
        merged.important.push(...result.important);
      }
      if (Array.isArray(result.suspicious)) {
        merged.suspicious.push(...result.suspicious);
      }
      if (Array.isArray(result.need_reply)) {
        merged.need_reply.push(...result.need_reply);
      }
    } catch (err) {
      console.error(`[digestAi] Call B chunk ${i + 1}/${chunks.length} failed:`, err.message ?? err);
    }
  }

  // Deduplicate and filter out refs not in lookup map
  const validConversations = [];
  const seenConversations = new Set();
  for (const c of merged.conversations) {
    if (c && c.ref && lookup.chats.has(c.ref) && !seenConversations.has(c.ref)) {
      seenConversations.add(c.ref);
      validConversations.push({
        ref: c.ref,
        summary: String(c.summary || ''),
        key_points: Array.isArray(c.key_points) ? c.key_points.map(String).filter(Boolean) : [],
      });
    }
  }

  const validImportant = [];
  const seenImportant = new Set();
  for (const item of merged.important) {
    if (item && item.msg && lookup.messages.has(item.msg) && !seenImportant.has(item.msg)) {
      seenImportant.add(item.msg);
      validImportant.push({
        msg: item.msg,
        kind: String(item.kind || 'other'),
        why: String(item.why || ''),
      });
    }
  }

  const validSuspicious = [];
  const seenSuspicious = new Set();
  for (const item of merged.suspicious) {
    if (item && item.msg && lookup.messages.has(item.msg) && !seenSuspicious.has(item.msg)) {
      seenSuspicious.add(item.msg);
      const risk = ['low', 'medium', 'high'].includes(item.risk) ? item.risk : 'medium';
      validSuspicious.push({
        msg: item.msg,
        risk,
        why: String(item.why || ''),
      });
    }
  }

  const validNeedReply = [];
  const seenNeedReply = new Set();
  for (const item of merged.need_reply) {
    if (item && item.msg && lookup.messages.has(item.msg) && !seenNeedReply.has(item.msg)) {
      seenNeedReply.add(item.msg);
      validNeedReply.push({
        msg: item.msg,
        why: String(item.why || ''),
      });
    }
  }

  return {
    conversations: validConversations,
    important: validImportant,
    suspicious: validSuspicious,
    need_reply: validNeedReply,
  };
}
