// src/aiService.js – Multi-pass generation pipeline: Draft → Edit → Lint → Judge
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { toTelegramHtml, stripTags } from './format.js';
import { HARD_EXCLUSIONS } from './topics.js';
import { lintPost } from './humanLint.js';
import { getStyleProfile } from './styleProfile.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

// ─── CTA ideas ─────────────────────────────────────────────────────────────
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
export function buildSystemPrompt(category = { id: 'it', name: 'IT va Texnologiyalar' }, profile = {}) {
  const isIt = category.id === 'it';
  const guide = profile?.guide || {};
  const targetStats = profile?.targetStats || {};

  let categoryBlock = `\nBugungi postning yo'nalishi: ${category.name}. ${category.guidance || ''}. Maqsad: o'zbek auditoriyasiga haqiqiy inson yozgan, jonli, o'qishli va foydali post taqdim etish.`;

  if (!isIt) {
    categoryBlock += `\nUshbu postni kengroq o'zbek auditoriyasi uchun moslashtirib, sodda, tushunarli va qiziqarli tilda yoz.`;
  }

  let specialRules = '';
  if (category.id === 'pul') {
    specialRules += `\n\nMOLIYAVIY SAVODXONLIK TALABI: Hech qachon investitsiya maslahati berma va daromad va'da qilma. Post oxirida albatta qisqa bitta jumla qo'sh: "Bu moliyaviy maslahat emas."`;
  } else if (category.id === 'imkoniyatlar') {
    specialRules += `\n\nIMKONIYATLAR TALABI: Faqat tasdiqlangan, muddati (deadline) hali o'tmagan imkoniyat haqida yoz. Muddat va rasmiy havola postda albatta bo'lsin.`;
  }

  const exclusions = HARD_EXCLUSIONS.join(', ');

  let guideHighlights = '';
  if (guide.tone) {
    guideHighlights += `\nKANALNING O'ZIGA XOS USLUBI:\n• Ohang: ${guide.tone}\n• Ritm: ${guide.sentence_rhythm || ''}`;
    if (guide.vocabulary_and_connectors?.length) {
      guideHighlights += `\n• Xarakterli so'z va bog'lovchilar: ${guide.vocabulary_and_connectors.slice(0, 5).join(', ')}`;
    }
  }

  let statsGuidance = '';
  if (targetStats.avgSentenceLength) {
    statsGuidance = `\nMAQSADLI KO'RSATKICHLAR:\n• O'rtacha gap uzunligi: ~${targetStats.avgSentenceLength} so'z (xilma-xil og'ish: std dev ~${targetStats.sentenceStdDev || 4.5})\n• Emoji soni: ~${targetStats.emojisPerPost || 3} ta (har qator boshida EMOJI BO'LMASIN!)\n• Abzatslar: ~${targetStats.avgParagraphs || 4} ta`;
  }

  return `Sen tajribali o'zbekistonlik IT mutaxassis va blog muallifisan. Yozgan posting hech qachon sun'iy intellekt (AI) yozgandek ko'rinmasligi, balki haqiqiy tirik insonning samimiy fikridek o'qilishi shart.
${categoryBlock}${specialRules}${guideHighlights}${statsGuidance}

QAT'IY TAQIQLANGAN MAVZULAR: ${exclusions}.

QAT'IY YOZISH QOIDALARI (INSONIY USLUB TALABLARI):
1. Gap uzunligi keskin farq qilsin: qisqa gaplar (2-5 so'z) va uzunroqlar aralash kelsin; to'liq bo'lmagan gaplar ham mumkin.
2. Aniq narsa yoz: nom, raqam, misol, vaziyat. Umumiy va mavhum gaplardan qoch.
3. Bitta aniq fikr yoki baho bo'lsin (xolis, zerikarli "ikki tomonlama" rasmiy gaplar emas).
4. TAQIQ: uzun tire (—, –), "Xulosa qilib aytganda", "Bugungi raqamli dunyoda", "Zamonaviy dunyoda", "Shuni ta'kidlash joizki", "muhim ahamiyatga ega", "nafaqat ... balki ...", "Keling, ...", "Ushbu", uchtalik ro'yxat qolipi (A, B va C), har qatorni emoji bilan boshlash, hamma gapni bir xil so'z bilan boshlash, tartibli "xulosa" abzatsi, "Sarlavha: izoh" qolipi.
5. Rasmiy kitobiy so'zlar o'rniga sodda so'zlashuv so'zlari; texnik atamalar inglizcha qoladi (framework, deploy, backend, bug, release va h.k.).
6. Oxiri yumshoq tugasin: "xulosa" yozma, fikr yoki savol bilan tugat (uslub profiliga qarab).
7. SHAXSIY TAJRIBA QOIDASI: Uslub namunalari birinchi shaxs nomidan ("men") yozilgan bo'lsa ham, HECH QACHON o'zingdan shaxsiy tajriba, test, raqam yoki hikoyalar to'qima! Birinchi shaxs tajribasi FAQAT berilgan EGASINING FIKRI (OWNER_NOTES / /fikr) yoki OWNER_BIO da mavjud bo'lsagina ruxsat etiladi; aks holda mutlaqo xolis, neytral va informativ tilda aniq misollar bilan yoz.
8. KITOB VA MANBALAR QOIDASI: Kitob sharhi yoki manbaga asoslangan postlarda, agar materialda kitob/maqola nomi va muallifi taqdim etilgan bo'lsa, ularni postda albatta aniq tilga olgin. Materialda berilmagan yoki mavjud bo'lmagan manbani esa aslo da'vo qilma / to'qima.
9. OBUNA SO'RAMASLIK: "obuna bo'ling", "kanalga a'zo bo'ling" yoki "kanalda qoling" deb yozma.
10. Faqat ruxsat etilgan Telegram HTML teglari: <b>, <i>, <code>, <a href="...">.
11. Uzunlik: 150–250 so'z.

JAVOB FORMATI:
MAVZU: <qisqa mavzu sarlavhasi>
---
<post HTML matni>`;
}

