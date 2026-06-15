/**
 * electron/services/clans.js
 *
 * All clan-related operations:
 *   - API fetch + upsert (upsertClanFromApi, lookupClanLive, previewClanLive)
 *   - Query functions (listClans, getClan, getAllClanNames)
 *   - Analysis (listClanSkillSignals, getClansWithNameClusters, getCrossClanMatches)
 *   - Modifiers (listFlaggedClans)
 *   - Discovery (listPotentialClans)
 *
 * Dependencies: db/core, shared/helpers, api/client (injected), api/logs (injected)
 */

import { exec, all, one, lower, nowIso, gameDataCache } from "../db/core.js";
import { upsertClanBasic, upsertClanMembers } from "../shared/helpers.js";
import { rankLabel } from "../utils.js";
import { xpToLevel } from "../lib/xp.js";

let _saveDb             = null;
let _apiGetJson         = null;
let _apiGetJsonAllow404 = null;
let _insertLogs         = null;
let _upsertPlayerFromApi = null;
const API_BASE           = "https://query.idleclans.com/api";

export function initClans({ saveDb, apiGetJson, apiGetJsonAllow404, insertLogs, upsertPlayerFromApi }){
  _saveDb              = saveDb;
  _apiGetJson          = apiGetJson;
  _apiGetJsonAllow404  = apiGetJsonAllow404;
  _insertLogs          = insertLogs;
  _upsertPlayerFromApi = upsertPlayerFromApi;
}

// ── API layer ─────────────────────────────────────────────────────────────────

export async function upsertClanFromApi(clanName, { signal } = {}){
  const url = `${API_BASE}/Clan/recruitment/${encodeURIComponent(clanName)}`;
  let data;
  try{
    data = await _apiGetJson(url, { signal });
  }catch(err){
    const msg = String(err?.message || err);
    if (msg.includes("404")){
      const ln = lower(clanName);
      exec("UPDATE clans SET notFoundAt=? WHERE lowerName=?", [nowIso(), ln]);
      _saveDb();
      return { ok:false, notFound:true, clanName };
    }
    throw err;
  }

  const ln = lower(data.clanName || clanName);
  exec("UPDATE clans SET notFoundAt=NULL WHERE lowerName=? AND notFoundAt IS NOT NULL", [ln]);

  const updatedAt = nowIso();
  upsertClanBasic(data.clanName || clanName, data.tag || null, data, updatedAt);
  if (Array.isArray(data.memberlist)) upsertClanMembers(data.clanName || clanName, data.memberlist, updatedAt);
  _saveDb();
  return { ok:true };
}

export async function lookupClanLive(clanName, { includeMemberProfiles=false, signal } = {}){
  const name = String(clanName || "").trim();
  if (!name) throw new Error("Clan name is required.");
  await upsertClanFromApi(name, { signal });
  await _insertLogs("clan", name, { signal });

  if (includeMemberProfiles){
    const clanLower = lower(name);
    const members = all("SELECT memberName FROM clan_members WHERE clanLower=? ORDER BY memberLower", [clanLower]);
    for (const m of members){
      const mn = m?.memberName;
      if (!mn) continue;
      await _upsertPlayerFromApi(mn, { signal });
    }
    _saveDb();
  }

  return getClan(name) || { ok:true };
}

export async function previewClanLive(clanName, { signal } = {}){
  const name = String(clanName || "").trim();
  if (!name) throw new Error("Clan name is required.");
  const url = `${API_BASE}/Clan/recruitment/${encodeURIComponent(name)}`;
  const data = await _apiGetJsonAllow404(url, { signal });
  if (data === null) return null;
  return data;
}

// ── Query functions ───────────────────────────────────────────────────────────

