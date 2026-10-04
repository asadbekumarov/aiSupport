// src/privacy.js – redacting sensitive info (emails, phones, cards, tokens, codes)
// Ensures personal and private data is masked before being sent to Gemini AI.

/**
 * Redacts sensitive tokens/patterns in text:
 * - Emails -> [email]
 * - Phone numbers -> [tel]
 * - 13-19 digit card numbers -> [karta]
 * - 24+ char token-like strings -> [token]
 * - Standalone 4-8 digit codes -> [kod]
 *
 * NOTE: Words like 'parol', 'kod', 'password' are NOT dropped because
 * someone asking for a code or password is a crucial scam/phishing indicator.
 *
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  if (!text) return '';
  let res = String(text);

  // Preserve URLs temporarily so URL parameters, IDs and paths aren't corrupted
  const urls = [];
  res = res.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    urls.push(url);
    return `__URL_PLACEHOLDER_${urls.length - 1}__`;
  });

  // 1. Email addresses
  res = res.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '[email]');

  // 2. Telegram Bot Tokens (e.g. 123456789:ABCdefGHIjkl...)
  res = res.replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '[token]');

  // 3. Tokens / API Keys (24+ characters of base64, hex, JWT, or alphanumeric with dashes/dots/underscores)
  res = res.replace(/\b[A-Za-z0-9_\-.]{24,}\b/g, '[token]');

  // 4. Card-like numbers (13-19 digits, spaced or hyphenated e.g. 8600 1234 5678 9012 or continuous)
  res = res.replace(/\b(?:\d{4}[ -]){3}\d{1,7}\b|\b\d{13,19}\b/g, '[karta]');

  // 5. Phone numbers (+998 90 123 45 67, +998901234567, (90) 123-45-67, etc.)
  res = res.replace(/(?:\+?\d{1,3}[-.\s]*)?(?:\(?\d{2,4}\)?[-.\s]*)?\d{3}[-.\s]*\d{2}[-.\s]*\d{2}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 13) {
      return '[tel]';
    }
    return match;
  });

  // 6. Standalone 4-8 digit codes (SMS OTPs, PINs, etc.)
  res = res.replace(/\b\d{4,8}\b/g, '[kod]');

  // Restore URLs
  res = res.replace(/__URL_PLACEHOLDER_(\d+)__/g, (_, idx) => urls[Number(idx)] || '');

  return res;
}

/**
 * Filter sensitive messages for blog pipeline only.
 * Blog pipeline drops any message containing sensitive keywords or credentials.
 * @param {string} text
 * @returns {boolean}
 */
export function isSensitiveForBlog(text) {
  if (!text) return false;
  return /\b(parol|kod|password|secret|token|api[_-]?key|karta|cvv)\b/i.test(text);
}