/**
 * Build user-facing prompt for Pass 1 (Draft generation).
 */
function buildUserPrompt({
  category = { id: 'it', name: 'IT va Texnologiyalar' },
  groupMessages = [],
  rssItems = [],
  styleSamples = [],
  recentTopics = [],
  cta = '',
  previousDraft = null,
  feedback = null,
  customTopic = null,
  customUrlContent = null,
  ownerNote = null,
  ownerBio = '',
  targetStats = {},
  styleGuide = {},
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
    lines.push(`🔍 Qidiruv tavsiyasi: ${category.searchHint}`);
  }
  lines.push('');

  // Owner's authentic bio and opinion note
  if (ownerBio) {
    lines.push('── KANAL EGASI HAQIDA QISQA FAKTLAR (OWNER_BIO) ──────────');
    lines.push(ownerBio);
    lines.push('');
  }

  if (ownerNote) {
    lines.push('── EGASINING HAQIQIY FIKRI / TAJRIBASI (OWNER_NOTE) ──────');
    lines.push(`"${ownerNote}"`);
    lines.push(
      "DIQQAT: Ushbu fikrni/tajribani post ichiga tabiiy ravishda birinchi shaxs nomidan singdirib yoz. Boshqa to'qima tajriba qo'shma."
    );
    lines.push('');
  } else {
    lines.push('── EGASINING FIKRI: Yo\'q. Shaxsiy tajriba to\'qima! Xolis, aniq misollar bilan yoz.');
    lines.push('');
  }

  // Group messages
  if (groupMessages?.length > 0) {
    lines.push('── GURUH MUHOKAMALARI (manba) ──────────────────────────');
    for (const { chat, messages } of groupMessages) {
      lines.push(`\n[${chat}]`);
      messages.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
    }
    lines.push('');
  }

  // RSS items
  if (rssItems?.length > 0) {
    lines.push('── RSS YANGILIKLAR (manba) ─────────────────────────────');
    rssItems.forEach(({ source, title, link, summary }, i) => {
      lines.push(`\n${i + 1}. [${source}] ${title}`);
      if (link) lines.push(`   🔗 ${link}`);
      if (summary) lines.push(`   ${summary}`);
    });
    lines.push('');
  }

  // Style samples – clearly labeled
  if (styleSamples?.length > 0) {
    lines.push(`── USLUB NAMUNALARI (uslub namunasi (ko'chirma qilma)) ────`);
    styleSamples.forEach((s, i) => {
      const text = typeof s === 'string' ? s : s?.text || '';
      const srcLabel = s?.source === 'voice' ? 'Shaxsiy muallif ovozi (Voice)' : 'Brand namunasi';
      lines.push(`\n[${i + 1}] (${srcLabel})\n${text}`);
    });
    lines.push('');
  }

  // Style guide highlights & target stats
  if (styleGuide?.tone || targetStats?.avgSentenceLength) {
    lines.push('── USLUB VA STATISTIKA MAQSADI ─────────────────────────');
    if (targetStats?.avgSentenceLength) {
      lines.push(
        `O'rtacha gap: ~${targetStats.avgSentenceLength} so'z; Std Dev: ~${targetStats.sentenceStdDev}; Emojilar: ~${targetStats.emojisPerPost} ta; Qalin: ${Math.round((targetStats.boldShare || 0.8) * 100)}%`
      );
    }
    if (styleGuide?.never_do?.length) {
      lines.push(`Mualliflar hech qachon qilmaydi: ${styleGuide.never_do.join('; ')}`);
    }
    lines.push('');
  }

  // Recent topics
  if (recentTopics?.length > 0) {
    lines.push(`── OLDIN CHIQQAN MAVZULAR (takrorlamaslik uchun) ──────────`);
    recentTopics.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
    lines.push('');
  }

  // CTA
  if (cta) {
    lines.push(`── CTA G'OYASI ──────────────────────────────────────────`);
    lines.push(cta);
    lines.push('');
  }

  // Previous draft & feedback (for rewrite)
  if (previousDraft) {
    lines.push(`── OLDINGI DRAFT (buni takrorlama) ──────────────────────`);
    lines.push(previousDraft);
    lines.push('');
  }

  if (feedback) {
    lines.push('── EGASINING TUZATISHI / IZOHI ─────────────────────────');
    lines.push(feedback);
    lines.push('');
  }

  if (customTopic) {
    lines.push('── MAXSUS TOPSHIRIQ / MAVZU ───────────────────────────');
    lines.push(customTopic);
    lines.push('');
  }

  if (customUrlContent) {
    lines.push('── MAQOLA / HAVOLA MATNI ───────────────────────────────');
    if (customUrlContent.title) lines.push(`Sarlavha: ${customUrlContent.title}`);
    lines.push(customUrlContent.content || String(customUrlContent));
    lines.push('');
  }

  lines.push('Endi barcha qoidalarga rioya qilgan holda post yoz.');
  return lines.join('\n');
}