export function listClans(q="", { limit=100, offset=0, sortCol="clanName", sortDir="asc", gameMode=null, onlyStale=false, staleDays=7, onlyFlagged=false } = {}){
  const n    = Math.max(1, Math.min(500, Number(limit) || 100));
  const off  = Math.max(0, Number(offset) || 0);
  const like = `%${lower(q)}%`;

  const validCols = { clanName:"lowerName", tag:"tag", gameMode:"gameMode", updated:"updatedAt" };
  const orderCol  = validCols[sortCol] || "lowerName";
  const orderDir  = String(sortDir).toLowerCase() === "desc" ? "DESC" : "ASC";

  // Always include the LIKE filter — when q="" it becomes '%%' which matches all
  const where  = ["c.lowerName LIKE ?"];
  const params = [like];

  if (gameMode && gameMode !== "all"){ where.push("c.gameMode = ?"); params.push(String(gameMode)); }
  if (onlyStale){
    const cutoff = new Date(Date.now() - (Number(staleDays) || 7) * 86400000).toISOString();
    where.push("(c.updatedAt IS NULL OR c.updatedAt < ?)");
    params.push(cutoff);
  }
  if (onlyFlagged){
    where.push("EXISTS (SELECT 1 FROM tracked t WHERE t.entityType='clan' AND t.entityLower=c.lowerName AND t.enabled=1)");
  }

  const total = one(`SELECT COUNT(*) AS n FROM clans c WHERE ${where.join(" AND ")}`, params)?.n || 0;
  const rows  = all(
    `SELECT c.clanName, c.lowerName, c.tag, c.gameMode, c.updatedAt,
            COUNT(cm.memberLower) AS memberCount,
            CASE WHEN t.enabled=1 THEN 1 ELSE 0 END AS flagged
     FROM clans c
     LEFT JOIN clan_members cm ON cm.clanLower = c.lowerName
     LEFT JOIN tracked t ON t.entityType='clan' AND t.entityLower=c.lowerName AND t.enabled=1
     WHERE ${where.join(" AND ")}
     GROUP BY c.lowerName
     ORDER BY ${orderCol === "lowerName" ? "c.lowerName" : orderCol} ${orderDir}
     LIMIT ? OFFSET ?`,
    [...params, n, off]
  );
  return { rows, total, limit: n, offset: off };
}

export function getClan(name){
  const clanLower = lower(name);
  const r = one("SELECT clanName, gameMode, tag, dataJson, updatedAt, leaderboardStandingsJson, leaderboardStandingsAt FROM clans WHERE lowerName=?", [clanLower]);
  if (!r) return null;
  let obj = {};
  try{ obj = JSON.parse(r.dataJson || "{}"); }catch{}
  const members = all(
    `SELECT cm.memberName, cm.memberLower, cm.rank, cm.hoursOffline, cm.lastScannedAt, cm.lastUpdatedAt,
            p.bannedAt AS bannedAt
     FROM clan_members cm
     LEFT JOIN players p ON p.lowerName = cm.memberLower
     WHERE cm.clanLower=?
     ORDER BY cm.rank DESC, cm.memberLower ASC`,
    [clanLower]
  ).map(m => ({ ...m, rankLabel: rankLabel(m.rank) }));
  let skills = {};
  if (obj.serializedSkills){ try{ skills = JSON.parse(obj.serializedSkills); }catch{} }
  let leaderboardStandings = {};
  try{ leaderboardStandings = JSON.parse(r.leaderboardStandingsJson || "{}") || {}; }catch{}
  return {
    ...obj, clanName: r.clanName, gameMode: r.gameMode, tag: r.tag, updatedAt: r.updatedAt, skills, members,
    leaderboardStandings,
    leaderboardStandingsAt: r.leaderboardStandingsAt || null,
  };
}

export function getAllClanNames(q="", { gameMode=null, onlyStale=false, staleDays=7, onlyFlagged=false } = {}){
  const like   = `%${lower(q)}%`;
  const where  = ["c.lowerName LIKE ?"];
  const params = [like];
  if (gameMode && gameMode !== "all"){ where.push("c.gameMode = ?"); params.push(String(gameMode)); }
  if (onlyStale){
    const cutoff = new Date(Date.now() - (Number(staleDays) || 7) * 86400000).toISOString();
    where.push("(c.updatedAt IS NULL OR c.updatedAt < ?)");
    params.push(cutoff);
  }
  if (onlyFlagged){
    where.push("EXISTS (SELECT 1 FROM tracked t WHERE t.entityType='clan' AND t.entityLower=c.lowerName AND t.enabled=1)");
  }
  return all(`SELECT c.lowerName FROM clans c WHERE ${where.join(" AND ")}`, params).map(r => r.lowerName);
}

export function listFlaggedClans({ limit=500 } = {}){
  const n = Math.max(1, Math.min(5000, Number(limit) || 500));
  return all(
    `SELECT t.entityLower AS lowerName, t.entityName AS clanName,
            c.tag, c.gameMode, c.updatedAt,
            t.intervalMinutes, t.nextRunAt,
            (SELECT COUNT(*) FROM clan_members cm WHERE cm.clanLower = t.entityLower) AS memberCount
     FROM tracked t
     LEFT JOIN clans c ON c.lowerName = t.entityLower
     WHERE t.entityType='clan' AND t.enabled=1
     ORDER BY COALESCE(t.nextRunAt, '0000') ASC, t.entityName ASC LIMIT ?`,
    [n]
  );
}

