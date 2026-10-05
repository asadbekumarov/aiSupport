// src/db.js – SQLite persistence layer using Node.js built-in node:sqlite (Node 22.5+)
// No native compilation required – zero extra dependencies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// Ensure the data directory exists before opening the file
mkdirSync(dirname(config.DB_PATH), { recursive: true });

const db = new DatabaseSync(config.DB_PATH);

// WAL mode for concurrency-friendly writes
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    topic       TEXT    NOT NULL,
    text        TEXT    NOT NULL,
    image_path  TEXT,
    context     TEXT    NOT NULL DEFAULT '{}',
    rewrites    INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'pending',
    message_id  INTEGER,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    topic              TEXT NOT NULL,
    text               TEXT NOT NULL,
    image_path         TEXT,
    channel_message_id INTEGER,
    published_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Safe column migrations for existing databases
try {
  db.exec('ALTER TABLE drafts ADD COLUMN image_path TEXT;');
} catch (_) {}
try {
  db.exec('ALTER TABLE posts ADD COLUMN image_path TEXT;');
} catch (_) {}

// ─── Prepared statements ───────────────────────────────────────────────────
// node:sqlite uses the same prepare() API as better-sqlite3 but returns
// StatementSync objects with .run() / .get() / .all() methods.

const stmts = {
  createDraft: db.prepare(`
    INSERT INTO drafts (topic, text, image_path, context, rewrites, status)
    VALUES (?, ?, ?, ?, 0, 'pending')
  `),

  getDraft: db.prepare(`SELECT * FROM drafts WHERE id = ?`),

  getDraftByMessageId: db.prepare(`
    SELECT * FROM drafts WHERE message_id = ? AND status = 'pending'
  `),

  updateDraftText: db.prepare(`
    UPDATE drafts SET text = ?, topic = ?, image_path = COALESCE(?, image_path), rewrites = rewrites + 1
    WHERE id = ?
  `),

  updateDraftImage: db.prepare(`
    UPDATE drafts SET image_path = ? WHERE id = ?
  `),

  setDraftMessageId: db.prepare(`
    UPDATE drafts SET message_id = ? WHERE id = ?
  `),

  markDraftPublished: db.prepare(`
    UPDATE drafts SET status = 'published' WHERE id = ?
  `),

  addPost: db.prepare(`
    INSERT INTO posts (topic, text, image_path, channel_message_id)
    VALUES (?, ?, ?, ?)
  `),

  recentTopics: db.prepare(`
    SELECT topic FROM posts ORDER BY published_at DESC LIMIT ?
  `),

  stats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM posts)                           AS published_count,
      (SELECT COUNT(*) FROM drafts WHERE status = 'pending') AS pending_drafts
  `),

  pendingDrafts: db.prepare(`
    SELECT * FROM drafts WHERE status = 'pending' ORDER BY created_at DESC
  `),

  getKv: db.prepare(`SELECT value FROM kv WHERE key = ?`),

  setKv: db.prepare(`
    INSERT INTO kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
};

// ─── Helper: parse context JSON from a row ────────────────────────────────
function parseRow(row) {
  if (!row) return null;
  return { ...row, context: JSON.parse(row.context) };
}

// ─── Public helpers ────────────────────────────────────────────────────────

/** Create a new draft, return its id. */
export function createDraft({ topic, text, image_path = null, context }) {
  const result = stmts.createDraft.run(topic, text, image_path, JSON.stringify(context));
  return Number(result.lastInsertRowid);
}

/** Fetch a draft by primary key. Parses context JSON. */
export function getDraft(id) {
  return parseRow(stmts.getDraft.get(id));
}

/** Find the pending draft whose owner-message id matches. */
export function getDraftByMessageId(messageId) {
  return parseRow(stmts.getDraftByMessageId.get(messageId));
}

/** Update draft text/topic and increment the rewrite counter. */
export function updateDraftText({ id, topic, text, image_path = null }) {
  stmts.updateDraftText.run(text, topic, image_path, id);
}

/** Update draft image path. */
export function updateDraftImage({ id, image_path }) {
  stmts.updateDraftImage.run(image_path, id);
}

/** Store the message_id of the bot message sent to the owner. */
export function setDraftMessageId({ id, message_id }) {
  stmts.setDraftMessageId.run(message_id, id);
}

/** Mark a draft as published. */
export function markDraftPublished(id) {
  stmts.markDraftPublished.run(id);
}

/** Record a published channel post. */
export function addPost({ topic, text, image_path = null, channel_message_id }) {
  stmts.addPost.run(topic, text, image_path, channel_message_id ?? null);
}

/** Return the last n published topics for deduplication. */
export function getRecentTopics(n = 15) {
  return stmts.recentTopics.all(n).map((r) => r.topic);
}

/** Return aggregate stats: published_count, pending_drafts. */
export function getStats() {
  return stmts.stats.get();
}

/** Return all pending drafts. */
export function getPendingDrafts() {
  return stmts.pendingDrafts.all().map(parseRow);
}

/** Get a value from the kv table by key. Returns null if not found. */
export function getKv(key) {
  const row = stmts.getKv.get(key);
  return row ? row.value : null;
}

/** Store or update a key-value pair in the kv table. */
export function setKv(key, value) {
  stmts.setKv.run(key, String(value));
}

export default db;
