// src/rss.js – fetches RSS feeds and returns recent IT news items
import RssParser from 'rss-parser';
import { config } from './config.js';

const parser = new RssParser({
  timeout: 10_000,
  headers: { 'User-Agent': 'IT-Content-Agent/1.0' },
});

/**
 * Returns true if the item is from the last LOOKBACK_DAYS days.
 * Falls back to true when date is unavailable (don't skip undated items).
 * @param {object} item – rss-parser item
 * @returns {boolean}
 */
function isRecent(item) {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return true;
  const date = new Date(raw);
  if (isNaN(date.getTime())) return true;
  const cutoff = Date.now() - config.LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return date.getTime() >= cutoff;
}

/**
 * Fetch a single feed and return up to 8 recent items.
 * @param {string} url
 * @returns {Promise<Array<{source:string, title:string, link:string, summary:string}>>}
 */
async function fetchFeed(url) {
  const feed = await parser.parseURL(url);
  const source = feed.title ?? url;

  return feed.items
    .filter(isRecent)
    .slice(0, 8)
    .map((item) => {
      // Build a brief summary from content or snippet
      const raw =
        item.contentSnippet ??
        item['content:encodedSnippet'] ??
        item.content ??
        item.summary ??
        '';
      const summary = raw.replace(/\s+/g, ' ').trim().slice(0, 250);

      return {
        source,
        title: (item.title ?? '').trim(),
        link: item.link ?? '',
        summary,
      };
    });
}

/**
 * Fetch all configured RSS feeds (or customFeeds) in parallel.
 * A failing feed is logged but does NOT break the rest.
 *
 * @param {string[]} [customFeeds] – optional custom feeds list
 * @returns {Promise<Array<{source:string, title:string, link:string, summary:string}>>}
 */
export async function fetchRssItems(customFeeds = null) {
  const feeds = customFeeds ?? config.RSS_FEEDS;
  if (!feeds || feeds.length === 0) return [];

  const results = await Promise.allSettled(feeds.map(fetchFeed));

  const items = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      console.warn(`[rss] Feed "${feeds[i]}" failed:`, result.reason?.message ?? result.reason);
    }
  }

  return items;
}