/**
 * Parse response in "MAVZU: …\n---\n<html>" format.
 * @param {string} responseText
 * @returns {{ topic: string, text: string }}
 */
function parseResponse(responseText) {
  const match = responseText.match(/MAVZU:\s*(.+?)\n-{3,}\n([\s\S]+)/i);
  if (!match) {
    // Fallback if header is slightly off
    const lines = responseText.split('\n');
    const firstLine = lines[0].replace(/^(?:MAVZU:\s*|#+\s*)/i, '').trim();
    const rest = lines.slice(1).join('\n').replace(/^-{3,}\s*/, '').trim();
    return {
      topic: firstLine || 'IT Yangilik',
      text: toTelegramHtml(rest || responseText),
    };
  }
  return {
    topic: match[1].trim(),
    text: toTelegramHtml(match[2].trim()),
  };
}

/**
 * Universal model caller supporting Groq (if configured) and Gemini candidate fallback.
 *
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @param {number} [params.temperature=0.85]
 * @param {boolean} [params.useSearch=true]
 * @param {string} [params.responseMimeType]
 * @returns {Promise<string>}
 */
async function callAiModel({
  systemPrompt,
  userPrompt,
  temperature = 0.85,
  useSearch = false,
  responseMimeType,
}) {
  // 1. Try Groq if configured (only if Google search is not strictly required)
  if (config.GROQ_API_KEY && !useSearch && !responseMimeType) {
    try {
      const groqModel = config.GROQ_MODEL || 'qwen/qwen3.8-27b';
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content ?? '';
        if (content) return content;
      }
    } catch (err) {
      console.warn('[aiService] Groq failed, using Gemini:', err.message);
    }
  }

  // 2. Gemini candidate models
  const candidateModels = [
    config.GEMINI_MODEL,
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

  let lastError = null;

  for (const m of candidateModels) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const genConfig = {
          temperature,
          systemInstruction: systemPrompt,
        };
        if (useSearch) {
          genConfig.tools = [{ googleSearch: {} }];
        }
        if (responseMimeType) {
          genConfig.responseMimeType = responseMimeType;
        }

        const res = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          config: genConfig,
        });

        if (res.text) return res.text;
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
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
  }

  throw lastError ?? new Error('[aiService] Gemini modellari javob bermadi.');
}

/**
 * Pass 2: Editor AI call.
 * Rewrites the draft to eliminate AI tells and fix lint issues without adding new claims or facts.
 *
 * @param {object} params
 * @param {string} params.draftText
 * @param {string} params.topic
 * @param {object} params.profile
 * @param {Array<object>} params.issues
 * @param {Array<string>} [params.suspiciousPhrases]
 * @returns {Promise<string>}
 */
