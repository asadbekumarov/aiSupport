// src/format.js – converts AI output to safe Telegram HTML
// Telegram HTML allows: <b>, <i>, <u>, <s>, <a href>, <code>, <pre>, <blockquote>

const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'a']);

/**
 * Escape &, <, > in a plain-text string.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert stray Markdown to HTML equivalents, then sanitize the HTML so only
 * Telegram-safe tags survive. Escapes raw text nodes properly.
 *
 * @param {string} raw – raw AI output (may mix HTML and Markdown)
 * @returns {string} – safe Telegram HTML
 */
export function toTelegramHtml(raw) {
  let text = raw ?? '';

  // ── 1. Markdown → HTML conversions ──────────────────────────────────────

  // ## Heading → <b>Heading</b>
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // **bold** → <b>bold</b>
  text = text.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');

  // *italic* or _italic_ → <i>…</i>  (single star/underscore)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, '<i>$1</i>');
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs, '<i>$1</i>');

  // `code` → <code>code</code>
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // "* item" or "- item" bullet → "• item"
  text = text.replace(/^[ \t]*[*\-]\s+/gm, '• ');

  // ── 2. HTML sanitisation ─────────────────────────────────────────────────

  // We parse the HTML-like string ourselves to avoid pulling in a full DOM lib.
  // State machine: iterate characters, emit safe output.
  let out = '';
  let i = 0;
  const openTagStack = [];   // track open tags for auto-close

  while (i < text.length) {
    if (text[i] !== '<') {
      // Plain text – collect until next '<' and escape it
      let j = i;
      while (j < text.length && text[j] !== '<') j++;
      out += escapeHtml(text.slice(i, j));
      i = j;
      continue;
    }

    // We're at '<' – try to parse a tag
    const tagEnd = text.indexOf('>', i);
    if (tagEnd === -1) {
      // Unclosed '<' – treat as literal text
      out += '&lt;';
      i++;
      continue;
    }

    const tagContent = text.slice(i + 1, tagEnd); // e.g. "b", "/b", "a href=\"…\""
    const isClosing = tagContent.startsWith('/');
    const rawTag = isClosing ? tagContent.slice(1).trim() : tagContent.trim();

    // Extract tag name (first word)
    const tagName = rawTag.split(/[\s/]/)[0].toLowerCase();

    if (ALLOWED_TAGS.has(tagName)) {
      if (!isClosing) {
        if (tagName === 'a') {
          // Allow <a href="https://..."> only; strip other attributes
          const hrefMatch = tagContent.match(/href=["']([^"']+)["']/i);
          if (hrefMatch && /^https?:\/\//i.test(hrefMatch[1])) {
            const safeHref = hrefMatch[1].replace(/"/g, '&quot;');
            out += `<a href="${safeHref}">`;
            openTagStack.push('a');
          }
          // Skip <a> tags without valid http/https href
        } else {
          out += `<${tagName}>`;
          openTagStack.push(tagName);
        }
      } else {
        // Closing tag – only emit if the tag is actually open
        const idx = [...openTagStack].reverse().findIndex((t) => t === tagName);
        if (idx !== -1) {
          // Close all inner tags first, then the matched one
          const closeFrom = openTagStack.length - 1 - idx;
          while (openTagStack.length > closeFrom) {
            out += `</${openTagStack.pop()}>`;
          }
        }
      }
    }
    // Unknown/disallowed tags are silently dropped

    i = tagEnd + 1;
  }

  // ── 3. Auto-close any unclosed tags ──────────────────────────────────────
  while (openTagStack.length > 0) {
    out += `</${openTagStack.pop()}>`;
  }

  return out.trim();
}

/**
 * Strip all HTML tags and unescape entities – returns plain text.
 * Useful as fallback if Telegram rejects the HTML.
 * @param {string} html
 * @returns {string}
 */
export function stripTags(html) {
  return (html ?? '')
    .replace(/<\/?(b|i|u|s|code|pre|blockquote|a)[^>]*>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
