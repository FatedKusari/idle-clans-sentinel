/**
 * electron/services/players.js
 *
 * All player-related operations:
 *   - API fetch + upsert (upsertPlayerFromApi, lookupPlayerLive, previewPlayerLive)
 *   - Query functions (listPlayers, getPlayer, listPlayersWithEquipment, getPlayersWithItem)
 *   - Modifiers (setPlayerBanned, banClanMembers, flagClanMembers)
 *   - Not-found / dormant / flagged management
 *
 * Dependencies: db/core, shared/helpers, api/client (injected), api/logs (injected)
 */

import { exec, all, one, lower, nowIso } from "../db/core.js";
import {
  upsertPlayerBasic,
  insertPresenceSample,
  maybeAlertPlayerInactivity,
} from "../shared/helpers.js";

let _saveDb          = null;
let _apiGetJson      = null;
let _apiGetJsonAllow404 = null;
let _getSettings     = null;
let _insertLogs      = null;
const API_BASE       = "https://query.idleclans.com/api";

export function initPlayers({ saveDb, apiGetJson, apiGetJsonAllow404, getSettings, insertLogs }){
  _saveDb             = saveDb;
  _apiGetJson         = apiGetJson;
  _apiGetJsonAllow404 = apiGetJsonAllow404;
  _getSettings        = getSettings;
  _insertLogs         = insertLogs;
}

// ── API layer ─────────────────────────────────────────────────────────────────

export async function upsertPlayerFromApi(username, { signal } = {}){
  const url = `${API_BASE}/Player/profile/${encodeURIComponent(username)}`;
  let data;
  try{
    data = await _apiGetJson(url, { signal });
  }catch(err){
    const msg = String(err?.message || err);
    if (msg.includes("404")){
      const ln = lower(username);
      exec("UPDATE players SET notFoundAt=? WHERE lowerName=?", [nowIso(), ln]);
      _saveDb();
      return { ok:false, notFound:true, username };
    }
    throw err;
  }

  const ln = lower(data.username || username);
  exec("UPDATE players SET notFoundAt=NULL WHERE lowerName=? AND notFoundAt IS NOT NULL", [ln]);

  const updatedAt = nowIso();
  upsertPlayerBasic(data.username || username, data.guildName || null, data, updatedAt);
  insertPresenceSample({
    playerName:   data.username || username,
    scannedAt:    updatedAt,
    hoursOffline: data.hoursOffline,
    source:       "playerProfile",
  });
  maybeAlertPlayerInactivity({
    playerName:   data.username || username,
    scannedAt:    updatedAt,
    hoursOffline: data.hoursOffline,
  });

  const dormantThreshold = Math.max(1, Number(_getSettings().dormantThresholdDays ?? 14));
  const offlineHours = typeof data.hoursOffline === "number" && Number.isFinite(data.hoursOffline)
    ? data.hoursOffline : null;
  if (offlineHours !== null && offlineHours >= dormantThreshold * 24){
    exec("UPDATE players SET dormantAt=? WHERE lowerName=? AND (dormantAt IS NULL OR TRIM(dormantAt)='')",
      [updatedAt, ln]);
  } else if (offlineHours !== null && offlineHours < dormantThreshold * 24){
    exec("UPDATE players SET dormantAt=NULL WHERE lowerName=? AND dormantAt IS NOT NULL", [ln]);
  }

  _saveDb();
  return { ok:true };
}

export async function lookupPlayerLive(username, { signal } = {}){
  const name = String(username || "").trim();
  if (!name) throw new Error("Player name is required.");
  await upsertPlayerFromApi(name, { signal });
  await _insertLogs("player", name, { signal });
  _saveDb();
  return getPlayer(name) || { ok:true, username: name };
}

export async function previewPlayerLive(username, { signal } = {}){
  const name = String(username || "").trim();
  if (!name) throw new Error("Player name is required.");
  const url = `${API_BASE}/Player/profile/${encodeURIComponent(name)}`;
  const data = await _apiGetJsonAllow404(url, { signal });
  if (data === null) return null;
  return data;
}

// ── Query functions ───────────────────────────────────────────────────────────

