// src/aiService.js – Gemini & Groq integration for post generation
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { toTelegramHtml } from './format.js';
import { HARD_EXCLUSIONS } from './topics.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// ─── CTA ideas ─────────────────────────────────────────────────────────────
// ─── CTA ideas ─────────────────────────────────────────────────────────────
// Forward / share / discussion requests fitting the post.
// NEVER ask readers to subscribe because they are already channel subscribers.
const CTA_IDEAS = [
  "Buni ish qidirayotgan yoki loyihasi bor do'stingga yubor — foydasi tegishi aniq! 🤝",
  "Fikringni izohlarda yoz — birga muhokama qilamiz! 💬",
  "Ushbu ma'lumotni yangi texnologiyalarga qiziqqan do'stingga ulash! 💡",
  "Buni jamoangiz chatiga yoki dasturchi tanishingizga forward qilib qo'y! 📲",
  "Buni foydali deb bilgan do'stingga yubor — birga o'rganish osonroq! 👥",
  "Siz ham shu holat yoki vositaga duch kelganmisiz? Tajribangizni izohlarda ulashing! 💡",
  "Qaysi mavzuni keyingi postda tahlil qilishimizni xohlaysiz? Fikringizni yozing! 🗳️",
  "Buni yangiliklardan orqada qolishni istamaydigan hamkasbingizga yuboring! ⚡",
];

/** Returns a random CTA string. */
export function pickCta() {
  return CTA_IDEAS[Math.floor(Math.random() * CTA_IDEAS.length)];
}

// ─── System prompt builder ─────────────────────────────────────────────────
export function buildSystemPrompt(category = { id: 'it', name: 'IT va Texnologiyalar', guidance: "IT yangiliklari, dasturlash, AI, vositalar, o'zbekistonlik dasturchi uchun foydasi." }) {
  const isIt = category.id === 'it';

  let categoryBlock = `\nKanal asosan IT haqida, lekin ba'zan boshqa foydali mavzularda ham yozadi. Bugungi postning yo'nalishi: ${category.name}. ${category.guidance}. Maqsad o'zgarmaydi: o'zbek auditoriyasiga foydali post va do'stlarga ulashishga undovchi samimiy CTA.`;

  if (!isIt) {
    categoryBlock += `\nUshbu postni umumiy o'zbek yoshlari auditoriyasi uchun (faqat dasturchilar uchun emas) moslashtirib, sodda va tushunarli tilda yoz. Barcha asosiy qoidalarga rioya qil: lotin yozuvi, 150–250 so'z, to'qima faktlarsiz, o'z so'zlaring bilan, sun'iy (AI) iboralardan xoli, faqat Telegram HTML teglari.`;
  }

  let specialRules = '';
  if (category.id === 'pul') {
    specialRules += `\n\nMOLIYAVIY SAVODXONLIK TALABI: Hech qachon investitsiya maslahati berma va daromad va'da qilma. Post oxirida albatta qisqa bitta jumla qo'sh: "Bu moliyaviy maslahat emas."`;
  } else if (category.id === 'imkoniyatlar') {
    specialRules += `\n\nIMKONIYATLAR TALABI: Faqat tasdiqlangan, muddati (deadline) hali o'tmagan imkoniyat haqida yoz. Muddat va rasmiy havola postda albatta bo'lsin. Ishonchli havola yoki aniq muddat topilmasa, boshqa mavzu tanla va hech narsa to'qima.`;
  }

  const exclusions = HARD_EXCLUSIONS.join(', ');

  return `Sen IT sohasidagi mutaxassissan. Maqsading — o'quvchilarga eng foydali va amaliy yangiliklarni ulashish. Har bir postda qiziqarli sarlavha, sodda o'zbek tilidagi tushuntirish va o'quvchilarni do'stlariga forward qilishga / ulashishga undaydigan tabiiy Call-to-Action (CTA) bo'lsin.
${categoryBlock}${specialRules}

QAT'IY TAQIQLANGAN MAVZULAR (HARD EXCLUSIONS):
Har qanday kategoriya uchun quyidagi mavzular qat'iyan taqiqlanadi: ${exclusions}. Agar to'plangan material yoki qidiruv natijalari shu mavzularga olib kelsa, AI albatta boshqa mavzu tanlashi shart.

QOIDALAR:
1. Til: O'zbek tili, lotin yozuvi. Texnik atamalar inglizcha qolsin (framework, API, deploy, open source, bug, release va h.k.).
2. Uzunlik: 150–250 so'z.
3. Tuzilma:
   • Bitta kuchli sarlavha (qalin, 1 emoji bilan boshlansin)
   • Nima bo'ldi — qisqa, aniq
   • Nima uchun muhim / Auditoriya uchun nima ma'no anglatadi
   • CTA (bitta qisqa gap, samimiy forward/ulashish so'rovi)
   • 2–3 hashtag
4. QAT'IY QOIDA — OBUNA SO'RAMASLIK: Postda HECH QACHON "obuna bo'ling", "kanalga a'zo bo'ling" yoki "kanalda qoling" kabi iboralarni ishlatma (chunki o'quvchilar allaqachon kanal obunachisidir). CTA faqat post mazmuniga mos bitta aniq ulashish taklifi bo'lsin (masalan: "Buni ish qidirayotgan do'stingga yubor").
5. Uslub: Jonli, do'stona, qisqa gaplar. AI yozgandek ko'rinmasin. Uslub namunalaridan faqat ohang, gap uzunligi, emoji ishlatish va tuzilmani ol — hech qachon gaplarni ko'chirma.
6. Faktlar: Faqat berilgan materialdan yoki Google Search tasdiqlagan ma'lumotdan foydalan. O'zing ixtiro qilma.
7. Manbalar: Agar ishonchli havola bo'lsa, oxirida bitta havolani HTML <a href> bilan qo'sh.
8. Takrorlamaslik: "OLDIN CHIQQAN MAVZULAR" ro'yxatidagi mavzularni qayta ko'tarma.
9. Em-tire (—) va shablonli iboralardan qoching.
10. Standard emoji ishlatgin, maxsus/premium emoji yo'q.
11. Maxsus mavzu: Agar "FOYDALANUVCHINING MAXSUS TOPSHIRIG'I / MAVZUSI" yoki "MAQOLA / MANBA MATNI" taqdim etilgan bo'lsa, postni to'liq va faqat shu mavzuga bag'ishlab yoz. Umumiy RSS va guruh xabarlariga chalg'ima.

JAVOB FORMATI (faqat shu, boshqa narsa yo'q):
MAVZU: <qisqa mavzu sarlavhasi>
---
<post HTML matni>`;
}