// ── Skill signals ─────────────────────────────────────────────────────────────

export function listClanSkillSignals(opts = {}){
  const maxOfflineDays    = Number.isFinite(Number(opts.maxOfflineDays))    ? Number(opts.maxOfflineDays)    : 14;
  const minActiveMembers  = Number.isFinite(Number(opts.minActiveMembers))  ? Number(opts.minActiveMembers)  : 5;
  const minClanSize       = Number.isFinite(Number(opts.minClanSize))       ? Number(opts.minClanSize)       : 10;
  const includeUnknown    = !!opts.includeUnknownActivity;
  let sortBy = String(opts.sortBy || "range");
  if (sortBy === "spread")    sortBy = "range";
  if (sortBy === "combatGap") sortBy = "focus";
  const minSkillLevel = Number.isFinite(Number(opts.minSkillLevel)) ? Number(opts.minSkillLevel) : 80;
  const maxHours = maxOfflineDays * 24;

  const rows = all(
    `SELECT c.lowerName, c.clanName, c.tag, c.updatedAt, c.dataJson,
            COUNT(cm.memberLower) AS memberCount,
            SUM(CASE WHEN cm.hoursOffline IS NOT NULL THEN 1 ELSE 0 END) AS scannedCount,
            SUM(CASE WHEN cm.hoursOffline IS NOT NULL AND cm.hoursOffline <= ? THEN 1 ELSE 0 END) AS activeCount,
            MAX(cm.lastScannedAt) AS lastMemberScanAt
     FROM clans c
     LEFT JOIN clan_members cm ON cm.clanLower = c.lowerName
     GROUP BY c.lowerName
     HAVING memberCount >= ?
     LIMIT 2000`,
    [maxHours, minClanSize]
  ) || [];

  const asLevel = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    let lvl = 0;
    try{ lvl = xpToLevel(n); }catch{ lvl = 0; }
    return lvl;
  };

  const results = [];
  for (const row of rows){
    if (!includeUnknown && row.scannedCount === 0) continue;
    const active = Number(row.activeCount) || 0;
    if (active < minActiveMembers) continue;

    let obj = {};
    try{ obj = JSON.parse(row.dataJson || "{}"); }catch{}
    let skills = {};
    if (obj.serializedSkills){ try{ skills = JSON.parse(obj.serializedSkills); }catch{} }
    const allSkills = skills.skills || skills || {};
    const skillMap = Object.fromEntries(
      Object.entries(allSkills).map(([k,v]) => [String(k), asLevel(v)])
    );
    if (!Object.keys(skillMap).length) continue;

    const combatKeys = new Set(["Rigour","Strength","Defence","Archery","Magic","Health"]);
    const lvls = Object.values(skillMap).filter(v => v >= minSkillLevel);
    if (!lvls.length) continue;

    const min  = Math.min(...lvls);
    const max  = Math.max(...lvls);
    const range = max - min;
    const combatLvls  = Object.entries(skillMap).filter(([k]) => combatKeys.has(k)).map(([,v])=>v);
    const skillLvls   = Object.entries(skillMap).filter(([k]) => !combatKeys.has(k)).map(([,v])=>v);
    const combatAvg   = combatLvls.length ? combatLvls.reduce((a,b)=>a+b,0)/combatLvls.length : 0;
    const skillAvg    = skillLvls.length  ? skillLvls.reduce((a,b)=>a+b,0)/skillLvls.length   : 0;
    const focus = Math.round(Math.abs(combatAvg - skillAvg) * 1000) / 1000;

    results.push({
      lowerName: row.lowerName, clanName: row.clanName, tag: row.tag,
      updatedAt: row.updatedAt, memberCount: row.memberCount,
      scannedCount: row.scannedCount, activeCount: active,
      lastMemberScanAt: row.lastMemberScanAt,
      skillMap, min, max, range, focus, combatAvg, skillAvg,
    });
  }

  results.sort((a, b) => {
    if (sortBy === "focus")  return b.focus  - a.focus;
    if (sortBy === "min")    return b.min    - a.min;
    if (sortBy === "max")    return b.max    - a.max;
    return b.range - a.range;
  });

  return results;
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export function listPotentialClans({ q="", limit=50, offset=0, minLogs=50, includeJoinLeave=false } = {}){
  const n   = Math.max(1, Math.min(500,  Number(limit)  || 50));
  const off = Math.max(0, Math.min(100000000, Number(offset) || 0));
  const minL = Math.max(0, Math.min(1000000, Number(minLogs) || 0));
  const like = q ? `%${lower(q)}%` : null;

  const logTypes = includeJoinLeave
    ? ["'clanJoin'","'clanLeave'","'memberJoin'","'memberLeave'","'memberKicked'"]
    : ["'clanJoin'","'clanLeave'"];

  const countSql = `
    SELECT COUNT(DISTINCT pch.toClan) AS n
    FROM player_clan_history pch
    LEFT JOIN clans c ON c.clanName = pch.toClan
    WHERE c.lowerName IS NULL
      AND pch.toClan IS NOT NULL AND TRIM(pch.toClan) <> ''
      ${like ? "AND LOWER(pch.toClan) LIKE ?" : ""}
    HAVING COUNT(*) >= ?
  `;
  const countParams = like ? [like, minL] : [minL];
  const total = one(countSql, countParams)?.n || 0;

  const rows = all(
    `SELECT pch.toClan AS clanName,
            COUNT(*) AS logCount,
            MAX(pch.timestamp) AS lastSeen
     FROM player_clan_history pch
     LEFT JOIN clans c ON c.clanName = pch.toClan
     WHERE c.lowerName IS NULL
       AND pch.toClan IS NOT NULL AND TRIM(pch.toClan) <> ''
       ${like ? "AND LOWER(pch.toClan) LIKE ?" : ""}
     GROUP BY pch.toClan
     HAVING logCount >= ?
     ORDER BY logCount DESC, lastSeen DESC
     LIMIT ? OFFSET ?`,
    like ? [like, minL, n, off] : [minL, n, off]
  );
  return { rows: rows || [], total, limit: n, offset: off };
}