export function listPlayers(q="", { limit=100, offset=0, sortCol="username", sortDir="asc", gameMode=null, onlyBanned=false, onlyFlagged=false, onlyStale=false, staleDays=7 } = {}){
  const n    = Math.max(1, Math.min(10000, Number(limit || 100)));
  const off  = Math.max(0, Math.min(100000000, Number(offset) || 0));
  const sd   = Math.max(1, Math.min(1000000, Number(staleDays) || 7));
  const like = `%${lower(q)}%`;

  const validCols = { username:"lowerName", gameMode:"gameMode", clan:"guildName", updated:"updatedAt", banned:"bannedAt" };
  const orderCol  = validCols[sortCol] || "lowerName";
  const orderDir  = String(sortDir).toLowerCase() === "desc" ? "DESC" : "ASC";

  // Always include the LIKE filter — when q="" it becomes '%%' which matches all
  const where  = ["lowerName LIKE ?"];
  const params = [like];

  if (gameMode && gameMode !== "all") { where.push("gameMode=?"); params.push(String(gameMode)); }
  if (onlyBanned){ where.push("bannedAt IS NOT NULL AND TRIM(bannedAt) <> ''"); }
  if (onlyStale){
    const cutoff = new Date(Date.now() - (Number(staleDays)||7)*86400000).toISOString();
    where.push("(updatedAt IS NULL OR updatedAt < ?)");
    params.push(cutoff);
  }

  const joinFlagged = onlyFlagged
    ? " INNER JOIN tracked t ON t.entityType='player' AND t.entityLower=lowerName AND t.enabled=1"
    : "";

  const total = one(
    `SELECT COUNT(*) AS n FROM players${joinFlagged} WHERE ${where.join(" AND ")}`,
    params
  )?.n || 0;
  const rows = all(
    `SELECT username, lowerName, gameMode, guildName, updatedAt, bannedAt
     FROM players${joinFlagged}
     WHERE ${where.join(" AND ")}
     ORDER BY ${orderCol} ${orderDir}
     LIMIT ? OFFSET ?`,
    [...params, n, off]
  );
  return { rows, total, limit: n, offset: off };
}

export function listPlayersWithEquipment({ activeOnly=false } = {}){
  const where  = ["profileJson IS NOT NULL AND profileJson != ''",
                  "(notFoundAt IS NULL OR TRIM(notFoundAt) = '')"];
  if (activeOnly) where.push("(dormantAt IS NULL OR TRIM(dormantAt) = '')");
  const rows = all(`SELECT profileJson FROM players WHERE ${where.join(" AND ")}`);
  const result = [];
  for (const r of (rows || [])){
    try{
      const profile = JSON.parse(r.profileJson);
      const eq = profile?.equipment;
      if (!eq || typeof eq !== "object") continue;
      const norm = {};
      for (const [slot, val] of Object.entries(eq)){
        if (val === null || val === undefined) continue;
        if (typeof val === "number" && val > 0){ norm[slot] = val; continue; }
        if (typeof val === "object"){
          const id = Number(val?.itemId ?? val?.ItemId ?? val?.id ?? 0);
          if (id > 0) norm[slot] = id;
          continue;
        }
        const id = Number(val);
        if (id > 0) norm[slot] = id;
      }
      if (Object.keys(norm).length > 0) result.push({ equipmentJson: JSON.stringify(norm) });
    }catch(e){ console.warn("[players] listPlayersWithEquipment: failed to parse row", e?.message); }
  }
  return result;
}

export function getPlayersWithItem(itemId, { activeOnly=false } = {}){
  const idNum = Number(itemId);
  if (!Number.isFinite(idNum) || idNum <= 0) return [];
  const where  = ["profileJson IS NOT NULL AND profileJson != ''",
                  "(notFoundAt IS NULL OR TRIM(notFoundAt) = '')"];
  if (activeOnly) where.push("(dormantAt IS NULL OR TRIM(dormantAt) = '')");
  const rows = all(`SELECT username, profileJson FROM players WHERE ${where.join(" AND ")}`);
  const result = [];
  const seen = new Set();
  for (const r of (rows || [])){
    try{
      const eq = JSON.parse(r.profileJson)?.equipment;
      if (!eq || typeof eq !== "object") continue;
      for (const val of Object.values(eq)){
        let id;
        if (typeof val === "number")      id = val;
        else if (typeof val === "object") id = Number(val?.itemId ?? val?.ItemId ?? val?.id ?? 0);
        else                              id = Number(val);
        if (id === idNum && !seen.has(r.username)){
          seen.add(r.username);
          result.push({ username: r.username });
          break;
        }
      }
    }catch(e){ console.warn("[players] getPlayersWithItem: failed to parse row", e?.message); }
  }
  return result;
}

