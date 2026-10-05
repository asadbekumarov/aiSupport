// src/growthPack.js – Multi-platform distribution pack generator (LinkedIn, video scripts, hooks, carousels)
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { stripTags } from './format.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

/**
 * Generate distribution pack from published Telegram post text and send to owner.
 * Errors here are caught and logged so publishing is never affected.
 *
 * @param {object} params
 * @param {string} params.postTopic
 * @param {string} params.postText
 * @param {string} params.channelUsername
 * @param {import('grammy').Api} params.botApi
 * @param {number} params.ownerChatId
 */
export async function generateGrowthPack({
  postTopic,
  postText,
  channelUsername,
  botApi,
  ownerChatId,
}) {
  if (!config.GROWTH_PACK) {
    console.log('[growthPack] GROWTH_PACK is disabled.');
    return;
  }

  console.log(`[growthPack] Generating distribution pack for "${postTopic}"…`);

  try {
    const lang = config.GROWTH_LANG || 'uz';
    const cleanChannel = channelUsername.replace('@', '');
    const channelLink = `https://t.me/${cleanChannel}`;

    const langInstruction =
      lang === 'en'
        ? 'Generate all content in English.'
        : "Generate all content in Uzbek (Latin script, lotin yozuvida). Do'stona, samimiy va jonli ohang.";

    const systemPrompt = `You are an expert social media and content growth strategist for technical creators.
Your task is to take a published Telegram blog post and create a distribution pack across multiple platforms.
${langInstruction}

REQUIREMENTS:
1. "linkedin": 100–150 words. Natural, personal first-person tone (NOT corporate, NOT AI-sounding). Share a personal perspective or lesson learned. End with a pointer to the Telegram channel: ${channelLink}.
2. "video_script": 30–40 second vertical video script (Reels/Shorts/TikTok).
   - Hook: first 2 seconds (grab attention immediately).
   - 3 short beats/tips (punchy, high energy).
   - Closing line: pointing viewers to the Telegram channel (${channelLink}).
3. "hooks": exactly 3 alternative attention-grabbing first lines / titles that could be used for Twitter, Threads, or future posts.
4. "carousel": array of 4 to 6 short, punchy slides suitable for an Instagram or LinkedIn carousel. Each slide should be 1-3 sentences.
5. "hashtags": array of 3–5 relevant hashtags (e.g. #dasturlash, #it, #karyera).

OUTPUT FORMAT:
Output MUST be a single valid JSON object with EXACTLY these keys:
{
  "linkedin": "...",
  "video_script": "...",
  "hooks": ["...", "...", "..."],
  "carousel": ["slide 1 text", "slide 2 text", "slide 3 text", ...],
  "hashtags": ["#tag1", "#tag2", ...]
}
Do not include any text before or after the JSON.`;

    const userPrompt = `PUBLISHED POST TOPIC: ${postTopic}\n\nPUBLISHED POST TEXT:\n${stripTags(postText)}`;

    let rawJsonText = '';

    // 1. Try Groq first for fast, reliable JSON generation
    if (config.GROQ_API_KEY) {
      try {
        const groqModel = config.GROQ_MODEL || 'qwen/qwen3.8-27b';
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
            response_format: { type: 'json_object' },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          rawJsonText = data.choices?.[0]?.message?.content ?? '';
        } else {
          console.warn(`[growthPack] Groq status ${res.status}, falling back to Gemini`);
        }
      } catch (gErr) {
        console.warn('[growthPack] Groq call failed, trying Gemini:', gErr.message);
      }
    }

    // 2. Fallback to Gemini if needed
    if (!rawJsonText && config.GEMINI_API_KEY) {
      const model = config.GEMINI_MODEL || 'gemini-2.5-flash';
      const candidateModels = [
        model,
        'gemini-3.8-flash',
        'gemini-3.5-flash',
        'gemini-2.5-flash',
      ].filter((m, i, arr) => arr.indexOf(m) === i && Boolean(m) && m !== 'gemini-flash-latest');

      for (const m of candidateModels) {
        try {
          const res = await ai.models.generateContent({
            model: m,
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            config: {
              temperature: 0.8,
              systemInstruction: systemPrompt,
              responseMimeType: 'application/json',
            },
          });
          if (res.text) {
            rawJsonText = res.text;
            break;
          }
        } catch (mErr) {
          console.warn(`[growthPack] Gemini model ${m} failed:`, mErr.message);
        }
      }
    }

    if (!rawJsonText) {
      console.warn('[growthPack] Failed to get response from AI providers.');
      return;
    }

    const data = parseGrowthJson(rawJsonText);
    if (!data) {
      console.warn('[growthPack] Could not parse JSON from AI response.');
      return;
    }

    // Format final message for owner
    let msg = `📣 <b>Tarqatish paketi (Growth Pack)</b>\n\n`;
    msg += `📢 <b>Kanal:</b> ${channelLink}\n`;
    msg += `📌 <b>Mavzu:</b> <code>${postTopic}</code>\n\n`;

    if (data.linkedin) {
      msg += `💼 <b>LinkedIn Post (100–150 so'z):</b>\n${escapeHtml(data.linkedin)}\n\n`;
    }

    if (data.video_script) {
      msg += `🎬 <b>Video ssenariy (30–40 soniya):</b>\n${escapeHtml(data.video_script)}\n\n`;
    }

    if (Array.isArray(data.hooks) && data.hooks.length > 0) {
      msg += `🪝 <b>3 ta Muqobil Hook:</b>\n`;
      data.hooks.forEach((h, i) => {
        msg += `${i + 1}. <i>${escapeHtml(h)}</i>\n`;
      });
      msg += '\n';
    }

    if (Array.isArray(data.carousel) && data.carousel.length > 0) {
      msg += `📱 <b>Karusel slaydlari:</b>\n`;
      data.carousel.forEach((slide, i) => {
        msg += `<b>${i + 1}/${data.carousel.length}:</b> ${escapeHtml(slide)}\n`;
      });
      msg += '\n';
    }

    if (Array.isArray(data.hashtags) && data.hashtags.length > 0) {
      msg += `🏷️ <b>Hashtaglar:</b> ${data.hashtags.map((h) => escapeHtml(h)).join(' ')}`;
    }

    // Send formatted message(s) to owner
    const chunks = splitText(msg, 3900);
    for (const chunk of chunks) {
      try {
        await botApi.sendMessage(ownerChatId, chunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        console.warn('[growthPack] HTML send failed, trying plain text:', err.message);
        await botApi.sendMessage(ownerChatId, stripTags(chunk));
      }
    }

    console.log('[growthPack] Distribution pack successfully sent to owner.');
  } catch (fatalErr) {
    console.error('[growthPack] Unexpected error in generateGrowthPack:', fatalErr.message);
  }
}

/**
 * Safely parse JSON from model output.
 */
function parseGrowthJson(raw) {
  try {
    let clean = raw.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    }
    return JSON.parse(clean);
  } catch {
    // Try regex matching { ... }
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitText(text, maxLength = 3900) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