// ── Name matching / cross-clan helpers ───────────────────────────────────────

function normNameForMatch(name){
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
}

function stripTrailingDigits(s){ return String(s || "").replace(/\d+$/g, ""); }

function stripKnownSuffixes(s){
  const suffixes = ["mine","main","alt","skiller","iron","im","gim","hc","hcgim","hcim","pk","pker","bank","shop","bot","test"];
  let out = String(s || "");
  for (const suf of suffixes){
    if (out.endsWith(suf) && out.length > suf.length + 2){ out = out.slice(0, -suf.length); break; }
  }
  return out;
}

function nameVariants(name){
  const base = normNameForMatch(name);
  const set  = new Set();
  if (!base) return [];
  set.add(base);
  set.add(stripTrailingDigits(base));
  set.add(stripKnownSuffixes(base));
  set.add(stripTrailingDigits(stripKnownSuffixes(base)));
  set.add(base.replace(/^(.)\1+/, "").replace(/(.)\1+$/, ""));
  return Array.from(set).filter(v => v && v.length >= 3);
}

function bigramDice(a, b){
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const map = new Map();
  for (let i=0; i<a.length-1; i++){ const bg = a.slice(i,i+2); map.set(bg,(map.get(bg)||0)+1); }
  let intersect = 0;
  for (let i=0; i<b.length-1; i++){
    const bg = b.slice(i,i+2); const cnt = map.get(bg)||0;
    if (cnt>0){ intersect++; map.set(bg,cnt-1); }
  }
  return (2*intersect) / ((a.length-1)+(b.length-1));
}