// ── Task activity (taskNameOnLogout) ──────────────────────────────────────────
//
// Every player profile records `taskNameOnLogout` — whatever the player was
// doing (skill/activity name) at the moment they were last seen by the API.
// Aggregating this across all stored players gives a rough "what is everyone
// currently doing" snapshot. It's inherently a snapshot of each player's last
// scan, not a live feed — players who haven't been refreshed recently show
// their task as of their last refresh.
function buildTaskActivityWhere({ gameMode=null, activeOnly=false } = {}){
  const where  = ["profileJson IS NOT NULL AND profileJson != ''",
                  "(notFoundAt IS NULL OR TRIM(notFoundAt) = '')"];
  const params = [];
  if (gameMode && gameMode !== "all"){ where.push("gameMode=?"); params.push(String(gameMode)); }
  if (activeOnly) where.push("(dormantAt IS NULL OR TRIM(dormantAt) = '')");
  return { where, params };
}

export function getTaskActivitySummary({ gameMode=null, activeOnly=false } = {}){
  const { where, params } = buildTaskActivityWhere({ gameMode, activeOnly });
  const rows = all(`SELECT profileJson FROM players WHERE ${where.join(" AND ")}`, params);

  const counts = new Map(); // taskName -> count
  let totalWithTask = 0;
  let totalPlayers = 0;

  for (const r of (rows || [])){
    totalPlayers++;
    try{
      const profile = JSON.parse(r.profileJson);
      const task = String(profile?.taskNameOnLogout || "").trim();
      if (!task) continue;
      totalWithTask++;
      counts.set(task, (counts.get(task) || 0) + 1);
    }catch(e){ console.warn("[players] getTaskActivitySummary: failed to parse row", e?.message); }
  }

  const tasks = [...counts.entries()]
    .map(([task, count]) => ({ task, count }))
    .sort((a, b) => b.count - a.count || a.task.localeCompare(b.task));

  return { tasks, totalPlayers, totalWithTask };
}

