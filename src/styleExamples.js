// src/styleExamples.js – loads Telegram Desktop channel export files for style reference
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

/** @type {string[] | null} */
let _cachedSamples = null;

/**
 * Parse a single export JSON file and return qualifying post texts.
 * Telegram Desktop exports messages in result.json.
 * The `text` field can be a plain string or an array of strings/objects.
 *
 * @param {string} filePath
 * @returns {string[]}
 */
function parseExportFile(filePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[styleExamples] Could not parse ${filePath}:`, err.message);
    return [];
  }

  const messages = raw?.messages ?? [];
  const results = [];

  for (const msg of messages) {
    // Only own posts, not forwarded messages
    if (msg.type !== 'message') continue;
    if (msg.forwarded_from) continue;

    // Flatten the text field: string | (string | {text: string})[]
    let text = '';
    if (typeof msg.text === 'string') {
      text = msg.text;
    } else if (Array.isArray(msg.text)) {
      text = msg.text
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') return part.text ?? '';
          return '';
        })
        .join('');
    }

    text = text.trim();

    // Keep posts with meaningful length
    if (text.length >= 300 && text.length <= 2500) {
      results.push(text);
    }
  }

  return results;
}

/**
 * Load all result.json files from EXPORTS_DIR and cache samples.
 * Returns [] gracefully when the folder is empty or missing.
 */
function loadAllSamples() {
  if (_cachedSamples !== null) return _cachedSamples;

  const dir = config.EXPORTS_DIR;
  if (!existsSync(dir)) {
    _cachedSamples = [];
    return _cachedSamples;
  }

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    _cachedSamples = [];
    return _cachedSamples;
  }

  const samples = [];
  for (const file of files) {
    const posts = parseExportFile(join(dir, file));
    samples.push(...posts);
  }

  console.log(`[styleExamples] Loaded ${samples.length} style samples from ${files.length} file(s).`);
  _cachedSamples = samples;
  return _cachedSamples;
}

/**
 * Returns n randomly-chosen style samples from the loaded exports.
 * Each call shuffles independently so the selection varies.
 *
 * @param {number} n – number of samples to return
 * @returns {string[]}
 */
export function pickStyleSamples(n = 3) {
  const all = loadAllSamples();
  if (all.length === 0) return [];

  // Fisher–Yates shuffle on a copy of indices
  const indices = Array.from({ length: all.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, n).map((idx) => all[idx]);
}