function jaroWinkler(a, b){
  if (!a||!b) return 0; if (a===b) return 1;
  const len1=a.length, len2=b.length;
  if (!len1||!len2) return 0;
  const matchDist = Math.floor(Math.max(len1,len2)/2)-1;
  const m1=new Array(len1).fill(false), m2=new Array(len2).fill(false);
  let matches=0;
  for (let i=0;i<len1;i++){
    const start=Math.max(0,i-matchDist), end=Math.min(i+matchDist+1,len2);
    for (let j=start;j<end;j++){
      if (m2[j]||a[i]!==b[j]) continue;
      m1[i]=true; m2[j]=true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t=0,k=0;
  for (let i=0;i<len1;i++){
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (a[i]!==b[k]) t++;
    k++;
  }
  const jaro=((matches/len1)+(matches/len2)+((matches-t/2)/matches))/3;
  let prefix=0;
  for (let i=0;i<Math.min(4,len1,len2);i++){ if (a[i]===b[i]) prefix++; else break; }
  return jaro + prefix*0.1*(1-jaro);
}

function combinedNameScore(aRaw, bRaw){
  const av=nameVariants(aRaw), bv=nameVariants(bRaw);
  let best=0;
  for (const a of av) for (const b of bv){
    if (!a||!b) continue;
    const shorter=a.length<=b.length?a:b, longer=a.length<=b.length?b:a;
    let sub=0;
    if (shorter.length>=4&&longer.includes(shorter)) sub=0.75+0.25*(shorter.length/longer.length);
    let prefix=0;
    const minLen=Math.min(a.length,b.length);
    if (minLen>=4){ let cpl=0; for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]===b[i])cpl++;else break;} prefix=cpl/minLen; }
    const score=Math.max(bigramDice(a,b),jaroWinkler(a,b),sub,prefix);
    if (score>best) best=score;
  }
  return best;
}

function clusterNames(names, threshold){
  const n=names.length;
  const parent=Array.from({length:n},(_,i)=>i);
  const find=(x)=>{ while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];} return x; };
  const union=(a,b)=>{ const ra=find(a),rb=find(b); if(ra!==rb) parent[rb]=ra; };
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++){
    const ai=normNameForMatch(names[i]),aj=normNameForMatch(names[j]);
    if (!ai||!aj) continue;
    if (ai[0]!==aj[0]&&ai.slice(0,3)!==aj.slice(0,3)) continue;
    if (combinedNameScore(names[i],names[j])>=threshold) union(i,j);
  }
  const groups=new Map();
  for (let i=0;i<n;i++){ const r=find(i); if(!groups.has(r))groups.set(r,[]); groups.get(r).push(i); }
  return Array.from(groups.values()).map(idxs=>idxs.map(i=>names[i]));
}

function normLettersOnly(name,{ignoreDigits=true}={}){
  const base=normNameForMatch(name);
  if (!base) return "";
  return ignoreDigits?base.replace(/\d+/g,""):base;
}

function nameVariantsOpt(name,{ignoreDigits=true}={}){
  const base=normNameForMatch(name);
  const set=new Set();
  if (!base) return [];
  set.add(base);
  set.add(stripKnownSuffixes(base));
  set.add(stripTrailingDigits(stripKnownSuffixes(base)));
  if (ignoreDigits) set.add(stripTrailingDigits(base));
  set.add(base.replace(/^(.)\1+/,"").replace(/(.)\1+$/,""));
  return Array.from(set).filter(v=>v&&v.length>=3);
}

function combinedNameScoreOpt(aRaw,bRaw,{ignoreDigits=true}={}){
  const av=nameVariantsOpt(aRaw,{ignoreDigits}),bv=nameVariantsOpt(bRaw,{ignoreDigits});
  let best=0;
  for (const a of av) for (const b of bv){
    if (!a||!b) continue;
    const shorter=a.length<=b.length?a:b,longer=a.length<=b.length?b:a;
    let sub=0;
    if (shorter.length>=4&&longer.includes(shorter)) sub=0.75+0.25*(shorter.length/longer.length);
    let prefix=0;
    const minLen=Math.min(a.length,b.length);
    if (minLen>=4){let cpl=0;for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]===b[i])cpl++;else break;}prefix=cpl/minLen;}
    const score=Math.max(bigramDice(a,b),jaroWinkler(a,b),sub,prefix);
    if (score>best) best=score;
  }
  return best;
}

function makeCrossClanBuildKey({similarityThreshold=0.90,ignoreDigits=true,mode="any"}={}){
  const th=Number.isFinite(Number(similarityThreshold))?Number(similarityThreshold):0.90;
  return JSON.stringify({v:1,th:Math.round(th*1000)/1000,ig:!!ignoreDigits,m:String(mode||"any").toLowerCase()});
}

function loadCrossClanCache(cacheKey){
  const row=one("SELECT cacheKey,builtAt,buildParamsJson,clustersJson,statsJson FROM cross_clan_cache WHERE cacheKey=?",[cacheKey]);
  if (!row) return null;
  try{ return {cacheKey:row.cacheKey,builtAt:row.builtAt,build:JSON.parse(row.buildParamsJson||"{}"),clusters:JSON.parse(row.clustersJson||"[]"),stats:JSON.parse(row.statsJson||"{}")}; }
  catch{ return null; }
}