/**
 * Build the user-facing prompt with all collected data.
 */
function buildUserPrompt({
  category = { id: 'it', name: 'IT va Texnologiyalar' },
  groupMessages,
  rssItems,
  styleSamples,
  recentTopics,
  cta,
  previousDraft,
  feedback,
  customTopic,
  customUrlContent,
}) {
  const today = new Date().toLocaleDateString('uz-Latn-UZ', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines = [
    `📅 Bugungi sana: ${today}`,
    `🎯 POST YO'NALISHI / KATEGORIYASI: ${category.name} (${category.id})`,
  ];

  if (category.searchHint) {
    lines.push(`🔍 Google Search / Qidiruv tavsiyasi: ${category.searchHint}`);
  }
  lines.push('');

  // Group messages from Telegram chats
  if (groupMessages?.length > 0) {
    lines.push('── GURUH MUHOKAMALAR ──────────────────');
    for (const { chat, messages } of groupMessages) {
      lines.push(`\n[${chat}]`);
      messages.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
    }
    lines.push('');
  } else {
    lines.push('── GURUH MUHOKAMALAR: mavjud emas (yoki boshqa kategoriya) ──\n');
  }

  // RSS news items
  if (rssItems?.length > 0) {
    lines.push('── RSS YANGILIKLAR ────────────────────');
    rssItems.forEach(({ source, title, link, summary }, i) => {
      lines.push(`\n${i + 1}. [${source}] ${title}`);
      if (link) lines.push(`   🔗 ${link}`);
      if (summary) lines.push(`   ${summary}`);
    });
    lines.push('');
  } else {
    lines.push('── RSS YANGILIKLAR: mavjud emas (Google Search orqali qidiring) ──\n');
  }

  // Style samples – tone/structure reference only
  if (styleSamples?.length > 0) {
    lines.push(`── USLUB NAMUNALARI (faqat ohang/tuzilma uchun, ko'chirma!) ──`);
    styleSamples.forEach((s, i) => lines.push(`\n[${i + 1}]\n${s}`));
    lines.push('');
  }

  // Recent topics to avoid duplicates (covers all categories)
  if (recentTopics?.length > 0) {
    lines.push(`── OLDIN CHIQQAN MAVZULAR (takrorlamaslik uchun) ──────────`);
    recentTopics.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }

  // CTA idea for this post
  lines.push(`── CTA G'OYASI ───────────────────────`);
  lines.push(cta);
  lines.push('');

  // Rewrite context
  if (previousDraft) {
    lines.push(`── OLDINGI DRAFT (shunga o'xshash bo'lmasin) ──────────`);
    lines.push(previousDraft);
    lines.push('');
  }

  // Custom user topic or article URL content
  if (customTopic) {
    lines.push('── FOYDALANUVCHINING MAXSUS TOPSHIRIG\'I / MAVZUSI ──');
    lines.push(customTopic);
    lines.push('');
  }

  if (customUrlContent) {
    lines.push('── MAQOLA / MANBA MATNI (Havola orqali yuklangan) ──');
    if (customUrlContent.title) lines.push(`Sarlavha: ${customUrlContent.title}`);
    lines.push(customUrlContent.content || String(customUrlContent));
    lines.push('');
  }

  if (feedback) {
    lines.push('── EGASINING IZOHI / TUZATISH ──────────────────────────');
    lines.push(feedback);
    lines.push('');
  }

  lines.push('Endi post yoz.');
  return lines.join('\n');
}

/**
 * Parse the model response in "MAVZU: …\n---\n<html>" format.
 * Returns {topic, text, needsImage, imagePrompt} or throws if format is wrong.
 */
function parseResponse(responseText) {
  const match = responseText.match(/MAVZU:\s*(.+?)\n-{3,}\n([\s\S]+)/i);
  if (!match) {
    throw new Error(`[aiService] Unexpected model response format:\n${responseText.slice(0, 200)}`);
  }
  return {
    topic: match[1].trim(),
    text: toTelegramHtml(match[2].trim()),
  };
}

/**
 * Call Gemini/Groq with the given materials and return {topic, text}.
 * If the output is over 4000 chars, asks once more for a shorter version.
 *
 * @param {object} params
 * @param {object} [params.category]       – selected topic category
 * @param {Array}  [params.groupMessages]  – [{chat, messages[]}]
 * @param {Array}  [params.rssItems]       – [{source, title, link, summary}]
 * @param {Array}  [params.styleSamples]   – string[]
 * @param {Array}  [params.recentTopics]   – string[]
 * @param {string} params.cta              – selected CTA idea
 * @param {string} [params.previousDraft]
 * @param {string} [params.feedback]
 * @param {string} [params.customTopic]    – user-specified custom topic
 * @param {object} [params.customUrlContent] – {title, content} from article URL
 * @returns {Promise<{topic: string, text: string}>}
 */
export async function generatePost({
  category = { id: 'it', name: 'IT va Texnologiyalar' },
  groupMessages = [],
  rssItems = [],
  styleSamples = [],
  recentTopics = [],
  cta,
  previousDraft,
  feedback,
  customTopic,
  customUrlContent,
}) {
  const model = config.GEMINI_MODEL;
  const systemPrompt = buildSystemPrompt(category);
  const userPrompt = buildUserPrompt({
    category,
    groupMessages,
    rssItems,
    styleSamples,
    recentTopics,
    cta,
    previousDraft,
    feedback,
    customTopic,
    customUrlContent,
  });

  const candidateModels = [
    model,
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.7-flash',
    'gemini-3.5-flash-lite',
  ].filter(
    (m, i, arr) =>
      arr.indexOf(m) === i &&
      Boolean(m) &&
      m !== 'gemini-flash-latest' &&
      m !== 'gemini-2.5-flash' &&
      m !== 'gemini-2.0-flash'
  );

  // ── Groq Provider (Primary when GROQ_API_KEY is configured) ─────────────
  if (config.GROQ_API_KEY) {
    try {
      const groqModel = config.GROQ_MODEL || 'qwen/qwen3.8-27b';
      console.log(`[aiService] Generating post with Groq (${groqModel}) for category "${category.id}"…`);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? '';
        if (text) {
          const result = parseResponse(text);
          console.log(`[aiService] Successfully generated via Groq: "${result.topic}"`);
          return result;
        }
      } else {
        const errBody = await res.text();
        console.warn(`[aiService] Groq HTTP ${res.status}: ${errBody.slice(0, 150)}`);
      }
    } catch (err) {
      console.warn('[aiService] Groq error, falling back to Gemini:', err.message);
    }
  }

  async function callModel(contents) {
    let lastError = null;
    for (const m of candidateModels) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model: m,
            contents,
            config: {
              temperature: 0.9,
              systemInstruction: systemPrompt,
              tools: [{ googleSearch: {} }],
            },
          });
          if (res.text) return res;
        } catch (err) {
          lastError = err;
          const msg = err.message || '';
          const isTransient =
            err.status === 503 ||
            msg.includes('503') ||
            msg.includes('high demand') ||
            msg.includes('UNAVAILABLE') ||
            err.status === 429;

          if (isTransient && attempt < 2) {
            const delay = (attempt + 1) * 2000;
            console.warn(`[aiService] Model "${m}" vaqtincha band, ${delay}ms kutilmoqda (urinish ${attempt + 1}/3)…`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          console.warn(`[aiService] Model "${m}" javob bermadi: ${msg.slice(0, 100)}. Keyingi modelga o'tilmoqda…`);
          break;
        }
      }
    }
    throw lastError ?? new Error('[aiService] Barcha Gemini modellari javob bera olmadi');
  }

  console.log(`[aiService] Generating post with Gemini model "${model}" for category "${category.id}"…`);

  const response = await callModel([{ role: 'user', parts: [{ text: userPrompt }] }]);

  let responseText = response.text ?? '';
  let result = parseResponse(responseText);

  // If the generated HTML is too long, ask for a shorter version once
  if (result.text.length > 4000) {
    console.log(`[aiService] Post too long (${result.text.length} chars), requesting shorter version…`);

    const shorterResponse = await callModel([
      { role: 'user', parts: [{ text: userPrompt }] },
      { role: 'model', parts: [{ text: responseText }] },
      {
        role: 'user',
        parts: [{ text: "Postni qisqaroq qil — 150–250 so'z bo'lsin. Formatni saqlagan holda qayta yoz." }],
      },
    ]);

    responseText = shorterResponse.text ?? '';
    result = parseResponse(responseText);
  }

  console.log(`[aiService] Generated topic: "${result.topic}" (${result.text.length} chars) [category: ${category.id}]`);
  return result;
}
