/**
 * electron/services/accounts.js
 *
 * Verified accounts (JWT token verification) and account skill snapshots.
 * Dependencies: db/core (exec, all, one, nowIso), api/client (verifyJwtSignature), saveDb
 */

import { exec, all, one, nowIso } from "../db/core.js";
import { verifyJwtSignature } from "../api/client.js";

let _saveDb = null;
export function initAccounts({ saveDb }){ _saveDb = saveDb; }

// ── Verified accounts ─────────────────────────────────────────────────────────

export async function verifyAccountToken(token, { signal } = {}){
  if (!token?.trim()) return { ok:false, error:"No token provided" };
  try{
    const { payload } = await verifyJwtSignature(token.trim(), { signal });
    const username = payload.sub||payload.username||payload.name||payload.player||null;
    if (!username) return { ok:false, error:"Token valid but no username claim found" };
    const ln=username.toLowerCase(), now=nowIso();
    exec(
      `INSERT INTO verified_accounts(username,lowerName,verifiedAt,tokenIssuer) VALUES(?,?,?,?)
       ON CONFLICT(lowerName) DO UPDATE SET username=excluded.username,verifiedAt=excluded.verifiedAt,tokenIssuer=excluded.tokenIssuer`,
      [username, ln, now, payload.iss||null]
    );
    _saveDb();
    return { ok:true, username, verifiedAt:now, issuer:payload.iss||null };
  }catch(e){ return { ok:false, error:String(e?.message||e) }; }
}

export function listVerifiedAccounts(){
  return all(`SELECT id,username,verifiedAt,tokenIssuer FROM verified_accounts ORDER BY username ASC`) || [];
}

// The first account linked overall (lowest id = earliest insertion,
// preserved across re-verifications since ON CONFLICT only updates
// username/verifiedAt/tokenIssuer, never id). Used for the window title
// ("Idle Clans Sentinel - <name>"). Returns null if no accounts are linked.
export function getFirstLinkedAccount(){
  return one(`SELECT id,username,verifiedAt FROM verified_accounts ORDER BY id ASC LIMIT 1`) || null;
}

export function removeVerifiedAccount(username){
  exec("DELETE FROM verified_accounts WHERE lowerName=?", [(username||"").toLowerCase()]);
  _saveDb(); return { ok:true };
}

// ── Account skill snapshots ───────────────────────────────────────────────────

export function snapshotAccountSkills(username){
  const ln = (username||"").toLowerCase();
  const row = one("SELECT profileJson FROM players WHERE lowerName=?", [ln]);
  if (!row?.profileJson) return { ok:false, error:"No profile stored for this account" };
  try{
    const profile = JSON.parse(row.profileJson);
    const skills  = profile?.skillExperiences;
    if (!skills || typeof skills !== "object" || Object.keys(skills).length === 0)
      return { ok:false, error:"No skill data in stored profile" };

    const xpArr   = Object.values(skills).map(Number).filter(v=>Number.isFinite(v));
    const totalXp = xpArr.reduce((a,b)=>a+b, 0);
    const now     = nowIso();

    const hourBucket = now.slice(0, 13);
    const existing = one(
      "SELECT id FROM account_skill_snapshots WHERE lowerName=? AND snappedAt LIKE ? || '%' LIMIT 1",
      [ln, hourBucket]
    );
    if (existing) return { ok:true, skipped:true };

    const rawPvm = profile?.pvmStats || null;
    const pvm = rawPvm && typeof rawPvm === "object"
      ? Object.fromEntries(
          Object.entries(rawPvm).map(([k, v]) => [
            k.replace(/([A-Z])/g, (m, ch, offset) => (offset === 0 ? ch : "_" + ch)).toLowerCase(),
            v
          ])
        )
      : null;
    const pvmJson = pvm ? JSON.stringify(pvm) : null;

    exec(
      "INSERT INTO account_skill_snapshots(lowerName,snappedAt,totalXp,skillsJson,pvmJson) VALUES(?,?,?,?,?)",
      [ln, now, totalXp, JSON.stringify(skills), pvmJson]
    );
    _saveDb();
    return { ok:true, snappedAt:now };
  }catch(e){ return { ok:false, error:String(e?.message||e) }; }
}

export function getAccountSkillHistory(username, { limit=90 } = {}){
  const ln = (username||"").toLowerCase();
  const n  = Math.max(1, Math.min(500, Number(limit)||90));
  const rows = all(
    "SELECT id,snappedAt,totalXp,skillsJson,pvmJson FROM account_skill_snapshots WHERE lowerName=? ORDER BY snappedAt DESC LIMIT ?",
    [ln, n]
  ) || [];
  return rows.map(r=>{
    let skills = {};
    try{ skills = JSON.parse(r.skillsJson); }catch{}
    let pvm = null;
    try{ if (r.pvmJson) pvm = JSON.parse(r.pvmJson); }catch{}
    return { ...r, skills, pvm };
  });
}

export function getAccountSkillLatest(username){
  const ln = (username||"").toLowerCase();
  const row = one(
    "SELECT snappedAt,totalXp,skillsJson,pvmJson FROM account_skill_snapshots WHERE lowerName=? ORDER BY snappedAt DESC LIMIT 1",
    [ln]
  );
  if (!row) return null;
  let skills = {};
  try{ skills = JSON.parse(row.skillsJson); }catch{}
  let pvm = null;
  try{ if (row.pvmJson) pvm = JSON.parse(row.pvmJson); }catch{}
  return { ...row, skills, pvm };
}

export function pruneAccountSkillHistory(username, keepDays=180){
  const ln  = (username||"").toLowerCase();
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
  exec("DELETE FROM account_skill_snapshots WHERE lowerName=? AND snappedAt < ?", [ln, cutoff]);
  _saveDb();
}