function saveCrossClanCache({cacheKey,builtAt,build,clusters,stats}){
  exec("INSERT OR REPLACE INTO cross_clan_cache(cacheKey,builtAt,buildParamsJson,clustersJson,statsJson) VALUES(?,?,?,?,?)",
    [cacheKey,builtAt,JSON.stringify(build||{}),JSON.stringify(clusters||[]),JSON.stringify(stats||{})]);
  _saveDb();
}

function buildCrossClanClusters({similarityThreshold=0.90,ignoreDigits=true,mode="any"}={}){
  const threshold=Number.isFinite(Number(similarityThreshold))?Number(similarityThreshold):0.90;
  const igDigits=!!ignoreDigits;
  const m=String(mode||"any").toLowerCase();
  const rows=all(`SELECT c.clanName,c.gameMode,c.lowerName as clanLower,m.memberName,m.hoursOffline FROM clans c JOIN clan_members m ON m.clanLower=c.lowerName ORDER BY m.memberLower`,[]);
  const members=[];
  for (const r of rows){
    const gm=String(r.gameMode||"").toLowerCase();
    if (m!=="any"&&gm&&gm!==m) continue;
    members.push({name:r.memberName,clanName:r.clanName,clanLower:r.clanLower,gameMode:r.gameMode,hoursOffline:(r.hoursOffline===null||r.hoursOffline===undefined)?null:Number(r.hoursOffline)});
  }
  const n=members.length;
  const parent=Array.from({length:n},(_,i)=>i);
  const size=Array.from({length:n},()=>1);
  const maxSim=Array.from({length:n},()=>0);
  const find=(x)=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const union=(a,b,sim)=>{let ra=find(a),rb=find(b);if(ra===rb){if(sim>maxSim[ra])maxSim[ra]=sim;return;}if(size[ra]<size[rb]){const t=ra;ra=rb;rb=t;}parent[rb]=ra;size[ra]+=size[rb];maxSim[ra]=Math.max(maxSim[ra],maxSim[rb],sim);};
  const buckets=new Map();
  const addBucket=(key,idx)=>{if(!key)return;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(idx);};
  for (let i=0;i<n;i++){
    const letters=normLettersOnly(members[i].name,{ignoreDigits:igDigits});
    if (!letters||letters.length<3) continue;
    addBucket(`p3:${letters.slice(0,3)}`,i);
    addBucket(`p4:${letters.slice(0,4)}`,i);
    addBucket(`s3:${letters.slice(-3)}`,i);
  }
  const compared=new Set();
  const pairKey=(a,b)=>(a<b)?`${a}:${b}`:`${b}:${a}`;
  for (const idxs of buckets.values()){
    if (idxs.length<2) continue;
    const groups=[];
    if (idxs.length>600){
      const byLen=new Map();
      for (const i of idxs){const l=(normLettersOnly(members[i].name,{ignoreDigits:igDigits})||"").length;const band=Math.floor(l/3);if(!byLen.has(band))byLen.set(band,[]);byLen.get(band).push(i);}
      for (const g of byLen.values()) groups.push(g);
    } else { groups.push(idxs); }
    for (const group of groups){
      const L=group.length;
      if (L<2) continue;
      for (let x=0;x<L;x++){
        const i=group[x],ai=normNameForMatch(members[i].name);
        if (!ai) continue;
        for (let y=x+1;y<L;y++){
          const j=group[y],key=pairKey(i,j);
          if (compared.has(key)) continue;
          compared.add(key);
          const aj=normNameForMatch(members[j].name);
          if (!aj) continue;
          if (ai[0]!==aj[0]&&ai.slice(0,3)!==aj.slice(0,3)) continue;
          const score=combinedNameScoreOpt(members[i].name,members[j].name,{ignoreDigits:igDigits});
          if (score>=threshold) union(i,j,score);
        }
      }
    }
  }
  const clustersByRoot=new Map();
  for (let i=0;i<n;i++){const r=find(i);if(!clustersByRoot.has(r))clustersByRoot.set(r,[]);clustersByRoot.get(r).push(i);}
  const clusters=[];let cid=1;
  for (const [root,idxs] of clustersByRoot.entries()){
    if (idxs.length<2) continue;
    const clanCounts=new Map();
    for (const i of idxs){const cl=members[i].clanLower;clanCounts.set(cl,(clanCounts.get(cl)||0)+1);}
    clusters.push({id:cid++,size:idxs.length,distinctClans:clanCounts.size,maxSim:maxSim[find(root)]||0,members:idxs.map(i=>members[i])});
  }
  return {clusters,stats:{totalMembers:n,totalClusters:clusters.length}};
}

