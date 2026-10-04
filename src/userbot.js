import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Logger } from 'telegram/extensions/Logger.js';
import { config } from './config.js';
import { redact } from './privacy.js';

/** Singleton client – created once, reused across calls */
let _client = null;

/**
 * Create (or return cached) GramJS client.
 * Does NOT prompt for login – TG_SESSION must already be set.
 */
export async function getClient() {
  if (_client) return _client;

  const session = new StringSession(config.TG_SESSION);
  const client = new TelegramClient(session, config.TG_API_ID, config.TG_API_HASH, {
    connectionRetries: 5,
    baseLogger: new Logger('error'),
  });

  await client.connect();
  _client = client;
  return _client;
}

/**
 * Disconnect the client – called on graceful shutdown.
 */
export async function disconnectClient() {
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
}

/**
 * Fetch recent messages from whitelisted SOURCE_CHATS only.
 *
 * Rules:
 *  – Only reads chats explicitly listed in config.SOURCE_CHATS (privacy guarantee)
 *  – Only messages from the last LOOKBACK_DAYS
 *  – Skip messages shorter than 40 chars
 *  – Truncate each message to 700 chars
 *  – At most 40 messages per chat
 *  – Total output capped at ~20 000 chars
 *  – A failing chat is logged and skipped; others continue
 *
 * @returns {Promise<Array<{chat: string, messages: string[]}>>}
 */
export async function fetchRecentMessages() {
  if (config.SOURCE_CHATS.length === 0) {
    console.log('[userbot] SOURCE_CHATS is empty – skipping chat reading.');
    return [];
  }

  const client = await getClient();
  const cutoff = Date.now() - config.LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  let totalChars = 0;
  const MAX_TOTAL_CHARS = 20_000;

  const results = [];

  for (const username of config.SOURCE_CHATS) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    try {
      const messages = [];
      // getMessages with limit gives the most-recent messages first
      const fetched = await client.getMessages(username, { limit: 100 });

      for (const msg of fetched) {
        // Stop if the message is older than the cutoff
        const msgTs = (msg.date ?? 0) * 1000; // GramJS uses unix seconds
        if (msgTs < cutoff) break;

        const rawText = msg.message ?? '';
        if (rawText.length < 40) continue;  // skip short/media-only messages

        const truncated = rawText.slice(0, 700);
        messages.push(truncated);
        totalChars += truncated.length;

        if (messages.length >= 40 || totalChars >= MAX_TOTAL_CHARS) break;
      }

      if (messages.length > 0) {
        results.push({ chat: username, messages });
        console.log(`[userbot] @${username}: collected ${messages.length} message(s).`);
      } else {
        console.log(`[userbot] @${username}: no qualifying messages found.`);
      }
    } catch (err) {
      // A failing chat must not stop the others
      console.error(`[userbot] Failed to read @${username}:`, err.message ?? err);
    }
  }

  return results;
}

/**
 * Collect digest material across channels, groups, and private chats.
 * Strictly anonymous & redacted for AI; stores raw mapping in memory lookup only.
 *
 * @param {number} sinceUnix – cutoff timestamp in seconds
 * @returns {Promise<{
 *   material: Array<{ ref: string, type: 'channel'|'group'|'private', messages: Array<{ ref: string, out: boolean, text: string }> }>,
 *   lookup: {
 *     chats: Map<string, { ref: string, title: string, username: string|null, peerId: any, link: string, type: string, date: number }>,
 *     messages: Map<string, { ref: string, chatRef: string, originalText: string, messageId: number, link: string, out: boolean, date: number }>
 *   }
 * }>}
 */
