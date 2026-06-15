/**
 * electron/services/chat.js
 *
 * Chat message storage, query, background scan, mention detection, keyword alerts.
 *
 * Dependencies: db/core, api/client (injected), saveDb (injected), getSettings (injected)
 *   listVerifiedAccounts (accounts), upsertPlayerFromApi (players) — injected
 *   buildMentionRegex, extractChatBody — from utils.js
 */

import { exec, all, one, lower, nowIso } from "../db/core.js";
import { buildMentionRegex, extractChatBody } from "../utils.js";
import { abortError } from "../api/client.js";

let _saveDb              = null;
let _apiGetJson          = null;
let _getSettings         = null;
let _listVerifiedAccounts = null;
let _upsertPlayerFromApi  = null;
let _log                  = null;
const API_BASE            = "https://query.idleclans.com/api";

export function initChat({ saveDb, apiGetJson, getSettings, listVerifiedAccounts, upsertPlayerFromApi, log }){
  _saveDb               = saveDb;
  _apiGetJson           = apiGetJson;
  _getSettings          = getSettings;
  _listVerifiedAccounts = listVerifiedAccounts;
  _upsertPlayerFromApi  = upsertPlayerFromApi;
  _log                  = log;
}

// ── Module-level scan state ───────────────────────────────────────────────────

let chatScanTimer    = null;
let chatScanOnStatus = null;
let chatMentionCallback = null;
export function setChatMentionCallback(fn){ chatMentionCallback = typeof fn === "function" ? fn : null; }

let chatKeywords = [];
export function setChatKeywords(keywords){
  chatKeywords = Array.isArray(keywords)
    ? keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)
    : [];
}

let ignoredChatChannels = new Set();
export function setChatIgnoredChannels(channels){
  ignoredChatChannels = new Set(
    Array.isArray(channels) ? channels.map(c => String(c).trim().toLowerCase()).filter(Boolean) : []
  );
}

let chatScanState = {
  running:    false,
  intervalMs: 120000,
  nextRunAt:  null,
  lastRunAt:  null,
  lastOkAt:   null,
  lastError:  null,
  lastErrorAt:null,
};

function pushChatScanStatus(){
  try{ chatScanOnStatus?.({ ...chatScanState }); }catch{}
}

export function getChatScanStatus(){
  return { ...chatScanState };
}

// ── getRecentChat ─────────────────────────────────────────────────────────────

