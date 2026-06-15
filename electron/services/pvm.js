/**
 * electron/services/pvm.js
 *
 * PvM snapshot, sample, delta and correlation functions.
 * Also includes clan PvM leaderboard profile (fetchClanPvmProfile, getClanPvmSnapshot).
 *
 * Dependencies: db/core, api/client (injected), saveDb (injected), getSettings (injected)
 */

import { exec, all, one, lower, nowIso, dbState } from "../db/core.js";

let _saveDb     = null;
let _apiGetJsonAllow404 = null;
let _getSettings = null;
const API_BASE   = "https://query.idleclans.com/api";

export function initPvm({ saveDb, apiGetJsonAllow404, getSettings }){
  _saveDb              = saveDb;
  _apiGetJsonAllow404  = apiGetJsonAllow404;
  _getSettings         = getSettings;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function dayKeyLocal(d = new Date()){
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function findRollingPair(playerLower, gameMode, cutoffIso, endIso){
  const latest = endIso
    ? one(
        `SELECT takenAt, clanName, pvmJson FROM pvm_samples
         WHERE playerLower=? AND gameMode=? AND takenAt <= ?
         ORDER BY takenAt DESC LIMIT 1`,
        [playerLower, gameMode, endIso]
      )
    : one(
        `SELECT takenAt, clanName, pvmJson FROM pvm_samples
         WHERE playerLower=? AND gameMode=?
         ORDER BY takenAt DESC LIMIT 1`,
        [playerLower, gameMode]
      );
  if (!latest) return { latest:null, base:null };

  const base = one(
    `SELECT takenAt, clanName, pvmJson FROM pvm_samples
     WHERE playerLower=? AND gameMode=? AND takenAt <= ?
     ORDER BY takenAt DESC LIMIT 1`,
    [playerLower, gameMode, cutoffIso]
  );
  return { latest, base };
}

// ── Snapshots (daily) ─────────────────────────────────────────────────────────

export function maybeSnapshotPvmForPlayer(name, opts = {}){
  const ln  = lower(name);
  const row = one(`SELECT username, gameMode, guildName, profileJson FROM players WHERE lowerName=?`, [ln]);
  if (!row?.profileJson) return { ok:false, reason:"no_profile" };

  let obj;
  try{ obj = JSON.parse(row.profileJson); }catch{ return { ok:false, reason:"bad_json" }; }
  const pvm = obj?.pvmStats;
  if (!pvm || typeof pvm !== "object") return { ok:false, reason:"no_pvm" };

  const gm = String(obj?.gameMode || row.gameMode || "").toLowerCase() || "normal";
  const dk = dayKeyLocal(new Date());

  const force = !!opts?.force;
  if (!force){
    try{
      const s = _getSettings();
      const hhmm = String(s.pvmSnapshotTime ?? "02:00");
      const mp = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm);
      if (mp){
        const hh = Math.max(0, Math.min(23, Number(mp[1])));
        const mm = Math.max(0, Math.min(59, Number(mp[2])));
        const now = new Date();
        const nowMin = now.getHours()*60 + now.getMinutes();
        const snapMin = hh*60 + mm;
        if (nowMin < snapMin) return { ok:true, skipped:true, reason:"before_snapshot_time" };
      }
    }catch(e){ console.warn("[pvm] maybeSnapshotPvmForPlayer: snapshot time check failed", e?.message); }
  }

  const exists = one(`SELECT 1 AS x FROM pvm_snapshots WHERE playerLower=? AND gameMode=? AND dayKey=?`, [ln, gm, dk]);
  if (exists?.x) return { ok:true, skipped:true };

  const takenAt    = nowIso();
  const clanName   = obj?.guildName || row.guildName || null;
  const playerName = row.username || name;

  exec(
    `INSERT INTO pvm_snapshots(playerLower, playerName, gameMode, dayKey, takenAt, clanName, pvmJson)
     VALUES(?,?,?,?,?,?,?)`,
    [ln, playerName, gm, dk, takenAt, clanName, JSON.stringify(pvm)]
  );
  _saveDb();
  return { ok:true, skipped:false, dayKey: dk };
}

export function takePvmSnapshotNow({ name } = {}){
  const nm = String(name||"").trim();
  if (!nm) return { ok:false, reason:"no_name" };
  return maybeSnapshotPvmForPlayer(nm, { force:true });
}

export function prunePvmSamples(retentionDays=14){
  if (dbState.degraded) return { ok:false, reason:"db_degraded" };
  const days    = Math.max(1, Math.min(365, Number(retentionDays||14)));
  const cutoff  = new Date(Date.now() - days*24*60*60*1000);
  exec("DELETE FROM pvm_samples WHERE takenAt < ?", [cutoff.toISOString()]);
  _saveDb();
  return { ok:true, cutoffIso: cutoff.toISOString() };
}

export function recordPvmSampleForPlayer(name){
  if (dbState.degraded) return { ok:false, reason:"db_degraded" };
  const ln  = lower(name);
  const row = one(`SELECT username, gameMode, guildName, profileJson FROM players WHERE lowerName=?`, [ln]);
  if (!row?.profileJson) return { ok:false, reason:"no_profile" };

  let obj;
  try{ obj = JSON.parse(row.profileJson); }catch{ return { ok:false, reason:"bad_json" }; }
  const pvm = obj?.pvmStats;
  if (!pvm || typeof pvm !== "object") return { ok:false, reason:"no_pvm" };

  const gm         = String(obj?.gameMode || row.gameMode || "").toLowerCase() || "normal";
  const takenAt    = nowIso();
  const clanName   = obj?.guildName || row.guildName || null;
  const playerName = row.username || name;

  exec(
    `INSERT INTO pvm_samples(playerLower, playerName, gameMode, takenAt, clanName, pvmJson)
     VALUES(?,?,?,?,?,?)`,
    [ln, playerName, gm, takenAt, clanName, JSON.stringify(pvm)]
  );

  try{
    const s    = _getSettings();
    const days = Number(s.pvmSampleRetentionDays ?? 14);
    prunePvmSamples(days);
  }catch(e){
    if (!dbState.degraded) console.warn("[pvm] recordPvmSampleForPlayer: sample pruning failed", e?.message);
  }

  _saveDb();
  return { ok:true, takenAt };
}

export function getPvmSnapshotStatus(name){
  const ln  = lower(name);
  const row = one("SELECT gameMode FROM players WHERE lowerName=?", [ln]);
  const gm  = String(row?.gameMode || "normal").toLowerCase();

  const last = one(
    `SELECT dayKey, takenAt FROM pvm_snapshots
     WHERE playerLower=? AND gameMode=?
     ORDER BY dayKey DESC LIMIT 1`,
    [ln, gm]
  );

  const countRow = one(
    `SELECT COUNT(DISTINCT dayKey) AS daysStored FROM pvm_snapshots WHERE playerLower=? AND gameMode=?`,
    [ln, gm]
  );

  return {
    ok:         true,
    gameMode:   gm,
    lastDayKey: last?.dayKey   || null,
    lastTakenAt:last?.takenAt  || null,
    daysStored: Number(countRow?.daysStored || 0),
  };
}

export function getPvmSampleStats(){
  const total  = one("SELECT COUNT(1) AS n FROM pvm_samples")?.n ?? 0;
  const maxRow = one(`SELECT MAX(c) AS mx FROM (SELECT COUNT(1) AS c FROM pvm_samples GROUP BY playerLower)`);
  const mx     = maxRow?.mx ?? 0;
  const s      = _getSettings();
  const retentionDays = Number(s.pvmSampleRetentionDays ?? 14);
  return { ok:true, totalSamples: Number(total||0), maxSamplesPerPlayer: Number(mx||0), retentionDays };
}

// ── Rolling delta ─────────────────────────────────────────────────────────────

export function getPvmRollingDelta({ name, hours=1, endIso=null } = {}){
  const nm = String(name||"").trim();
  if (!nm) return { ok:false, reason:"no_name" };
  const ln = lower(nm);

  const row = one("SELECT username, gameMode FROM players WHERE lowerName=?", [ln]);
  const gm  = String(row?.gameMode || "normal").toLowerCase() || "normal";

  const h = Math.max(0.016, Math.min(72, Number(hours||1)));
  const endMs = (() => {
    if (!endIso) return Date.now();
    const ms = Date.parse(String(endIso));
    return Number.isFinite(ms) ? ms : Date.now();
  })();
  const endIsoNorm = new Date(endMs).toISOString();
  const cutoffIso  = new Date(endMs - h*60*60*1000).toISOString();

  const { latest, base } = findRollingPair(ln, gm, cutoffIso, endIsoNorm);
  if (!latest) return { ok:true, hasBaseline:false, gameMode:gm, deltas:null };

  let curObj=null, baseObj=null;
  try{ curObj = JSON.parse(latest.pvmJson); }catch{}
  if (!base){
    return { ok:true, hasBaseline:false, gameMode:gm, currentTakenAt:latest.takenAt, deltas:null, current:curObj };
  }
  try{ baseObj = JSON.parse(base.pvmJson); }catch{}
  if (!curObj || !baseObj) return { ok:false, reason:"bad_json" };

  const deltas = {};
  const keys = new Set([...Object.keys(curObj), ...Object.keys(baseObj)]);
  for (const k of keys){
    const a = Number(curObj[k] ?? 0);
    const b = Number(baseObj[k] ?? 0);
    if (Number.isFinite(a) && Number.isFinite(b)) deltas[k] = a - b;
  }
  return { ok:true, hasBaseline:true, gameMode:gm, currentTakenAt:latest.takenAt, baselineTakenAt:base.takenAt, deltas, current:curObj };
}

// ── Correlation ───────────────────────────────────────────────────────────────

export function getPvmCorrelationRolling({ hours=1, endIso=null, minGroupSize=2, bossKey=null, minDelta=1, trackedOnly=true } = {}){
  const h          = Math.max(0.016, Math.min(72, Number(hours||1)));
  const minN       = Math.max(2, Math.min(50, Number(minGroupSize||2)));
  const minD       = Math.max(1, Math.min(1000000, Number(minDelta||1)));
  const bossFilter = bossKey ? String(bossKey||"").trim().toLowerCase() : null;
  const endMs      = (() => {
    if (endIso){ const t = Date.parse(String(endIso)); if (Number.isFinite(t)) return t; }
    return Date.now();
  })();
  const endIsoNorm = new Date(endMs).toISOString();
  const cutoffIso  = new Date(endMs - h*60*60*1000).toISOString();

  let players = [];
  if (trackedOnly){
    players = all("SELECT entityName FROM tracked WHERE entityType='player' AND enabled=1");
  }else{
    players = all("SELECT DISTINCT playerName as entityName FROM pvm_samples");
  }
  const names  = players.map(r=>String(r.entityName||"").trim()).filter(Boolean);
  if (names.length === 0) return { ok:true, groups:[], meta:{ players:0, withBaseline:0, withLatest:0 } };

  const lowers = [...new Set(names.map(n=>lower(n)))];

  const latestRows = all(
    `SELECT * FROM (
       SELECT playerLower, playerName, gameMode, takenAt, clanName, pvmJson,
              ROW_NUMBER() OVER (PARTITION BY playerLower, gameMode ORDER BY takenAt DESC) AS rn
       FROM pvm_samples
       WHERE takenAt <= ? AND playerLower IN (${lowers.map(()=>"?").join(",")})
     ) WHERE rn=1`,
    [endIsoNorm, ...lowers]
  );

  const baseRows = all(
    `SELECT s.playerLower, s.playerName, s.gameMode, s.takenAt, s.clanName, s.pvmJson
     FROM pvm_samples s
     JOIN (
       SELECT playerLower, gameMode, MAX(takenAt) AS takenAt
       FROM pvm_samples
       WHERE takenAt <= ? AND playerLower IN (${lowers.map(()=>"?").join(",")})
       GROUP BY playerLower, gameMode
     ) b ON s.playerLower=b.playerLower AND s.gameMode=b.gameMode AND s.takenAt=b.takenAt`,
    [cutoffIso, ...lowers]
  );

  const baseMap = new Map();
  for (const r of baseRows) baseMap.set(`${r.playerLower}::${r.gameMode}`, r);

  const latestKeys = new Set(latestRows.map(r=>`${r.playerLower}::${r.gameMode}`));
  let withBaseline = 0;
  for (const k of latestKeys){ if (baseMap.has(k)) withBaseline++; }

  const groupsMap = new Map();
  for (const cur of latestRows){
    const base = baseMap.get(`${cur.playerLower}::${cur.gameMode}`);
    if (!base) continue;
    let curObj=null, baseObj=null;
    try{ curObj = JSON.parse(cur.pvmJson); }catch{}
    try{ baseObj = JSON.parse(base.pvmJson); }catch{}
    if (!curObj || !baseObj) continue;
    const keys = new Set([...Object.keys(curObj), ...Object.keys(baseObj)]);
    for (const k of keys){
      const keyLower = String(k||"").toLowerCase();
      if (bossFilter && keyLower !== bossFilter) continue;
      const a = Number(curObj[k] ?? 0), b = Number(baseObj[k] ?? 0);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const d = a - b;
      if (d < minD) continue;
      const gk = `${cur.gameMode}::${keyLower}::${d}`;
      if (!groupsMap.has(gk)){
        groupsMap.set(gk, { gameMode:cur.gameMode, bossKey:k, delta:d, window:{ kind:"rolling", hours:h, cutoffIso, latestIso:endIsoNorm }, players:[] });
      }
      groupsMap.get(gk).players.push({ name:cur.playerName||cur.playerLower, playerLower:cur.playerLower, clanName:cur.clanName||null, before:b, after:a, beforeTakenAt:base.takenAt, afterTakenAt:cur.takenAt });
    }
  }

  const out = [];
  for (const g of groupsMap.values()){
    if (g.players.length >= minN){ g.players.sort((a,b)=>String(a.name).localeCompare(String(b.name))); out.push(g); }
  }
  out.sort((a,b)=>(b.players.length-a.players.length)||String(a.bossKey).localeCompare(String(b.bossKey)));
  return { ok:true, groups:out, meta:{ players:names.length, withLatest:latestKeys.size, withBaseline, hours:h, cutoffIso, endIso:endIsoNorm } };
}

export function getPvmCorrelation({ days=7, endDayKey=null, minGroupSize=2, bossKey=null, minDelta=1, trackedOnly=true } = {}){
  const d          = Math.max(1, Math.min(60, Number(days||7)));
  const minN       = Math.max(2, Math.min(50, Number(minGroupSize||2)));
  const minD       = Math.max(1, Math.min(1000000, Number(minDelta||1)));
  const bossFilter = bossKey ? String(bossKey).trim() : "";
  const tracked    = !!trackedOnly;

  let trackedSet = null;
  if (tracked){
    const trows = all(`SELECT entityLower FROM tracked WHERE entityType='player' AND enabled=1`);
    trackedSet  = new Set((trows||[]).map(r=>r.entityLower));
  }

  const endKey = endDayKey ? String(endDayKey) : dayKeyLocal(new Date());
  const start  = dayKeyLocal(new Date(Date.parse(endKey+"T00:00:00") - (d+2)*86400000));
  const rows   = all(
    `SELECT playerLower, playerName, gameMode, dayKey, clanName, pvmJson
     FROM pvm_snapshots WHERE dayKey >= ? AND dayKey <= ?
     ORDER BY playerLower ASC, gameMode ASC, dayKey ASC`,
    [start, endKey]
  );

  const by = new Map();
  for (const r of (rows||[])){
    if (trackedSet && !trackedSet.has(r.playerLower)) continue;
    const key = r.playerLower+"|"+String(r.gameMode||"normal").toLowerCase();
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }

  const groups = new Map();
  let playersWithBaseline = 0;
  const playersSeen = new Set();
  for (const [key, arr] of by.entries()){
    playersSeen.add(key);
    if (arr.length >= 2) playersWithBaseline++;
    for (let i=1;i<arr.length;i++){
      const prev=arr[i-1], cur=arr[i];
      let prevObj=null, curObj=null;
      try{ prevObj=JSON.parse(prev.pvmJson); }catch{}
      try{ curObj =JSON.parse(cur.pvmJson);  }catch{}
      if (!prevObj||!curObj) continue;
      const keys=new Set([...Object.keys(curObj),...Object.keys(prevObj)]);
      for (const bk of keys){
        if (bossFilter && bk!==bossFilter) continue;
        const a=Number(curObj[bk]??0), b=Number(prevObj[bk]??0);
        if (!Number.isFinite(a)||!Number.isFinite(b)) continue;
        const delta=a-b;
        if (delta<minD) continue;
        const gk=cur.dayKey+"|"+String(cur.gameMode||"normal").toLowerCase()+"|"+bk+"|"+String(delta);
        if (!groups.has(gk)) groups.set(gk,{ dayKey:cur.dayKey, gameMode:String(cur.gameMode||"normal").toLowerCase(), bossKey:bk, delta, players:[] });
        groups.get(gk).players.push({ playerName:cur.playerName, clanName:cur.clanName||null, before:b, after:a });
      }
    }
  }

  const out=[];
  for (const g of groups.values()){
    if (g.players.length>=minN){
      const seen=new Set();
      g.players=g.players.filter(p=>{ const k=(p.playerName||"").toLowerCase(); if(seen.has(k))return false; seen.add(k); return true; });
      out.push(g);
    }
  }
  out.sort((a,b)=>{
    if (a.dayKey!==b.dayKey) return a.dayKey<b.dayKey?1:-1;
    if (b.players.length!==a.players.length) return b.players.length-a.players.length;
    if (a.bossKey!==b.bossKey) return a.bossKey.localeCompare(b.bossKey);
    return b.delta-a.delta;
  });
  return { ok:true, days:d, minGroupSize:minN, minDelta:minD, bossKey:bossFilter||null, groups:out, meta:{ players:trackedSet?trackedSet.size:playersSeen.size, withBaseline:playersWithBaseline, days:d, endDayKey:endKey } };
}

// ── Clan PvM leaderboard profile ──────────────────────────────────────────────

const CLAN_PVM_BOSS_KEYS = [
  "chimera","devil","griffin","hades","medusa","zeus","sobek","kronos",
  "reckoning_of_the_gods","guardians_of_the_citadel","malignant_spider",
  "skeleton_warrior","otherworldly_golem","bloodmoon_massacre","mesines",
];

export async function fetchClanPvmProfile({ clanName } = {}){
  const nm = String(clanName||"").trim();
  if (!nm) return { ok:false, reason:"no_name" };
  const url  = `${API_BASE}/Leaderboard/profile/clans:default/${encodeURIComponent(nm)}`;
  const data = await _apiGetJsonAllow404(url);
  if (!data) return { ok:false, reason:"not_found" };
  const fields = data.fields || {};
  const pvm = {};
  for (const k of CLAN_PVM_BOSS_KEYS){ if (fields[k] != null) pvm[k] = fields[k]; }
  const takenAt = nowIso();
  const ln      = lower(nm);
  exec(
    `INSERT INTO clan_pvm_snapshots(clanLower, clanName, takenAt, pvmJson)
     VALUES(?,?,?,?)
     ON CONFLICT(clanLower) DO UPDATE SET clanName=excluded.clanName, takenAt=excluded.takenAt, pvmJson=excluded.pvmJson`,
    [ln, nm, takenAt, JSON.stringify(pvm)]
  );
  _saveDb();
  return { ok:true, takenAt, pvm };
}

export function getClanPvmSnapshot({ clanName } = {}){
  const nm = String(clanName||"").trim();
  if (!nm) return null;
  const row = one(`SELECT clanName, takenAt, pvmJson FROM clan_pvm_snapshots WHERE clanLower=?`, [lower(nm)]);
  if (!row) return null;
  try{ return { clanName:row.clanName, takenAt:row.takenAt, pvm:JSON.parse(row.pvmJson) }; }
  catch{ return null; }
}

// ── Player PvM leaderboard profile ────────────────────────────────────────────
//
// Same idea as fetchClanPvmProfile, but for an individual player. Hits
// /Leaderboard/profile/players:{gameMode}/{name} — gameMode is one of
// "default", "ironman", "groupironman" (matching the leaderboard board
// naming used elsewhere in the app).
const VALID_PLAYER_GAME_MODES = new Set(["default", "ironman", "groupironman"]);

export async function fetchPlayerPvmProfile({ playerName, gameMode="default" } = {}){
  const nm = String(playerName||"").trim();
  if (!nm) return { ok:false, reason:"no_name" };

  const gm = VALID_PLAYER_GAME_MODES.has(String(gameMode)) ? String(gameMode) : "default";

  const url  = `${API_BASE}/Leaderboard/profile/players:${gm}/${encodeURIComponent(nm)}`;
  const data = await _apiGetJsonAllow404(url);
  if (!data) return { ok:false, reason:"not_found" };

  // Capture the full fields object (skills + PvM bosses/raids, each with
  // {score, rank, expCapDate}) rather than filtering to a fixed boss list —
  // the player leaderboard profile endpoint returns ranks for everything in
  // one call, including skills (e.g. "exterminating") which the clan
  // endpoint doesn't have an equivalent for.
  const fields = data.fields || {};
  const totalLevelResult = data.totalLevelResult || null;

  const takenAt = nowIso();
  const ln      = lower(nm);
  const payload = { fields, totalLevelResult };
  exec(
    `INSERT INTO player_pvm_leaderboard_snapshots(playerLower, playerName, gameMode, takenAt, pvmJson)
     VALUES(?,?,?,?,?)
     ON CONFLICT(playerLower, gameMode) DO UPDATE SET playerName=excluded.playerName, takenAt=excluded.takenAt, pvmJson=excluded.pvmJson`,
    [ln, nm, gm, takenAt, JSON.stringify(payload)]
  );
  _saveDb();
  return { ok:true, takenAt, gameMode: gm, fields, totalLevelResult };
}

// Like fetchPlayerPvmProfile, but if the preferred game mode returns nothing
// (e.g. the player's stored gameMode is stale/wrong, or they're actually on
// a different leaderboard than expected), retries the other two game modes
// before giving up. The leaderboard profile endpoint 404s for a mode the
// player isn't ranked on at all, so this makes "Refresh ranks" work even
// when we're not sure which mode a player is currently in.
export async function fetchPlayerPvmProfileAuto({ playerName, preferredGameMode="default" } = {}){
  const nm = String(playerName||"").trim();
  if (!nm) return { ok:false, reason:"no_name" };

  const preferred = VALID_PLAYER_GAME_MODES.has(String(preferredGameMode)) ? String(preferredGameMode) : "default";
  const order = [preferred, ...[...VALID_PLAYER_GAME_MODES].filter(m => m !== preferred)];

  let lastResult = null;
  for (const gm of order){
    const result = await fetchPlayerPvmProfile({ playerName: nm, gameMode: gm });
    if (result?.ok) return result;
    lastResult = result;
  }
  return lastResult || { ok:false, reason:"not_found" };
}

export function getPlayerPvmLeaderboardSnapshot({ playerName, gameMode="default" } = {}){
  const nm = String(playerName||"").trim();
  if (!nm) return null;
  const gm = VALID_PLAYER_GAME_MODES.has(String(gameMode)) ? String(gameMode) : "default";
  const row = one(
    `SELECT playerName, gameMode, takenAt, pvmJson FROM player_pvm_leaderboard_snapshots WHERE playerLower=? AND gameMode=?`,
    [lower(nm), gm]
  );
  if (!row) return null;
  try{
    const parsed = JSON.parse(row.pvmJson) || {};
    // Backward-compat: older snapshots stored a flat {bossKey: {score,rank}}
    // map directly as pvmJson (no "fields" wrapper). Newer snapshots store
    // { fields, totalLevelResult }. Normalize both to the new shape.
    const fields = parsed.fields || parsed;
    const totalLevelResult = parsed.totalLevelResult || null;
    return { playerName:row.playerName, gameMode:row.gameMode, takenAt:row.takenAt, fields, totalLevelResult };
  }
  catch{ return null; }
}
