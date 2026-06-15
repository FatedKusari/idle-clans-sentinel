/**
 * electron/shared/helpers.js
 *
 * Private helper functions shared across multiple domain service modules.
 * These were previously private (non-exported) functions in services.js.
 *
 * Dependencies: db/core (exec, all, one, lower, nowIso)
 * getSettings is injected via initHelpers() to avoid circular imports.
 */

import { exec, all, one, lower, nowIso } from "../db/core.js";

// ── Injected dependencies ─────────────────────────────────────────────────────

let _getSettings = null;

export function initHelpers({ getSettings }){
  _getSettings = getSettings;
}

// ── Equipment normalisation ───────────────────────────────────────────────────

export function normaliseEquipment(profileObj){
  if (!profileObj?.equipment || typeof profileObj.equipment !== "object") return profileObj;
  const norm = {};
  for (const [slot, val] of Object.entries(profileObj.equipment)){
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
  return { ...profileObj, equipment: norm };
}

// ── Log entry writer ──────────────────────────────────────────────────────────

export function log(entityType, entityName, message, timestamp, rawJson){
  exec(
    "INSERT OR IGNORE INTO logs(entityType, entityLower, message, timestamp, rawJson) VALUES(?,?,?,?,?)",
    [entityType, lower(entityName), message, timestamp, rawJson ? JSON.stringify(rawJson) : null]
  );
}

// ── Clan game-mode consistency ────────────────────────────────────────────────

export function ensureClanGameMode(clanName, mode, updatedAt){
  const ln = lower(clanName);
  const r = one("SELECT gameMode FROM clans WHERE lowerName=?", [ln]);
  const existing = r?.gameMode || null;
  const next = existing
    ? (existing === "notselected" && mode !== "notselected" ? mode : existing)
    : mode;

  if (!r){
    exec(
      `INSERT INTO clans(lowerName, clanName, gameMode, tag, dataJson, updatedAt)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(lowerName) DO UPDATE SET clanName=excluded.clanName, gameMode=excluded.gameMode, updatedAt=excluded.updatedAt`,
      [ln, clanName, next, null, "{}", updatedAt]
    );
    return;
  }

  if (existing && existing !== next && next !== "notselected"){
    log("clan", clanName, `⚠️ Game mode mismatch from player imports: ${existing} → ${next}`, updatedAt, null);
  }
  if (existing !== next){
    exec("UPDATE clans SET gameMode=?, updatedAt=? WHERE lowerName=?", [next, updatedAt, ln]);
  }
}

// ── Player / clan basic upserts ───────────────────────────────────────────────

export function upsertPlayerBasic(username, guildName, profileObj, updatedAt){
  const ln = lower(username);
  const prev = one("SELECT guildName, gameMode FROM players WHERE lowerName=?", [ln]);
  const prevClan = prev?.guildName || null;
  const mode = typeof profileObj?.gameMode === "string" ? profileObj.gameMode : null;
  const safeProfile = normaliseEquipment(profileObj || {});
  exec(
    `INSERT INTO players(lowerName, username, gameMode, guildName, profileJson, updatedAt)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(lowerName) DO UPDATE SET username=excluded.username, gameMode=excluded.gameMode, guildName=excluded.guildName, profileJson=excluded.profileJson, updatedAt=excluded.updatedAt`,
    [ln, username, mode, guildName, JSON.stringify(safeProfile), updatedAt]
  );

  if (guildName && mode){
    try{ ensureClanGameMode(guildName, mode, updatedAt); }catch{}
  }

  if (prev && prevClan !== guildName){
    exec(
      "INSERT OR IGNORE INTO player_clan_history(playerLower, fromClan, toClan, timestamp, source) VALUES(?,?,?,?,?)",
      [ln, prevClan, guildName, updatedAt, "profile"]
    );
    log("player", username, `Clan changed: ${prevClan || "None"} → ${guildName || "None"}`, updatedAt, null);
  }
}

export function upsertClanBasic(clanName, tag, dataObj, updatedAt){
  const ln = lower(clanName);
  const mode = typeof dataObj?.gameMode === "string" ? dataObj.gameMode : null;
  exec(
    `INSERT INTO clans(lowerName, clanName, gameMode, tag, dataJson, updatedAt, createdAt)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(lowerName) DO UPDATE SET
       clanName=excluded.clanName,
       gameMode=COALESCE(excluded.gameMode, clans.gameMode),
       tag=excluded.tag,
       dataJson=excluded.dataJson,
       updatedAt=excluded.updatedAt,
       createdAt=COALESCE(clans.createdAt, excluded.createdAt)`,
    [ln, clanName, mode, tag, JSON.stringify(dataObj || {}), updatedAt, updatedAt]
  );
}

export function upsertClanMembers(clanName, memberlist, updatedAt){
  const clanLower = lower(clanName);
  const incoming  = Array.isArray(memberlist) ? memberlist : [];
  const keep      = new Set();

  for (const m of incoming){
    const memberName = m.memberName || m.username || m.name;
    if (!memberName) continue;
    const memberLower = lower(memberName);
    keep.add(memberLower);
    exec(
      `INSERT INTO clan_members(clanLower, memberLower, memberName, rank, lastUpdatedAt)
       VALUES(?,?,?,?,?)
       ON CONFLICT(clanLower, memberLower) DO UPDATE SET memberName=excluded.memberName, rank=excluded.rank, lastUpdatedAt=excluded.lastUpdatedAt`,
      [clanLower, memberLower, memberName, Number(m.rank ?? 0), updatedAt]
    );
  }

  if (keep.size === 0){
    exec("DELETE FROM clan_members WHERE clanLower=?", [clanLower]);
    return;
  }

  const keepArr = Array.from(keep);
  const CHUNK   = 900;
  if (keepArr.length <= CHUNK){
    const placeholders = keepArr.map(() => "?").join(",");
    exec(
      `DELETE FROM clan_members WHERE clanLower=? AND memberLower NOT IN (${placeholders})`,
      [clanLower, ...keepArr]
    );
  } else {
    exec(
      `DELETE FROM clan_members WHERE clanLower=? AND (lastUpdatedAt IS NULL OR lastUpdatedAt<>?)`,
      [clanLower, updatedAt]
    );
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export function insertAlert({ type, entityType, entityName, severity, message }){
  const createdAt   = nowIso();
  const entityLower = lower(entityName);

  const cutoff = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const exists = one(
    `SELECT id FROM alerts
     WHERE type=? AND entityType=? AND entityLower=? AND message=? AND createdAt >= ?
     ORDER BY createdAt DESC LIMIT 1`,
    [type, entityType, entityLower, message, cutoff]
  );
  if (exists) return { ok:true, skipped:true };

  exec(
    `INSERT INTO alerts(createdAt, type, entityType, entityLower, entityName, severity, message, readAt)
     VALUES(?,?,?,?,?,?,?,NULL)`,
    [createdAt, type, entityType, entityLower, entityName, severity || null, message]
  );
  return { ok:true };
}

export function isTrackedEnabled(entityType, entityNameOrLower){
  const ln = lower(entityNameOrLower);
  const r  = one(
    "SELECT enabled AS en FROM tracked WHERE entityType=? AND entityLower=?",
    [entityType, ln]
  );
  return !!r?.en;
}

export function alertsEnabled(){
  const s = _getSettings();
  return String(s.alertsEnabled ?? "1") !== "0";
}

export function alertsOnlyTracked(){
  const s = _getSettings();
  return String(s.alertsOnlyTracked ?? "1") !== "0";
}

export function getAlertInactiveDays(){
  const s = _getSettings();
  const d = Number(s.alertInactiveDays ?? 7);
  return Math.max(1, Math.min(365, Number.isFinite(d) ? d : 7));
}

export function joinLeaveAlertsEnabled(){
  const s = _getSettings();
  return String(s.alertJoinLeaveEnabled ?? "1") !== "0";
}

// ── Presence samples ──────────────────────────────────────────────────────────

export function insertPresenceSample({ playerName, scannedAt, hoursOffline, source }){
  const ln       = lower(playerName);
  const scannedMs = Date.parse(scannedAt);
  const hrs      = (typeof hoursOffline === "number" && Number.isFinite(hoursOffline)) ? hoursOffline : null;
  let lastOnlineAt = null;
  if (hrs !== null && Number.isFinite(scannedMs)){
    const lastMs = scannedMs - (hrs * 3600 * 1000);
    if (Number.isFinite(lastMs) && lastMs > 0){
      lastOnlineAt = new Date(lastMs).toISOString();
    }
  }
  exec(
    `INSERT OR IGNORE INTO presence_samples(playerLower, scannedAt, hoursOffline, lastOnlineAt, source)
     VALUES(?,?,?,?,?)`,
    [ln, scannedAt, hrs, lastOnlineAt, source || null]
  );
}

export function maybeAlertPlayerInactivity({ playerName, scannedAt, hoursOffline }){
  if (!alertsEnabled()) return;
  if (alertsOnlyTracked() && !isTrackedEnabled("player", playerName)) return;
  const hrs = (typeof hoursOffline === "number" && Number.isFinite(hoursOffline)) ? hoursOffline : null;
  if (hrs === null) return;

  const daysOffline = hrs / 24;
  const threshold   = getAlertInactiveDays();
  if (daysOffline < threshold) return;

  const ln = lower(playerName);
  const r  = one(
    "SELECT lastOnlineAt FROM presence_samples WHERE playerLower=? AND scannedAt=? LIMIT 1",
    [ln, scannedAt]
  );

  const when = r?.lastOnlineAt ? `last online ${r.lastOnlineAt}` : "last online unknown";
  insertAlert({
    type:       "inactive",
    entityType: "player",
    entityName: playerName,
    severity:   "warn",
    message:    `${playerName} is offline ~${daysOffline.toFixed(1)} days (${when}).`,
  });
}

// ── Bulk scan markers ─────────────────────────────────────────────────────────

export function markBulkScanned(entityType, entityName, scannedAt){
  const et = String(entityType || "");
  const el = lower(entityName);
  const ts = scannedAt || nowIso();
  exec(
    `INSERT INTO bulk_scan_marks(entityType, entityLower, firstScannedAt, lastScannedAt)
     VALUES(?,?,?,?)
     ON CONFLICT(entityType, entityLower) DO UPDATE SET lastScannedAt=excluded.lastScannedAt`,
    [et, el, ts, ts]
  );
}

export function wasBulkScanned(entityType, entityName){
  const r = one(
    "SELECT 1 as x FROM bulk_scan_marks WHERE entityType=? AND entityLower=? LIMIT 1",
    [String(entityType || ""), lower(entityName)]
  );
  return !!r;
}
