// src/styleExamples.js – loads Telegram Desktop channel export files for style reference
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

/** @type {Map<string, string[]>} */
const _cache = new Map();

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
 * Collect all JSON files in a directory, optionally recursing into subdirectories.
 * @param {string} dir
 * @param {boolean} recursive
 * @returns {string[]}
 */
function findJsonFiles(dir, recursive = true) {
  if (!existsSync(dir)) return [];
  const files = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      } else if (recursive && entry.isDirectory()) {
        files.push(...findJsonFiles(fullPath, true));
      }
    }
  } catch (err) {
    console.warn(`[styleExamples] Error reading directory ${dir}:`, err.message);
  }

  return files;
}

/**
 * Load samples from a list of JSON file paths.
 * @param {string[]} filePaths
 * @returns {string[]}
 */
function loadFromFiles(filePaths) {
  const samples = [];
  for (const file of filePaths) {
    samples.push(...parseExportFile(file));
  }
  return samples;
}

/**
 * Load samples for a specific category.
 * If data/exports/<category>/ exists and has JSON exports, uses those.
 * Otherwise falls back to all exports in data/exports/ (root and subfolders).
 *
 * @param {string} [categoryId]
 * @returns {string[]}
 */
function getSamplesForCategory(categoryId) {
  const catKey = categoryId ? String(categoryId).toLowerCase() : '__default__';
  if (_cache.has(catKey)) {
    return _cache.get(catKey);
  }

  const exportsDir = config.EXPORTS_DIR;
  if (!existsSync(exportsDir)) {
    _cache.set(catKey, []);
    return [];
  }

  // 1. Try category specific subfolder
  if (categoryId) {
    const catDir = join(exportsDir, categoryId.toLowerCase());
    if (existsSync(catDir)) {
      const catFiles = findJsonFiles(catDir, true);
      if (catFiles.length > 0) {
        const catSamples = loadFromFiles(catFiles);
        if (catSamples.length > 0) {
          console.log(`[styleExamples] Loaded ${catSamples.length} samples for category "${categoryId}" from ${catFiles.length} file(s).`);
          _cache.set(catKey, catSamples);
          return catSamples;
        }
      }
    }
  }

  // 2. Fallback to all exports in data/exports/ (root and all subfolders)
  const allKey = '__all__';
  if (_cache.has(allKey)) {
    const fallback = _cache.get(allKey);
    _cache.set(catKey, fallback);
    return fallback;
  }

  const allFiles = findJsonFiles(exportsDir, true);
  const allSamples = loadFromFiles(allFiles);
  console.log(`[styleExamples] Loaded ${allSamples.length} fallback samples from ${allFiles.length} file(s).`);

  _cache.set(allKey, allSamples);
  _cache.set(catKey, allSamples);
  return allSamples;
}

/**
 * Returns n randomly-chosen style samples from the loaded exports for a category.
 * If data/exports/<category>/ exists and has JSON exports, uses those;
 * otherwise falls back to all exports in data/exports/ (root and subfolders).
 *
 * @param {number} n – number of samples to return
 * @param {string|object} [category] – category ID string or category object
 * @returns {string[]}
 */
export function pickStyleSamples(n = 3, category = 'it') {
  const categoryId = typeof category === 'string' ? category : category?.id;
  const all = getSamplesForCategory(categoryId);
  if (all.length === 0) return [];

  // Fisher–Yates shuffle on a copy of indices
  const indices = Array.from({ length: all.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, n).map((idx) => all[idx]);
}