function pctScore(x){
  const v=Number(x||0);
  if (!Number.isFinite(v)) return "0%";
  const p=v*100;
  const rounded=Math.abs(p-Math.round(p))<0.05?Math.round(p):Math.round(p*10)/10;
  return `${rounded}%`;
}

export function getClansWithNameClusters({offlineDaysMax=7,minGroupSize=4,similarityThreshold=0.80}={}){
  const maxH=offlineDaysMax*24;
  const rows=all(
    `SELECT c.lowerName,c.clanName,c.gameMode,c.updatedAt,
            GROUP_CONCAT(m.memberName,'|||') AS memberNames
     FROM clans c
     JOIN clan_members m ON m.clanLower=c.lowerName
     WHERE (m.hoursOffline IS NULL OR m.hoursOffline<=?)
     GROUP BY c.lowerName`,
    [maxH]
  )||[];
  const result=[];
  for (const row of rows){
    const names=(row.memberNames||"").split("|||").map(n=>n.trim()).filter(Boolean);
    if (names.length<2) continue;
    const groups=clusterNames(names,similarityThreshold).filter(g=>g.length>=minGroupSize);
    if (!groups.length) continue;
    result.push({lowerName:row.lowerName,clanName:row.clanName,gameMode:row.gameMode,updatedAt:row.updatedAt,groups});
  }
  result.sort((a,b)=>Math.max(...b.groups.map(g=>g.length))-Math.max(...a.groups.map(g=>g.length)));
  return result;
}

export function getCrossClanMatches(params={}){
  const th=Number.isFinite(Number(params.similarityThreshold))?Number(params.similarityThreshold):0.90;
  const igDigits=params.ignoreDigits!==false;
  const mode=String(params.mode||"any").toLowerCase();
  const minGroupSize=Math.max(2,Number(params.minGroupSize||2));
  const minDistinctClans=Math.max(2,Number(params.minDistinctClans||2));
  const minOfflineHours=params.minOfflineHours!==undefined?Number(params.minOfflineHours):null;
  const maxOfflineHours=params.maxOfflineHours!==undefined?Number(params.maxOfflineHours):null;
  const cacheKey=makeCrossClanBuildKey({similarityThreshold:th,ignoreDigits:igDigits,mode});

  let cached=null;
  try{ cached=loadCrossClanCache(cacheKey); }catch{}
  let build,clusters,stats;
  const staleMinutes=Number.isFinite(Number(params.maxCacheAgeMinutes))?Number(params.maxCacheAgeMinutes):120;
  const isStale=!cached||(Date.now()-Date.parse(cached.builtAt)>staleMinutes*60000);

  if (isStale){
    const result=buildCrossClanClusters({similarityThreshold:th,ignoreDigits:igDigits,mode});
    build={similarityThreshold:th,ignoreDigits:igDigits,mode};
    clusters=result.clusters;
    stats=result.stats;
    try{ saveCrossClanCache({cacheKey,builtAt:nowIso(),build,clusters,stats}); }catch{}
  } else {
    build=cached.build;clusters=cached.clusters;stats=cached.stats;
  }

  let filtered=clusters.filter(c=>c.size>=minGroupSize&&c.distinctClans>=minDistinctClans);
  if (minOfflineHours!==null&&Number.isFinite(minOfflineHours)){
    filtered=filtered.map(c=>({...c,members:c.members.filter(m=>m.hoursOffline===null||m.hoursOffline>=minOfflineHours)})).filter(c=>c.members.length>=minGroupSize);
  }
  if (maxOfflineHours!==null&&Number.isFinite(maxOfflineHours)){
    filtered=filtered.map(c=>({...c,members:c.members.filter(m=>m.hoursOffline===null||m.hoursOffline<=maxOfflineHours)})).filter(c=>c.members.length>=minGroupSize);
  }
  filtered.sort((a,b)=>b.distinctClans-a.distinctClans||b.size-a.size);
  return {clusters:filtered,stats,build,cacheKey,builtAt:cached?.builtAt||null};
}