export async function getRecentChat({ scanSenders=true, maxSenderUpdates=10, signal } = {}){
  const url  = `${API_BASE}/Chat/recent`;
  const data = await _apiGetJson(url, { signal });

  let inserted = 0;
  const recvAt      = nowIso();
  const flagsBySender = new Map();
  const newMessages   = [];

  // Normalise category names from the API to match expected display names
  const CATEGORY_NAME_MAP = {
    "ClanHub": "Clan Recruiting",
  };

  for (const [rawCategory, arr] of Object.entries(data || {})){
    const category = CATEGORY_NAME_MAP[rawCategory] ?? rawCategory;
    if (!Array.isArray(arr)) continue;
    for (const m of arr){
      const sender  = String(m?.Sender  || "").trim();
      const msgText = String(m?.Message || "");
      const ts      = String(m?.Timestamp || "");
      if (!category || !sender || !msgText || !ts) continue;
      const parsed = Date.parse(ts);
      if (!Number.isFinite(parsed)) continue;
      const senderLower = lower(sender);
      const prem = m?.Premium    === true ? 1 : 0;
      const gild = m?.Gilded     === true ? 1 : 0;
      const mod  = m?.IsModerator === true ? 1 : 0;
      let gm = null;
      if (m && Object.prototype.hasOwnProperty.call(m, "GameMode")){
        const n = Number(m.GameMode);
        gm = Number.isFinite(n) ? n : null;
      }
      try{
        exec(
          `INSERT OR IGNORE INTO chat_messages(category,timestamp,senderLower,sender,message,premium,gilded,gameMode,isModerator,receivedAt,rawJson)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [String(category), ts, senderLower, sender, msgText, prem, gild, gm, mod, recvAt, JSON.stringify(m ?? null)]
        );
        const changed = Number(one("SELECT changes() AS c")?.c || 0);
        inserted += changed;
        if (changed > 0){
          const msgId = one("SELECT last_insert_rowid() AS id")?.id ?? null;
          newMessages.push({ id:msgId, category, sender, senderLower, message:msgText, timestamp:ts });
        }
      }catch{}

      const prev = flagsBySender.get(senderLower) || { premium:0, gilded:0, moderator:0, lastSeenAt:null };
      flagsBySender.set(senderLower, {
        premium:   prev.premium   || prem ? 1 : 0,
        gilded:    prev.gilded    || gild ? 1 : 0,
        moderator: prev.moderator || mod  ? 1 : 0,
        lastSeenAt: (!prev.lastSeenAt || ts > prev.lastSeenAt) ? ts : prev.lastSeenAt,
      });
    }
  }
  if (inserted > 0) _saveDb();

  // ── Mention detection ───────────────────────────────────────────────────────
  const linkedLowerNames = new Set();
  if (newMessages.length > 0 && typeof chatMentionCallback === "function"){
    try{
      const linked = _listVerifiedAccounts();
      linked.forEach(a => { if (a.username) linkedLowerNames.add(a.username.toLowerCase()); });
      if (linked.length > 0){
        const linkedWithLower = linked.map(a => ({ ...a, lowerName:(a.username||"").toLowerCase() }));
        for (const { id:msgRowId, category, sender, senderLower, message:msgText, timestamp:ts } of newMessages){
          if (ignoredChatChannels.has(category.toLowerCase())) continue;
          const body = extractChatBody(msgText);
          for (const acct of linkedWithLower){
            if (!acct.lowerName) continue;
            if (senderLower === acct.lowerName) continue;
            const re = buildMentionRegex(acct.lowerName);
            if (re.test(body)){
              try{
                chatMentionCallback({ accountName:acct.username, senderName:sender, category, message:msgText, timestamp:ts, messageId:msgRowId??null });
              }catch{}
            }
          }
        }
      }
    }catch{}
  }

  // ── Keyword alerts ──────────────────────────────────────────────────────────
  if (newMessages.length > 0 && chatKeywords.length > 0 && typeof chatMentionCallback === "function"){
    try{
      for (const { id:kwMsgId, category, sender, senderLower, message:msgText, timestamp:ts } of newMessages){
        if (ignoredChatChannels.has(category.toLowerCase())) continue;
        if (senderLower && linkedLowerNames.has(senderLower)) continue;
        const body = extractChatBody(msgText);
        for (const kw of chatKeywords){
          const re = buildMentionRegex(kw);
          if (re.test(body)){
            try{ chatMentionCallback({ keyword:kw, senderName:sender, category, message:msgText, timestamp:ts, messageId:kwMsgId??null }); }catch{}
            break;
          }
        }
      }
    }catch{}
  }

  // ── Update chat flags ───────────────────────────────────────────────────────
  if (flagsBySender.size > 0){
    const updAt = nowIso();
    for (const [ln, f] of flagsBySender.entries()){
      try{
        exec(
          `INSERT INTO player_chat_flags(lowerName,premium,gilded,moderator,lastSeenAt,updatedAt)
           VALUES(?,?,?,?,?,?)
           ON CONFLICT(lowerName) DO UPDATE SET
             premium=MAX(player_chat_flags.premium,excluded.premium),
             gilded=MAX(player_chat_flags.gilded,excluded.gilded),
             moderator=MAX(player_chat_flags.moderator,excluded.moderator),
             lastSeenAt=CASE
               WHEN player_chat_flags.lastSeenAt IS NULL THEN excluded.lastSeenAt
               WHEN excluded.lastSeenAt IS NULL THEN player_chat_flags.lastSeenAt
               WHEN excluded.lastSeenAt > player_chat_flags.lastSeenAt THEN excluded.lastSeenAt
               ELSE player_chat_flags.lastSeenAt
             END,
             updatedAt=excluded.updatedAt`,
          [ln, f.premium, f.gilded, f.moderator, f.lastSeenAt, updAt]
        );
      }catch{}
    }
    _saveDb();
  }

  // ── Upsert senders ──────────────────────────────────────────────────────────
  const senders = new Map();
  for (const [, arr] of Object.entries(data || {})){
    if (!Array.isArray(arr)) continue;
    for (const msg of arr){
      const sender = String(msg?.Sender || "").trim();
      if (!sender) continue;
      const ln = lower(sender);
      if (!senders.has(ln)) senders.set(ln, sender);
    }
  }

  const senderMetaBefore = {};
  for (const [ln, name] of senders.entries()){
    const row = one("SELECT username, createdAt, updatedAt FROM players WHERE lowerName=?", [ln]);
    senderMetaBefore[ln] = row
      ? { inStorage:true,  username:row.username, createdAt:row.createdAt||null, updatedAt:row.updatedAt||null }
      : { inStorage:false, username:name, createdAt:null, updatedAt:null };
  }

  if (scanSenders){
    const candidates = [];
    for (const [ln, name] of senders.entries()){
      const meta = senderMetaBefore[ln];
      const ts   = meta?.updatedAt ? Date.parse(meta.updatedAt) : 0;
      candidates.push({ ln, name, inStorage:!!meta?.inStorage, ts });
    }
    candidates.sort((a,b) => {
      if (a.inStorage !== b.inStorage) return a.inStorage ? 1 : -1;
      return a.ts - b.ts;
    });
    const toUpdate = candidates.slice(0, Math.max(0, Number(maxSenderUpdates||0)));
    for (const c of toUpdate){
      if (signal?.aborted) throw abortError();
      try{ await _upsertPlayerFromApi(c.name, { signal }); }
      catch(e){ _log("system", "chat", `Chat sender upsert failed for ${c.name}: ${String(e?.message||e)}`); }
    }
  }

  const senderMeta = {};
  for (const [ln, name] of senders.entries()){
    const row = one("SELECT username, createdAt, updatedAt FROM players WHERE lowerName=?", [ln]);
    senderMeta[ln] = row
      ? { inStorage:true,  username:row.username, createdAt:row.createdAt||null, updatedAt:row.updatedAt||null }
      : { inStorage:false, username:name, createdAt:null, updatedAt:null };
  }

  return { data, senderMeta };
}

// ── Query functions ───────────────────────────────────────────────────────────

export function getChatMessages({ category, limit=200, beforeTimestamp=null, fromTimestamp=null, sender="", q="" } = {}){
  const cat = String(category||"").trim();
  if (!cat) throw new Error("category required");
  const n    = Math.max(1, Math.min(500, Number(limit||200)));
  const base = `SELECT m.id,m.category,m.sender,m.senderLower,m.message,m.timestamp,m.premium,m.gilded,m.gameMode,m.isModerator,m.receivedAt,p.updatedAt AS playerUpdatedAt FROM chat_messages m LEFT JOIN players p ON p.lowerName=m.senderLower`;
  const where = ["m.category=?"], params = [cat];
  const sq = String(sender||"").trim().toLowerCase();
  const tq = String(q||"").trim().toLowerCase();
  if (sq){ where.push("m.senderLower LIKE ?"); params.push(`%${sq.replace(/[%_]/g,s=>"\\"+s)}%`); }
  if (tq){
    where.push("(INSTR(m.message,': ')>0 AND LOWER(SUBSTR(m.message,INSTR(m.message,': ')+2)) LIKE ? OR INSTR(m.message,': ')=0 AND LOWER(m.message) LIKE ?)");
    const esc=`%${tq.replace(/[%_]/g,s=>"\\"+s)}%`; params.push(esc,esc);
  }
  if (beforeTimestamp){ where.push("m.timestamp < ?"); params.push(String(beforeTimestamp)); }
  if (fromTimestamp)  { where.push("m.timestamp >= ?"); params.push(String(fromTimestamp)); }
  const rows = all(`${base} WHERE ${where.join(" AND ")} ORDER BY m.timestamp DESC,m.id DESC LIMIT ?`, [...params,n]);
  return rows.map(r=>({ ...r, senderInStorage:!!r.playerUpdatedAt, Premium:!!r.premium, Gilded:!!r.gilded, GameMode:r.gameMode, IsModerator:!!r.isModerator }));
}

// Fetches a window of messages centered on a specific message id, regardless
// of how far back it is or what the timestamp/date-based pagination would
// otherwise return. Used by "Jump to message" (mention/keyword alert
// history) — the previous implementation paged by a date-derived
// beforeTimestamp cutoff and a fixed 200-message page size, so a target
// message that wasn't within the most recent 200 messages of that day simply
// never appeared, and the jump silently did nothing.
//
// Returns { messages, found } where `messages` is in the same newest-first
// order as getChatMessages (id DESC), and `found` is false if the target
// message id doesn't exist in this category (e.g. it was pruned, or belongs
// to a different category than the alert recorded).
export function getChatMessagesAroundId({ category, messageId, before=100, after=50 } = {}){
  const cat = String(category||"").trim();
  const id  = Number(messageId);
  if (!cat) throw new Error("category required");
  if (!Number.isFinite(id)) return { messages: [], found: false };

  const beforeN = Math.max(0, Math.min(250, Number(before)||100));
  const afterN  = Math.max(0, Math.min(250, Number(after)||50));

  const base = `SELECT m.id,m.category,m.sender,m.senderLower,m.message,m.timestamp,m.premium,m.gilded,m.gameMode,m.isModerator,m.receivedAt,p.updatedAt AS playerUpdatedAt FROM chat_messages m LEFT JOIN players p ON p.lowerName=m.senderLower`;

  // Confirm the target message exists in this category before doing the
  // surrounding-window queries — if it's gone (pruned) or in a different
  // category, report found:false so the UI can fall back gracefully instead
  // of showing an empty/misleading window.
  const target = one(`SELECT m.id FROM chat_messages m WHERE m.category=? AND m.id=?`, [cat, id]);
  if (!target) return { messages: [], found: false };

  // Newer-or-equal messages (ascending by id, so we can take the closest
  // `afterN+1` then reverse to match overall DESC ordering).
  const newerRows = all(
    `${base} WHERE m.category=? AND m.id>=? ORDER BY m.id ASC LIMIT ?`,
    [cat, id, afterN + 1]
  );
  // Older messages (descending by id — already in the right order).
  const olderRows = all(
    `${base} WHERE m.category=? AND m.id<? ORDER BY m.id DESC LIMIT ?`,
    [cat, id, beforeN]
  );

  const combined = [...newerRows.reverse(), ...olderRows]; // overall id DESC (newest first)
  const messages = combined.map(r=>({ ...r, senderInStorage:!!r.playerUpdatedAt, Premium:!!r.premium, Gilded:!!r.gilded, GameMode:r.gameMode, IsModerator:!!r.isModerator }));
  return { messages, found: true };
}

export function getChatMessagesForPlayer({ playerName, limit=200, beforeTimestamp=null, q="" } = {}){
  const name = String(playerName||"").trim();
  if (!name) throw new Error("playerName required");
  const ln   = lower(name);
  const n    = Math.max(1, Math.min(500, Number(limit||200)));
  const where = ["m.senderLower=?"], params = [ln];
  const tq = String(q||"").trim().toLowerCase();
  if (tq){ where.push("LOWER(m.message) LIKE ?"); params.push(`%${tq.replace(/[%_]/g,s=>"\\"+s)}%`); }
  if (beforeTimestamp){ where.push("m.timestamp < ?"); params.push(String(beforeTimestamp)); }
  const rows = all(
    `SELECT m.id,m.category,m.sender,m.senderLower,m.message,m.timestamp,m.premium,m.gilded,m.gameMode,m.isModerator,m.receivedAt FROM chat_messages m WHERE ${where.join(" AND ")} ORDER BY m.timestamp DESC,m.id DESC LIMIT ?`,
    [...params,n]
  );
  return rows.map(r=>({ ...r, Premium:!!r.premium, Gilded:!!r.gilded, GameMode:r.gameMode, IsModerator:!!r.isModerator }));
}

export function searchChatMessages({ limit=200, beforeTimestamp=null, sender="", q="" } = {}){
  const n    = Math.max(1, Math.min(500, Number(limit||200)));
  const where = [], params = [];
  const sq = String(sender||"").trim().toLowerCase();
  const tq = String(q||"").trim().toLowerCase();
  if (sq){ where.push("m.senderLower LIKE ?"); params.push(`%${sq.replace(/[%_]/g,s=>"\\"+s)}%`); }
  if (tq){
    where.push("(INSTR(m.message,': ')>0 AND LOWER(SUBSTR(m.message,INSTR(m.message,': ')+2)) LIKE ? OR INSTR(m.message,': ')=0 AND LOWER(m.message) LIKE ?)");
    const esc=`%${tq.replace(/[%_]/g,s=>"\\"+s)}%`; params.push(esc,esc);
  }
  if (beforeTimestamp){ where.push("m.timestamp < ?"); params.push(String(beforeTimestamp)); }
  const base = `SELECT m.id,m.category,m.sender,m.senderLower,m.message,m.timestamp,m.premium,m.gilded,m.gameMode,m.isModerator,m.receivedAt FROM chat_messages m`;
  const sql  = where.length ? `${base} WHERE ${where.join(" AND ")} ORDER BY m.timestamp DESC,m.id DESC LIMIT ?` : `${base} ORDER BY m.timestamp DESC,m.id DESC LIMIT ?`;
  const rows = all(sql, [...params,n]);
  return rows.map(r=>({ ...r, Premium:!!r.premium, Gilded:!!r.gilded, GameMode:r.gameMode, IsModerator:!!r.isModerator }));
}

export function getChatMessagesGlobal({ limit=200, beforeTimestamp=null, sender="", q="" } = {}){
  const n    = Math.max(1, Math.min(500, Number(limit||200)));
  const base = `SELECT m.id,m.category,m.sender,m.senderLower,m.message,m.timestamp,m.premium,m.gilded,m.gameMode,m.isModerator,m.receivedAt,p.updatedAt AS playerUpdatedAt FROM chat_messages m LEFT JOIN players p ON p.lowerName=m.senderLower`;
  const where = [], params = [];
  const sq = String(sender||"").trim().toLowerCase();
  const tq = String(q||"").trim().toLowerCase();
  if (sq){ where.push("m.senderLower LIKE ?"); params.push(`%${sq.replace(/[%_]/g,s=>"\\"+s)}%`); }
  if (tq){
    where.push("(INSTR(m.message,': ')>0 AND LOWER(SUBSTR(m.message,INSTR(m.message,': ')+2)) LIKE ? OR INSTR(m.message,': ')=0 AND LOWER(m.message) LIKE ?)");
    const esc=`%${tq.replace(/[%_]/g,s=>"\\"+s)}%`; params.push(esc,esc);
  }
  if (beforeTimestamp){ where.push("m.timestamp < ?"); params.push(String(beforeTimestamp)); }
  const sql = where.length ? `${base} WHERE ${where.join(" AND ")} ORDER BY m.timestamp DESC,m.id DESC LIMIT ?` : `${base} ORDER BY m.timestamp DESC,m.id DESC LIMIT ?`;
  const rows = all(sql,[...params,n]);
  return rows.map(r=>({ ...r, senderInStorage:!!r.playerUpdatedAt, Premium:!!r.premium, Gilded:!!r.gilded, GameMode:r.gameMode, IsModerator:!!r.isModerator }));
}

export function getChatCategories(){
  return all(`SELECT DISTINCT category FROM chat_messages ORDER BY category ASC`).map(r=>r.category).filter(Boolean);
}

export function getChatMessageCounts(){
  const total  = one(`SELECT COUNT(*) AS n FROM chat_messages`)?.n || 0;
  const byCat  = all(`SELECT category,COUNT(*) AS n FROM chat_messages GROUP BY category ORDER BY category ASC`);
  const byCategory = {};
  for (const r of byCat){ byCategory[r.category] = r.n; }
  return { total, byCategory };
}

// ── Background scan ───────────────────────────────────────────────────────────

async function chatScanTick(){
  if (!chatScanState.running) return;
  chatScanState.lastRunAt  = nowIso();
  chatScanState.lastError  = null;
  chatScanState.nextRunAt  = null; // clear while scanning so UI shows "Scanning..."
  pushChatScanStatus();
  try{
    await getRecentChat({ scanSenders:true, maxSenderUpdates:2 });
    chatScanState.lastOkAt = nowIso();
  }catch(e){
    const msg = String(e?.message||e);
    chatScanState.lastError    = msg;
    chatScanState.lastErrorAt  = nowIso();
    chatScanState.intervalMs   = (msg.includes("429")||msg.includes("Too Many Requests")) ? 180000 : 120000;
  }finally{
    if (chatScanState.running){
      const s            = _getSettings();
      const configuredMs = Math.max(60000, Math.min(3600000, Number(s.chatScanIntervalMinutes??2)*60000));
      const intervalMs   = chatScanState.lastError ? chatScanState.intervalMs : configuredMs;
      chatScanState.intervalMs = intervalMs;
      chatScanState.nextRunAt  = new Date(Date.now()+intervalMs).toISOString();
      pushChatScanStatus();
      try{ if (chatScanTimer) clearTimeout(chatScanTimer); }catch{}
      chatScanTimer = setTimeout(chatScanTick, intervalMs);
    }
  }
}

export function startChatScan(onStatus){
  chatScanOnStatus = typeof onStatus === "function" ? onStatus : null;
  if (chatScanState.running){ pushChatScanStatus(); return { ok:true, ...getChatScanStatus() }; }
  const s            = _getSettings();
  const configuredMs = Math.max(60000, Math.min(3600000, Number(s.chatScanIntervalMinutes??2)*60000));
  chatScanState.running    = true;
  chatScanState.intervalMs = configuredMs;
  chatScanState.lastError  = null;
  chatScanState.nextRunAt  = new Date(Date.now()+configuredMs).toISOString();
  pushChatScanStatus();
  try{ if (chatScanTimer) clearTimeout(chatScanTimer); }catch{}
  chatScanTimer = setTimeout(chatScanTick, 50);
  return { ok:true, ...getChatScanStatus() };
}

export function stopChatScan(onStatus){
  chatScanOnStatus = typeof onStatus === "function" ? onStatus : chatScanOnStatus;
  chatScanState.running   = false;
  chatScanState.nextRunAt = null;
  try{ if (chatScanTimer) clearTimeout(chatScanTimer); }catch{}
  chatScanTimer = null;
  pushChatScanStatus();
  return { ok:true, ...getChatScanStatus() };
}
