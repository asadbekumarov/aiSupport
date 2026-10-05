// src/webReader.js – fetches and extracts readable text from article URLs
/**
 * Extract URL from text if present.
 * @param {string} text
 * @returns {string|null}
 */
export function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

/**
 * Fetch and extract the main article title and text content from a web page URL.
 * @param {string} url
 * @returns {Promise<{ title: string, content: string }|null>}
 */
export async function fetchArticleContent(url) {
  if (!url) return null;

  try {
    console.log(`[webReader] Fetching article from URL: ${url}…`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,uz;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[webReader] URL returned HTTP status ${res.status}`);
      return null;
    }

    const html = await res.text();

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Extract paragraphs and meaningful text
    const paragraphs = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(html)) !== null && paragraphs.length < 20) {
      const clean = match[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (clean.length > 35) {
        paragraphs.push(clean);
      }
    }

    const content = paragraphs.join('\n\n').slice(0, 3500);
    console.log(`[webReader] Successfully extracted article: "${title.slice(0, 50)}" (${content.length} chars)`);
    return { title, content };
  } catch (err) {
    console.warn(`[webReader] Failed to fetch article from ${url}:`, err.message);
    return null;
  }
}