async function runEditorPass({
  draftText,
  topic,
  profile = {},
  issues = [],
  suspiciousPhrases = [],
}) {
  const guide = profile?.guide || {};
  const targetStats = profile?.targetStats || {};

  const systemPrompt = `Sen mohir, sinchkov Telegram muharririsan.
Vazifang — quyida keltirilgan post qoralamasini tahrirlab, undagi barcha sun'iy intellekt (AI) belgilarini, shablon qoliplarni va lint xatolarini TO'LIQ yo'qotish.

QAT'IY QOIDALAR:
1. Yangi faktlar, havolalar yoki shaxsiy da'volar QO'SHMA. Bor ma'lumotni saqlagan holda ifodani jonlantir.
2. Gap uzunligini xilma-xil qil: qisqa gaplar (2-5 so'z) bilan uzunroqlarini aralashtir.
3. Uzun tire (—, –) QAT'IYAN TAQIQLANADI. O'rniga oddiy defis (-) yoki boshqa tinish belgisi ishlat.
4. "Xulosa qilib aytganda", "Bugungi raqamli dunyoda", "Zamonaviy dunyoda", "Shuni ta'kidlash joizki", "muhim ahamiyatga ega", "nafaqat ... balki ...", "Keling, ...", "Ushbu", uchtalik ro'yxat ("A, B va C") qoliplarini butunlay olib tashla.
5. Har bir qatorni emoji bilan boshlash taqiqlanadi. Faqat 2-4 ta emoji qoldir.
6. Sarlavhada "Sarlavha: izoh" qolipi bo'lmasin.
7. Faqat Telegram HTML teglari (<b>, <i>, <code>, <a>) bo'lsin.
8. Uzunlik: 150–250 so'z.

Format: Faqat tahrirlangan post matnini HTML ko'rinishida chiqar (hech qanday izohsiz).`;

  const issueLines = issues.map((i) => `• [${i.type}] ${i.message}`).join('\n');
  let suspiciousBlock = '';
  if (suspiciousPhrases.length > 0) {
    suspiciousBlock = `\nQuyidagi iboralar sun'iy (AI-yozgan) deb topildi, ularni tabiiy tilda qayta yoz:\n${suspiciousPhrases.map((p) => `• "${p}"`).join('\n')}`;
  }

  const userPrompt = `Quyidagi postni tahrirla:

MAVZU: ${topic}

HOZIRGI DRAFT:
${draftText}

ANIQLANGAN MUAMMOLAR (LINT ISSUES):
${issueLines || 'AI shablonlarini tozalash va ritmni yaxshilash kerak.'}
${suspiciousBlock}

USLUB KO'RSATKICHLARI:
• O'rtacha gap: ~${targetStats.avgSentenceLength || 9} so'z
• Emojilar: ~${targetStats.emojisPerPost || 3} ta

Endi postni tahrirlangan variantini Telegram HTML formatida qaytar.`;

  const edited = await callAiModel({
    systemPrompt,
    userPrompt,
    temperature: 0.6,
    useSearch: false,
  });

  return toTelegramHtml(edited.trim());
}

/**
 * Optional Judge (HUMANIZE_LEVEL=high):
 * Asks Gemini whether text reads like AI-written and extracts suspicious phrases.
 *
 * @param {string} text
 * @returns {Promise<{ score: number, suspiciousPhrases: string[] }>}
 */
async function runHumanJudge(text) {
  const systemPrompt = `Sen matn uslubi tahlilchisisan. Berilgan o'zbek tilidagi postni o'rganib, uning sun'iy intellekt (AI) tomonidan yozilganlik ehtimolini xolis bahola.
0 - mutlaqo insoniy, tabiiy, jonli til.
10 - yaqqol AI shabloni (qolip iboralar, bir xil gap uzunligi, sun'iy xulosa).

Faqat quyidagi JSON formatida javob ber:
{
  "score": 0,
  "suspicious_phrases": ["..."]
}`;

  const userPrompt = `Quyidagi matnni bahola:\n\n${stripTags(text)}`;

  try {
    const raw = await callAiModel({
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      useSearch: false,
      responseMimeType: 'application/json',
    });

    const parsed = JSON.parse(raw.trim());
    return {
      score: Number(parsed.score ?? 0),
      suspiciousPhrases: Array.isArray(parsed.suspicious_phrases) ? parsed.suspicious_phrases : [],
    };
  } catch (err) {
    console.warn('[aiService] Human judge pass skipped due to parse error:', err.message);
    return { score: 0, suspiciousPhrases: [] };
  }
}