// Drill-down: which players currently report a given task on logout.
export function getPlayersByTask(task, { gameMode=null, activeOnly=false, limit=200 } = {}){
  const taskName = String(task||"").trim();
  if (!taskName) return [];
  const { where, params } = buildTaskActivityWhere({ gameMode, activeOnly });
  // hoursOffline isn't a column on `players` — it only exists inside
  // profileJson, so it's read there (no separate column to select).
  const rows = all(
    `SELECT username, guildName, updatedAt, profileJson FROM players WHERE ${where.join(" AND ")}`,
    params
  );

  const result = [];
  for (const r of (rows || [])){
    try{
      const profile = JSON.parse(r.profileJson);
      const t = String(profile?.taskNameOnLogout || "").trim();
      if (t !== taskName) continue;
      result.push({
        username: r.username,
        guildName: r.guildName || null,
        hoursOffline: typeof profile?.hoursOffline === "number" ? profile.hoursOffline : null,
        updatedAt: r.updatedAt || null,
      });
    }catch(e){ console.warn("[players] getPlayersByTask: failed to parse row", e?.message); }
  }

  // Most-recently-updated first — closer to "currently doing this"
  result.sort((a,b) => String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  return result.slice(0, Math.max(1, Math.min(1000, Number(limit)||200)));
}

export function getPlayer(name){
  const ln = lower(name);
  const r  = one(
    `SELECT p.username, p.gameMode, p.guildName, p.profileJson, p.updatedAt, p.bannedAt,
            p.leaderboardStandingsJson, p.leaderboardStandingsAt,
            f.premium AS chatPremium,
            f.gilded AS chatGilded,
            f.moderator AS chatModerator,
            f.lastSeenAt AS chatFlagsLastSeenAt,
            f.updatedAt AS chatFlagsUpdatedAt
     FROM players p
     LEFT JOIN player_chat_flags f ON f.lowerName = p.lowerName
     WHERE p.lowerName=?`,
    [ln]
  );
  if (!r) return null;
  let obj = {};
  try{ obj = JSON.parse(r.profileJson || "{}"); }catch{}
  let leaderboardStandings = {};
  try{ leaderboardStandings = JSON.parse(r.leaderboardStandingsJson || "{}") || {}; }catch{}
  return {
    ...obj,
    username:            r.username,
    gameMode:            r.gameMode,
    guildName:           r.guildName,
    updatedAt:           r.updatedAt,
    bannedAt:            r.bannedAt,
    chatPremium:         r.chatPremium ? 1 : 0,
    chatGilded:          r.chatGilded ? 1 : 0,
    chatModerator:       r.chatModerator ? 1 : 0,
    chatFlagsLastSeenAt: r.chatFlagsLastSeenAt || null,
    chatFlagsUpdatedAt:  r.chatFlagsUpdatedAt  || null,
    leaderboardStandings,
    leaderboardStandingsAt: r.leaderboardStandingsAt || null,
  };
}

export function getAllPlayerNames(q="", { gameMode=null, onlyBanned=false, onlyFlagged=false, onlyStale=false, staleDays=7 } = {}){
  const where  = [];
  const params = [];
  const sd     = Math.max(1, Math.min(1000000, Number(staleDays) || 7));
  if (q)          { where.push("lowerName LIKE ?"); params.push("%" + q.toLowerCase().trim() + "%"); }
  if (gameMode)   { where.push("gameMode=?"); params.push(gameMode); }
  if (onlyBanned) { where.push("bannedAt IS NOT NULL AND TRIM(bannedAt) <> ''"); }
  if (onlyStale)  { where.push(`updatedAt < datetime('now', '-' || ? || ' days')`); params.push(sd); }
  const joinFlagged = onlyFlagged
    ? " INNER JOIN tracked t ON t.entityType='player' AND t.entityLower=lowerName AND t.enabled=1" : "";
  return all(
    `SELECT username, lowerName FROM players${joinFlagged}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY lowerName LIMIT 50000`,
    params
  ) || [];
}

// ── Modifiers ─────────────────────────────────────────────────────────────────

export function setPlayerBanned({ name, banned }){
  const ln = lower(name);
  const ts = banned ? new Date().toISOString() : null;
  exec("UPDATE players SET bannedAt=? WHERE lowerName=?", [ts, ln]);
  _saveDb();
  return { lowerName: ln, bannedAt: ts };
}

export function banClanMembers({ clanName, banned=true }){
  const clanLower = lower(clanName);
  const clan    = one("SELECT clanName, gameMode FROM clans WHERE lowerName=?", [clanLower]);
  const members = all("SELECT memberName, memberLower FROM clan_members WHERE clanLower=? ORDER BY memberLower", [clanLower]);
  const ts = banned ? new Date().toISOString() : null;
  const gm = clan?.gameMode || null;
  const guildName = clan?.clanName || clanName;
  for (const m of members){
    exec(
      `INSERT INTO players(lowerName, username, gameMode, guildName, profileJson, updatedAt, bannedAt)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(lowerName) DO UPDATE SET username=excluded.username, bannedAt=excluded.bannedAt,
         guildName=COALESCE(players.guildName, excluded.guildName),
         gameMode=COALESCE(players.gameMode, excluded.gameMode)`,
      [m.memberLower, m.memberName, gm, guildName, null, null, ts]
    );
  }
  _saveDb();
  return { ok:true, clanName:guildName, count: members.length, bannedAt: ts };
}

export function flagClanMembers({ clanName, enabled=true }){
  const clanLower = lower(clanName);
  const clan    = one("SELECT clanName, gameMode FROM clans WHERE lowerName=?", [clanLower]);
  const members = all("SELECT memberName, memberLower FROM clan_members WHERE clanLower=? ORDER BY memberLower", [clanLower]);
  const s = _getSettings();
  const interval  = Number(s.trackIntervalMinutes ?? 10);
  const nextRunAt = new Date(Date.now() + interval * 60000).toISOString();
  const en = enabled ? 1 : 0;
  for (const m of members){
    exec(
      `INSERT INTO tracked(entityType, entityLower, entityName, enabled, intervalMinutes, nextRunAt)
       VALUES('player',?,?,?,?,?)
       ON CONFLICT(entityType, entityLower) DO UPDATE SET enabled=excluded.enabled,
         intervalMinutes=excluded.intervalMinutes, nextRunAt=excluded.nextRunAt, entityName=excluded.entityName`,
      [m.memberLower, m.memberName, en, interval, nextRunAt]
    );
  }
  _saveDb();
  return { ok:true, clanName: clan?.clanName || clanName, count: members.length, enabled: !!enabled };
}

export function listBannedPlayers({ limit=500 } = {}){
  const n = Math.max(1, Math.min(5000, Number(limit || 500)));
  return all(
    `SELECT lowerName, username, gameMode, guildName, bannedAt, updatedAt
     FROM players WHERE bannedAt IS NOT NULL AND TRIM(bannedAt) <> ''
     ORDER BY bannedAt DESC LIMIT ?`,
    [n]
  );
}

// ── Not-found ─────────────────────────────────────────────────────────────────

export function listNotFoundEntities({ limit=500 } = {}){
  const n = Math.max(1, Math.min(5000, Number(limit || 500)));
  const players = all(
    `SELECT 'player' AS entityType, lowerName, username AS entityName,
            gameMode, guildName, notFoundAt, updatedAt
     FROM players WHERE notFoundAt IS NOT NULL AND TRIM(notFoundAt) <> ''
     ORDER BY notFoundAt DESC LIMIT ?`, [n]
  );
  const clans = all(
    `SELECT 'clan' AS entityType, lowerName, clanName AS entityName,
            gameMode, tag, notFoundAt, updatedAt
     FROM clans WHERE notFoundAt IS NOT NULL AND TRIM(notFoundAt) <> ''
     ORDER BY notFoundAt DESC LIMIT ?`, [n]
  );
  return { players, clans };
}

export function clearNotFoundEntity({ entityType, name }){
  const et = String(entityType || "").toLowerCase();
  const ln = lower(name);
  if (et === "player")       exec("UPDATE players SET notFoundAt=NULL WHERE lowerName=?", [ln]);
  else if (et === "clan")    exec("UPDATE clans SET notFoundAt=NULL WHERE lowerName=?", [ln]);
  else return { ok:false, error:"Invalid entityType" };
  _saveDb();
  return { ok:true };
}

// ── Dormant ───────────────────────────────────────────────────────────────────

export function listDormantPlayers({ limit=10000 } = {}){
  const n = Math.max(1, Math.min(200000, Number(limit || 10000)));
  return all(
    `SELECT p.lowerName, p.username, p.gameMode, p.guildName,
            p.dormantAt, p.updatedAt,
            ps.lastOnlineAt, ps.scannedAt,
            CASE WHEN ps.lastOnlineAt IS NOT NULL
              THEN ROUND((julianday(ps.scannedAt) - julianday(ps.lastOnlineAt)), 1)
              ELSE NULL END AS daysOffline
     FROM players p
     LEFT JOIN (
       SELECT ps2.playerLower, ps2.scannedAt, ps2.lastOnlineAt
       FROM presence_samples ps2
       INNER JOIN (
         SELECT playerLower, MAX(scannedAt) AS maxAt
         FROM presence_samples GROUP BY playerLower
       ) latest ON ps2.playerLower=latest.playerLower AND ps2.scannedAt=latest.maxAt
     ) ps ON ps.playerLower = p.lowerName
     WHERE p.dormantAt IS NOT NULL AND TRIM(p.dormantAt) <> ''
     ORDER BY daysOffline DESC NULLS LAST, p.dormantAt DESC LIMIT ?`,
    [n]
  );
}

export function clearDormantPlayer(username){
  const ln = lower(username);
  exec("UPDATE players SET dormantAt=NULL WHERE lowerName=?", [ln]);
  _saveDb();
  return { ok:true };
}

export async function recheckDormantPlayer(username){
  const nm = String(username || "").trim();
  if (!nm) return { ok:false, error:"Username required" };
  return upsertPlayerFromApi(nm);
}

// ── Flagged / tracked ─────────────────────────────────────────────────────────

export function listFlaggedPlayers({ limit=500 } = {}){
  const n = Math.max(1, Math.min(5000, Number(limit || 500)));
  return all(
    `SELECT t.entityLower AS lowerName, t.entityName AS username,
            p.gameMode, p.guildName, p.updatedAt,
            t.intervalMinutes, t.nextRunAt
     FROM tracked t
     LEFT JOIN players p ON p.lowerName = t.entityLower
     WHERE t.entityType='player' AND t.enabled=1
     ORDER BY COALESCE(t.nextRunAt, '0000') ASC, t.entityName ASC LIMIT ?`,
    [n]
  );
}

export function getPlayersClanMap({ names=[] } = {}){
  const arr    = Array.isArray(names) ? names : [];
  const lowers = [];
  for (const n of arr){
    const s = String(n || "").trim();
    if (s) lowers.push(s.toLowerCase());
  }
  if (!lowers.length) return { ok:true, clans:{} };
  const uniq         = Array.from(new Set(lowers));
  const placeholders = uniq.map(() => "?").join(",");
  const rows = all(
    `SELECT lowerName, username, guildName FROM players WHERE lowerName IN (${placeholders})`,
    uniq
  );
  const out = {};
  for (const r of rows) out[String(r.lowerName)] = { name: r.username, clanName: r.guildName || null };
  return { ok:true, clans: out };
}
