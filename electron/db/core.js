/**
 * electron/db/core.js
 *
 * The shared SQLite foundation — db handle, safety state, and the raw
 * exec/all/one query primitives. Every other services module imports from here.
 *
 * Nothing in this file calls back into services.js.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3");

// ── Database handle ───────────────────────────────────────────────────────────

let _db     = null;
let _dbPath = null;

export function getDb()    { return _db; }
export function getDbPath(){ return _dbPath; }
export function setDb(instance){ _db = instance; }
export function setDbPath(p)   { _dbPath = p; }

// ── Safety state ──────────────────────────────────────────────────────────────

export const dbState = {
  readOnly:            false,
  degraded:            false,
  lastError:           null,
  lastSaveAt:          null,
  lastBackupAt:        null,
  lastRecoveryWriteAt: null,
  lastRecoveryPath:    null,
};

// ── Shared utilities ──────────────────────────────────────────────────────────

export function nowIso(){ return new Date().toISOString(); }
export function lower(s){ return String(s || "").trim().toLowerCase(); }

// ── Game data cache ───────────────────────────────────────────────────────────

export const GAME_DATA_URL      = "https://query.idleclans.com/api/Configuration/game-data";
export const GAME_DATA_FILENAME = "idleclans-game-data.json";

export const gameDataCache = {
  ok:        false,
  path:      "",
  updatedAt: null,
  itemCount: 0,
  itemsById: {},
  enrichedById: {},
  holidayEvents: [],
  error:     null,
};

// ── Query primitives ──────────────────────────────────────────────────────────

function _normParams(params){
  return (params || []).map(v => {
    if (v === undefined) return null;
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    return v;
  });
}

// Corruption error codes from better-sqlite3 / SQLite
const CORRUPT_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB", "SQLITE_IOERR"]);

function _handleQueryError(e){
  if (CORRUPT_CODES.has(e?.code) && !dbState.degraded){
    dbState.degraded  = true;
    dbState.readOnly  = true;
    dbState.lastError = `Database corruption detected (${e.code}): ${e.message}. Writes disabled to protect data. Restore from a backup in the backups/ folder.`;
    console.error("[db] CORRUPTION DETECTED — degraded mode active:", e.message);
  }
  throw e;
}

export function exec(sql, params = []){
  try{ _db.prepare(sql).run(_normParams(params)); }
  catch(e){ _handleQueryError(e); }
}

export function all(sql, params = []){
  try{ return _db.prepare(sql).all(_normParams(params)); }
  catch(e){ _handleQueryError(e); }
}

export function one(sql, params = []){
  try{ return _db.prepare(sql).get(_normParams(params)) || null; }
  catch(e){ _handleQueryError(e); }
}