/**
 * Orchestrated generation pipeline: Pass 1 (Draft) → Pass 2 (Edit) → Lint Loop → Judge.
 *
 * @param {object} params
 * @returns {Promise<{ topic: string, text: string }>}
 */
export async function generatePost(params = {}) {
  const {
    category = { id: 'it', name: 'IT va Texnologiyalar' },
    groupMessages = [],
    rssItems = [],
    styleSamples = [],
    recentTopics = [],
    recentPostTexts = [],
    cta = '',
    previousDraft = null,
    feedback = null,
    customTopic = null,
    customUrlContent = null,
    ownerNote = null,
  } = params;

  // 1. Get style profile for the specific category
  const profile = await getStyleProfile({ category: category.id }).catch(() => ({}));
  const targetStats = profile?.targetStats || {};
  const styleGuide = profile?.guide || {};

  // 2. Build system and user prompts for Pass 1 (Draft)
  const systemPrompt = buildSystemPrompt(category, profile);
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
    ownerNote,
    ownerBio: config.OWNER_BIO,
    targetStats,
    styleGuide,
  });

  console.log(`[aiService] Generating draft for category "${category.id}"…`);
  const rawDraft = await callAiModel({
    systemPrompt,
    userPrompt,
    temperature: 0.85,
    useSearch: !customTopic && !customUrlContent,
  });

  let { topic, text: currentText } = parseResponse(rawDraft);

  // Sources for 7-gram COPY CHECK
  const copySources = {
    styleSamples,
    groupMessages,
    rssItems,
    recentPosts: recentPostTexts,
  };

  // 3. Initial Lint
  let currentLint = lintPost(currentText, profile, copySources);
  console.log(
    `[humanLint] Initial draft score: ${currentLint.score}/100. Issues: [${currentLint.issues.map((i) => i.type).join(', ')}]`
  );

  let bestText = currentText;
  let bestScore = currentLint.score;

  // 4. Editor Retry Loop (if score < LINT_MIN_SCORE)
  const minScore = config.LINT_MIN_SCORE || 80;
  let retries = 0;

  while (bestScore < minScore && retries < 2) {
    retries++;
    console.log(`[humanLint] Score (${bestScore}) < threshold (${minScore}). Running editor pass (retry #${retries})…`);

    try {
      const edited = await runEditorPass({
        draftText: bestText,
        topic,
        profile,
        issues: currentLint.issues,
      });

      const editedLint = lintPost(edited, profile, copySources);
      console.log(
        `[humanLint] Retry #${retries} score: ${editedLint.score}/100. Issues: [${editedLint.issues.map((i) => i.type).join(', ')}]`
      );

      if (editedLint.score > bestScore) {
        bestScore = editedLint.score;
        bestText = edited;
        currentLint = editedLint;
      }

      if (bestScore >= minScore) {
        break;
      }
    } catch (err) {
      console.warn(`[aiService] Editor pass #${retries} failed:`, err.message);
      break;
    }
  }

  // 5. Optional Judge Pass (HUMANIZE_LEVEL=high)
  if (config.HUMANIZE_LEVEL === 'high') {
    try {
      const judge = await runHumanJudge(bestText);
      console.log(
        `[humanJudge] AI-feel score: ${judge.score}/10. Suspicious phrases: ${judge.suspiciousPhrases.length}`
      );

      if (judge.score > 4) {
        console.log('[humanJudge] Score > 4, running final targeted editor pass…');
        const refined = await runEditorPass({
          draftText: bestText,
          topic,
          profile,
          issues: currentLint.issues,
          suspiciousPhrases: judge.suspiciousPhrases,
        });

        const refinedLint = lintPost(refined, profile, copySources);
        console.log(
          `[humanLint] Post-judge score: ${refinedLint.score}/100. Issues: [${refinedLint.issues.map((i) => i.type).join(', ')}]`
        );

        if (refinedLint.score >= bestScore - 10) {
          bestText = refined;
          bestScore = refinedLint.score;
        }
      }
    } catch (judgeErr) {
      console.warn('[aiService] Optional judge pass error:', judgeErr.message);
    }
  }

  // 6. Ensure character limit (Telegram 4000 char limit)
  if (bestText.length > 4000) {
    bestText = bestText.slice(0, 3950) + '…';
  }

  console.log(`[aiService] Final post ready: "${topic}" (${bestText.length} chars, lint score: ${bestScore}/100)`);
  return {
    topic,
    text: bestText,
  };
}