export async function collectDigestMaterial(sinceUnix) {
  const client = await getClient();

  let me = null;
  try {
    me = await client.getMe();
  } catch (err) {
    console.warn('[userbot] Could not get own profile:', err.message ?? err);
  }

  console.log(`[userbot] Fetching dialogs since unix ${sinceUnix} (${new Date(sinceUnix * 1000).toISOString()})…`);
  const allDialogs = await client.getDialogs({ limit: 250 });

  const excludeList = config.EXCLUDE_CHATS;

  // Filter qualifying dialogs
  const qualifying = [];
  for (const d of allDialogs) {
    const dialogDate = d.date ?? 0;
    if (dialogDate < sinceUnix) continue;

    // Classification
    let type = null;
    if (d.isChannel && !d.isGroup) {
      type = 'channel';
    } else if (d.isGroup) {
      type = 'group';
    } else if (d.isUser) {
      type = 'private';
    } else {
      continue;
    }

    // Skip private chats if disabled
    if (type === 'private' && !config.DIGEST_INCLUDE_PRIVATE) {
      continue;
    }

    // Skip bots and deleted accounts
    if (d.entity?.bot || d.entity?.deleted) {
      continue;
    }

    // Skip Saved Messages / Self
    if (d.entity?.self) {
      continue;
    }
    if (me && d.id != null && String(d.id) === String(me.id)) {
      continue;
    }

    // Check EXCLUDE_CHATS matches
    const username = (d.entity?.username || '').toLowerCase();
    const title = (d.name || d.title || '').toLowerCase();
    const rawId = d.id != null ? String(d.id).toLowerCase() : '';
    const cleanId = rawId.replace(/^-100/, '').replace(/^-/, '');

    const isExcluded = excludeList.some((ex) => {
      const target = ex.replace(/^@/, '');
      return (
        target === username ||
        target === title ||
        target === rawId ||
        target === cleanId
      );
    });

    if (isExcluded) {
      continue;
    }

    qualifying.push({ dialog: d, type, date: dialogDate });
  }

  // Guarantee that ALL active private chats (up to 40) are included so they are never crowded
  // out by high-frequency broadcast channels. Then groups (up to 25), then channels fill remainder.
  const privateChats = qualifying.filter((q) => q.type === 'private').sort((a, b) => b.date - a.date);
  const groupChats = qualifying.filter((q) => q.type === 'group').sort((a, b) => b.date - a.date);
  const channelChats = qualifying.filter((q) => q.type === 'channel').sort((a, b) => b.date - a.date);

  const selectedPrivate = privateChats.slice(0, 40);
  const selectedGroups = groupChats.slice(0, 25);
  const remainingSlots = Math.max(0, config.MAX_DIALOGS - selectedPrivate.length - selectedGroups.length);
  const selectedChannels = channelChats.slice(0, remainingSlots);

  const selected = [...selectedPrivate, ...selectedGroups, ...selectedChannels];

  console.log(
    `[userbot] Selected ${selected.length} dialog(s) for digest: ` +
      `${selectedPrivate.length} private, ${selectedGroups.length} groups, ${selectedChannels.length} channels.`
  );

  const chatLookup = new Map();
  const messageLookup = new Map();
  const material = [];

  let kCounter = 0;
  let gCounter = 0;
  let sCounter = 0;

  for (const item of selected) {
    const { dialog, type } = item;

    // Label generation
    let label = '';
    if (type === 'channel') {
      kCounter++;
      label = `K${kCounter}`;
    } else if (type === 'group') {
      gCounter++;
      label = `G${gCounter}`;
    } else {
      sCounter++;
      label = `S${sCounter}`;
    }

    const title = dialog.name || dialog.title || 'Noma\'lum';
    const username = dialog.entity?.username || null;
    const rawIdStr = dialog.id != null ? String(dialog.id) : '';
    const cleanId = rawIdStr.replace(/^-100/, '').replace(/^-/, '');

    let chatLink = '';
    if (username) {
      chatLink = `https://t.me/${username}`;
    } else if (type === 'channel' || type === 'group') {
      chatLink = `https://t.me/c/${cleanId}`;
    } else {
      chatLink = `tg://user?id=${cleanId}`;
    }

    chatLookup.set(label, {
      ref: label,
      title,
      username,
      peerId: dialog.id,
      link: chatLink,
      type,
      date: dialog.date,
    });

    const maxMessages = type === 'channel' ? 20 : type === 'group' ? 30 : 40;
    const isPrivate = type === 'private';

    try {
      const chatMessages = [];
      let msgIndex = 0;

      for await (const msg of client.iterMessages(dialog.entity, { limit: maxMessages * 2 })) {
        const msgDate = msg.date ?? 0;
        if (msgDate < sinceUnix) {
          break;
        }

        const rawText = msg.message ?? '';
        if (!rawText || !rawText.trim()) continue;

        // In private chats, keep all real conversational messages (even short ones like 'ha', 'keldim', 'qachon')
        // In channels and groups, skip short spam
        if (isPrivate) {
          if (rawText.trim().length < 2) continue;
        } else {
          if (rawText.length < 15) continue;
        }

        msgIndex++;
        const msgRef = `${label}:${msgIndex}`;
        const truncatedRaw = rawText.slice(0, 600);
        const redactedText = redact(truncatedRaw);

        let msgLink = '';
        if (username) {
          msgLink = `https://t.me/${username}/${msg.id}`;
        } else if (type === 'channel' || type === 'group') {
          msgLink = `https://t.me/c/${cleanId}/${msg.id}`;
        } else {
          msgLink = `tg://user?id=${cleanId}`;
        }

        messageLookup.set(msgRef, {
          ref: msgRef,
          chatRef: label,
          originalText: truncatedRaw,
          messageId: msg.id,
          link: msgLink,
          out: Boolean(msg.out),
          date: msg.date,
        });

        chatMessages.push({
          ref: msgRef,
          out: Boolean(msg.out),
          text: redactedText,
        });

        if (chatMessages.length >= maxMessages) {
          break;
        }
      }

      if (chatMessages.length > 0) {
        material.push({
          ref: label,
          type,
          messages: chatMessages,
        });
      }

      console.log(`[userbot] Digest dialog ${label} (${type}): collected ${chatMessages.length} message(s).`);
    } catch (err) {
      let waitSeconds = err.seconds;
      if (!waitSeconds && err.message) {
        const m =
          err.message.match(/FLOOD_WAIT_(\d+)/i) ||
          err.message.match(/wait of (\d+) seconds/i);
        if (m) waitSeconds = Number(m[1]);
      }

      if (waitSeconds && waitSeconds <= 30) {
        console.warn(`[userbot] FLOOD_WAIT ${waitSeconds}s on ${label}. Waiting…`);
        await new Promise((r) => setTimeout(r, (waitSeconds + 1) * 1000));
      } else {
        console.warn(`[userbot] Error reading ${label}: ${err.message ?? err}`);
      }
    }

    // Gentle delay between dialogs to prevent flooding
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    material,
    lookup: {
      chats: chatLookup,
      messages: messageLookup,
    },
  };
}
