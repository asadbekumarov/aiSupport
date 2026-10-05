// src/aiService.js – Gemini integration for post generation
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { toTelegramHtml } from './format.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// ─── CTA ideas ─────────────────────────────────────────────────────────────
// A variety of calls-to-action so each post feels fresh.
const CTA_IDEAS = [
  "Do'stlaringni ham taklif qil — ularga ham foydali bo'lishi mumkin! 👇",
  'Fikringni izohlarda qoldiring — biz muhokama qilamiz! 💬',
  "Bu haqda batafsil bilishni xohlaysanmi? Savol ber — javob beramiz! 🙋",
  "Kanalingga qo'sh va har yangilikdan birinchi xabardor bo'l! 🔔",
  "Buni foydali deb bilgan do'stingga ulash — ikki kishi foydalanar! 🤝",
  "Siz ham shu texnologiyani ishlatganmisiz? Tajribangizni yozing! 💡",
  "Obuna bo'lib qol — IT dunyosidagi yangiliklar har kuni shu yerda! 📲",
  "Qaysi texnologiyani keyingi postda tahlil qilishimni izohlarda yoz! 🗳️",
];

/** Returns a random CTA string. */
export function pickCta() {
  return CTA_IDEAS[Math.floor(Math.random() * CTA_IDEAS.length)];
}

// ─── System prompt (in Uzbek as required) ─────────────────────────────────
const SYSTEM_PROMPT = `\
Sen IT sohasidagi mutaxassissan. Maqsading — o'quvchilarga foydali IT yangiliklarini ulashish va 1 oy ichida kanalga 100+ ta yangi faol obunachi yig'ish. Har bir postda qiziqarli sarlavha, sodda o'zbek tilidagi tushuntirish va o'quvchilarni do'stlarini taklif qilishga undaydigan kreativ Call-to-Action (CTA) bo'lsin.

QOIDALAR:
1. Til: O'zbek tili, lotin yozuvi. Texnik atamalar inglizcha qolsin (framework, API, deploy, open source, bug, release va h.k.).
2. Uzunlik: 150–250 so'z.
3. Tuzilma:
   • Bitta kuchli sarlavha (qalin, 1 emoji bilan boshlansin)
   • Nima bo'ldi — qisqa, aniq
   • Nima uchun muhim / O'zbekistondagi dasturchi uchun nima ma'no anglatadi
   • CTA (taqdim etilgan g'oyani ishlatib, original tarzda)
   • 2–3 hashtag
4. Uslub: Jonli, do'stona, qisqa gaplar. AI yozgandek ko'rinmasin. Uslub namunalaridan faqat ohang, gap uzunligi, emoji ishlatish va tuzilmani ol — hech qachon gaplarni ko'chirma.
5. Faktlar: Faqat berilgan materialdan yoki Google Search tasdiqlagan ma'lumotdan foyda. O'zi ixtiro qilma.
6. Manbalar: Agar ishonchli havola bo'lsa, oxirida bitta havolani HTML <a href> bilan qo'sh.
7. Takrorlamaslik: "recentTopics" ro'yxatidagi mavzularni qayta ko'tarma.
8. Em-tire (—) va shablonli iboralardan qoching.
9. Standard emoji ishlatgin, maxsus/premium emoji yo'q.
10. Maxsus mavzu: Agar "FOYDALANUVCHINING MAXSUS MAVZUSI" yoki "MAQOLA / MANBA MATNI" taqdim etilgan bo'lsa, postni to'liq va faqat shu mavzuga bag'ishlab yoz. Umumiy RSS va guruh xabarlariga chalg'ima.

JAVOB FORMATI (faqat shu, boshqa narsa yo'q):
MAVZU: <qisqa mavzu sarlavhasi>
---
<post HTML matni>`;

/**
 * Build the user-facing prompt with all collected data.
 */
function buildUserPrompt({
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

  const lines = [`📅 Bugungi sana: ${today}`, ''];

  // Group messages from Telegram chats
  if (groupMessages?.length > 0) {
    lines.push('── GURUH MUHOKAMALAR ──────────────────');
    for (const { chat, messages } of groupMessages) {
      lines.push(`\n[${chat}]`);
      messages.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
    }
    lines.push('');
  } else {
    lines.push('── GURUH MUHOKAMALAR: mavjud emas ──\n');
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
    lines.push('── RSS YANGILIKLAR: mavjud emas ──\n');
  }

  // Style samples – tone/structure reference only
  if (styleSamples?.length > 0) {
    lines.push(`── USLUB NAMUNALARI (faqat ohang/tuzilma uchun, ko'chirma!) ──`);
    styleSamples.forEach((s, i) => lines.push(`\n[${i + 1}]\n${s}`));
    lines.push('');
  }

  // Recent topics to avoid duplicates
  if (recentTopics?.length > 0) {
    lines.push(`── SO'NGGI MAVZULAR (takrorlamaslik uchun) ──────────────`);
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
 * Call Gemini with the given materials and return {topic, text}.
 * If the output is over 4000 chars, asks once more for a shorter version.
 *
 * @param {object} params
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
  const userPrompt = buildUserPrompt({
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
    'gemini-3.1-pro-preview',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
  ].filter((m, i, arr) => arr.indexOf(m) === i && Boolean(m) && m !== 'gemini-flash-latest');

  // ── Groq Provider (Primary when GROQ_API_KEY is configured) ─────────────
  if (config.GROQ_API_KEY) {
    try {
      const groqModel = config.GROQ_MODEL || 'qwen/qwen3.8-27b';
      console.log(`[aiService] Generating post with Groq (${groqModel})…`);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
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
              systemInstruction: SYSTEM_PROMPT,
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

  console.log(`[aiService] Generating post with Gemini model "${model}"…`);

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

  console.log(`[aiService] Generated topic: "${result.topic}" (${result.text.length} chars)`);
  return result;
}

