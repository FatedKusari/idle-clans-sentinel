/**
 * electron/services/cases.js
 *
 * Case management — create, update, delete, notes, entities, snapshots,
 * and auto-snapshot scheduling.
 *
 * NOTE: runCaseAutoSnapshots() stays in services.js because it calls
 * lookupPlayerLive() and getPlayer() from the players domain, which creates a
 * cross-module dependency. It will move here in Phase 3 when players is extracted.
 *
 * Dependencies: db/core (exec, all, one, nowIso, lower), saveDb
 */

import { exec, all, one, nowIso, lower } from "../db/core.js";

let _saveDb = null;
export function initCases({ saveDb }){ _saveDb = saveDb; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampStr(s, max=180){
  return String(s||"").trim().slice(0, max);
}

// ── Core case CRUD ────────────────────────────────────────────────────────────

export function createCase({ title, summary=null } = {}){
  const t = clampStr(title, 120);
  if (!t) throw new Error("Case title is required");
  const now = nowIso();
  exec(
    "INSERT INTO cases(title,status,createdAt,updatedAt,summary) VALUES(?,?,?,?,?)",
    [t, "open", now, now, summary ? String(summary) : null]
  );
  const id = one("SELECT last_insert_rowid() AS id")?.id;
  _saveDb();
  return { ok:true, id, caseId: id };
}

export function listCases({ limit=200 } = {}){
  const n = Math.max(1, Math.min(1000, Number(limit||200)));
  return all(
    `SELECT c.id, c.title, c.status, c.createdAt, c.updatedAt, c.summary,
            c.autoSnapshotEnabled, c.autoSnapshotIntervalHours, c.lastAutoSnapshotAt,
            (SELECT COUNT(*) FROM case_entities e WHERE e.caseId=c.id) AS entityCount,
            (SELECT COUNT(*) FROM case_notes n WHERE n.caseId=c.id) AS noteCount,
            (SELECT COUNT(*) FROM case_snapshots s WHERE s.caseId=c.id) AS snapshotCount
     FROM cases c
     ORDER BY datetime(c.updatedAt) DESC
     LIMIT ?`,
    [n]
  );
}

export function getCase(caseId){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const c = one("SELECT * FROM cases WHERE id=?", [id]);
  if (!c) return null;
  const entities = all(
    "SELECT entityType, entityLower, entityName, createdAt FROM case_entities WHERE caseId=? ORDER BY entityType, entityName",
    [id]
  );
  const notes = all(
    "SELECT id, createdAt, note FROM case_notes WHERE caseId=? ORDER BY datetime(createdAt) DESC",
    [id]
  );
  const snapshots = all(
    "SELECT id, createdAt, kind, title FROM case_snapshots WHERE caseId=? ORDER BY datetime(createdAt) DESC",
    [id]
  );
  return { ...c, entities, notes, snapshots };
}

export function updateCase({ caseId, title, status, summary } = {}){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const existing = one("SELECT * FROM cases WHERE id=?", [id]);
  if (!existing) throw new Error("Case not found");
  const t   = title   != null ? clampStr(title, 120) : existing.title;
  const st  = status  != null ? String(status) : existing.status;
  const sum = summary !== undefined ? (summary == null ? null : String(summary)) : existing.summary;
  exec(
    "UPDATE cases SET title=?, status=?, summary=?, updatedAt=? WHERE id=?",
    [t, st, sum, nowIso(), id]
  );
  _saveDb();
  return { ok:true };
}

export function deleteCase(caseId){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  exec("DELETE FROM case_entities WHERE caseId=?", [id]);
  exec("DELETE FROM case_notes WHERE caseId=?", [id]);
  exec("DELETE FROM case_snapshots WHERE caseId=?", [id]);
  exec("DELETE FROM cases WHERE id=?", [id]);
  _saveDb();
  return { ok:true };
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export function addCaseNote({ caseId, note } = {}){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const text = String(note ?? "").trim();
  if (!text) throw new Error("Note is empty");
  exec(
    "INSERT INTO case_notes(caseId,createdAt,note) VALUES(?,?,?)",
    [id, nowIso(), text]
  );
  exec("UPDATE cases SET updatedAt=? WHERE id=?", [nowIso(), id]);
  _saveDb();
  return { ok:true };
}

// ── Entities ──────────────────────────────────────────────────────────────────

export function attachCaseEntity({ caseId, entityType, entityName } = {}){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const et = String(entityType||"").toLowerCase();
  if (!et || (et !== "player" && et !== "clan")) throw new Error("entityType must be player|clan");
  const name = String(entityName||"").trim();
  if (!name) throw new Error("entityName required");
  exec(
    "INSERT INTO case_entities(caseId,entityType,entityLower,entityName,createdAt) VALUES(?,?,?,?,?) ON CONFLICT(caseId,entityType,entityLower) DO UPDATE SET entityName=excluded.entityName",
    [id, et, lower(name), name, nowIso()]
  );
  exec("UPDATE cases SET updatedAt=? WHERE id=?", [nowIso(), id]);
  _saveDb();
  return { ok:true };
}

export function detachCaseEntity({ caseId, entityType, entityName } = {}){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const et   = String(entityType||"").toLowerCase();
  const name = String(entityName||"").trim();
  if (!et || !name) throw new Error("entityType and entityName required");
  exec(
    "DELETE FROM case_entities WHERE caseId=? AND entityType=? AND entityLower=?",
    [id, et, lower(name)]
  );
  exec("UPDATE cases SET updatedAt=? WHERE id=?", [nowIso(), id]);
  _saveDb();
  return { ok:true };
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export function addCaseSnapshot({ caseId, kind, title=null, data } = {}){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const k = String(kind||"").trim();
  if (!k) throw new Error("Snapshot kind required");
  const json = JSON.stringify(data ?? null);
  exec(
    "INSERT INTO case_snapshots(caseId,createdAt,kind,title,dataJson) VALUES(?,?,?,?,?)",
    [id, nowIso(), k, title ? clampStr(title, 140) : null, json]
  );
  exec("UPDATE cases SET updatedAt=? WHERE id=?", [nowIso(), id]);
  _saveDb();
  return { ok:true };
}

export function getCaseSnapshot({ snapshotId }){
  const id = Number(snapshotId);
  if (!Number.isFinite(id)) throw new Error("Invalid snapshotId");
  const row = one("SELECT id, caseId, createdAt, kind, title, dataJson FROM case_snapshots WHERE id=?", [id]);
  if (!row) return null;
  let data = null;
  try{ data = JSON.parse(row.dataJson); }catch{ data = null; }
  return { ...row, data };
}

// ── Auto-snapshot scheduling ──────────────────────────────────────────────────

export function migrateCaseAutoSnapshotColumns(){
  const cols = all("PRAGMA table_info(cases)").map(r => r.name);
  if (!cols.includes("autoSnapshotEnabled")){
    exec("ALTER TABLE cases ADD COLUMN autoSnapshotEnabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("autoSnapshotIntervalHours")){
    exec("ALTER TABLE cases ADD COLUMN autoSnapshotIntervalHours INTEGER NOT NULL DEFAULT 24");
  }
  if (!cols.includes("lastAutoSnapshotAt")){
    exec("ALTER TABLE cases ADD COLUMN lastAutoSnapshotAt TEXT");
  }
  _saveDb();
}

export function updateCaseAutoSnapshot({ caseId, enabled, intervalHours } = {}){
  const id = Number(caseId);
  if (!Number.isFinite(id)) throw new Error("Invalid caseId");
  const existing = one("SELECT * FROM cases WHERE id=?", [id]);
  if (!existing) throw new Error("Case not found");
  const en = enabled != null ? (enabled ? 1 : 0) : existing.autoSnapshotEnabled;
  const ih = intervalHours != null ? Math.max(1, Math.min(168, Number(intervalHours))) : existing.autoSnapshotIntervalHours;
  exec(
    "UPDATE cases SET autoSnapshotEnabled=?, autoSnapshotIntervalHours=?, updatedAt=? WHERE id=?",
    [en, ih, nowIso(), id]
  );
  _saveDb();
  return { ok: true };
}

export function getCasesDueForAutoSnapshot(){
  const now = new Date().toISOString();
  return all(
    `SELECT id, title, autoSnapshotIntervalHours, lastAutoSnapshotAt
     FROM cases
     WHERE status='open'
       AND autoSnapshotEnabled=1
       AND (
         lastAutoSnapshotAt IS NULL
         OR datetime(lastAutoSnapshotAt, '+' || autoSnapshotIntervalHours || ' hours') <= datetime(?)
       )`,
    [now]
  );
}

export function markCaseAutoSnapshotTaken(caseId){
  exec("UPDATE cases SET lastAutoSnapshotAt=? WHERE id=?", [nowIso(), Number(caseId)]);
  _saveDb();
}
