import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import streamJson from "stream-json";
import Pick from "stream-json/filters/Pick.js";
import StreamArray from "stream-json/streamers/StreamArray.js";
import StreamObject from "stream-json/streamers/StreamObject.js";
import { xpToLevel } from "./lib/xp.js";
import {
  shouldSkipRecovery,
  parseVaultEventMessage,
  csvEscape,
  rankLabel,
  buildMentionRegex,
  extractChatBody,
} from "./utils.js";

// ── Shared DB primitives (extracted to db/core.js) ────────────────────────────
import {
  getDb, getDbPath,
  setDb, setDbPath,
  dbState,
  nowIso, lower,
  GAME_DATA_URL, GAME_DATA_FILENAME, gameDataCache,
  exec, all, one,
} from "./db/core.js";

// Re-export primitives that are used externally via services.js
export { nowIso, lower };

// ── API client primitives (extracted to api/client.js) ────────────────────────
import {
  API_BASE as _API_BASE,
  API_STARTUP_INFO as _API_STARTUP_INFO,
  fetchJwks,
  decodeJwt,
  p1363ToDer,
  verifyJwtSignature,
  abortError,
  sleep,
  sleepMs,
  parseRetryAfterMs,
  isTransientFetchError,
  apiGetJson as _apiGetJson,
  apiGetJsonAllow404 as _apiGetJsonAllow404,
} from "./api/client.js";

// Keep API_BASE and API_STARTUP_INFO accessible within this file
const API_BASE         = _API_BASE;
const API_STARTUP_INFO = _API_STARTUP_INFO;

// Wrappers that inject rateLimit so api/client.js stays free of settings deps
function apiGetJson(url, opts = {}){
  return _apiGetJson(url, { ...opts, rateLimitFn: rateLimit });
}
function apiGetJsonAllow404(url, opts = {}){
  return _apiGetJsonAllow404(url, { ...opts, rateLimitFn: rateLimit });
}

// ── Shared helper functions (extracted to shared/helpers.js) ──────────────────
import {
  initHelpers,
  normaliseEquipment,
  log,
  ensureClanGameMode,
  upsertPlayerBasic,
  upsertClanBasic,
  upsertClanMembers,
  insertAlert,
  isTrackedEnabled,
  alertsEnabled,
  alertsOnlyTracked,
  getAlertInactiveDays,
  joinLeaveAlertsEnabled,
  insertPresenceSample,
  maybeAlertPlayerInactivity,
  markBulkScanned,
  wasBulkScanned,
} from "./shared/helpers.js";
import { initMarket,
  fetchLatestNews as _fetchLatestNews,
  listNews as _listNews,
  fetchMarketPrices as _fetchMarketPrices,
  getMarketSnapshot as _getMarketSnapshot,
  getMarketPriceChanges as _getMarketPriceChanges,
  getMarketTopVolume as _getMarketTopVolume,
  getMarketHistory   as _getMarketHistory,
} from "./services/market.js";

import { initAccounts,
  verifyAccountToken as _verifyAccountToken,
  listVerifiedAccounts as _listVerifiedAccounts,
  removeVerifiedAccount as _removeVerifiedAccount,
  getFirstLinkedAccount as _getFirstLinkedAccount,
  snapshotAccountSkills as _snapshotAccountSkills,
  getAccountSkillHistory as _getAccountSkillHistory,
  getAccountSkillLatest as _getAccountSkillLatest,
  pruneAccountSkillHistory as _pruneAccountSkillHistory,
} from "./services/accounts.js";

import { initCases,
  createCase as _createCase,
  listCases as _listCases,
  getCase as _getCase,
  updateCase as _updateCase,
  deleteCase as _deleteCase,
  addCaseNote as _addCaseNote,
  attachCaseEntity as _attachCaseEntity,
  detachCaseEntity as _detachCaseEntity,
  addCaseSnapshot as _addCaseSnapshot,
  getCaseSnapshot as _getCaseSnapshot,
  migrateCaseAutoSnapshotColumns as _migrateCaseAutoSnapshotColumns,
  updateCaseAutoSnapshot as _updateCaseAutoSnapshot,
  getCasesDueForAutoSnapshot as _getCasesDueForAutoSnapshot,
  markCaseAutoSnapshotTaken as _markCaseAutoSnapshotTaken,
} from "./services/cases.js";

// ── Phase 3b: players, clans, logs ────────────────────────────────────────────
import { initLogs,
  insertLogs as _insertLogs,
  recheckNotFoundEntity as _recheckNotFoundEntity,
} from "./api/logs.js";

import { initPlayers,
  upsertPlayerFromApi as _upsertPlayerFromApi,
  lookupPlayerLive as _lookupPlayerLive,
  previewPlayerLive as _previewPlayerLive,
  listPlayers as _listPlayers,
  listPlayersWithEquipment as _listPlayersWithEquipment,
  getPlayersWithItem as _getPlayersWithItem,
  getTaskActivitySummary as _getTaskActivitySummary,
  getPlayersByTask as _getPlayersByTask,
  getPlayer as _getPlayer,
  getAllPlayerNames as _getAllPlayerNames,
  setPlayerBanned as _setPlayerBanned,
  banClanMembers as _banClanMembers,
  flagClanMembers as _flagClanMembers,
  listBannedPlayers as _listBannedPlayers,
  listNotFoundEntities as _listNotFoundEntities,
  clearNotFoundEntity as _clearNotFoundEntity,
  listDormantPlayers as _listDormantPlayers,
  clearDormantPlayer as _clearDormantPlayer,
  recheckDormantPlayer as _recheckDormantPlayer,
  listFlaggedPlayers as _listFlaggedPlayers,
  getPlayersClanMap as _getPlayersClanMap,
} from "./services/players.js";

import { initClans,
  upsertClanFromApi as _upsertClanFromApi,
  lookupClanLive as _lookupClanLive,
  previewClanLive as _previewClanLive,
  listClans as _listClans,
  getClan as _getClan,
  getAllClanNames as _getAllClanNames,
  listFlaggedClans as _listFlaggedClans,
  listClanSkillSignals as _listClanSkillSignals,
  listPotentialClans as _listPotentialClans,
  getClansWithNameClusters as _getClansWithNameClusters,
  getCrossClanMatches as _getCrossClanMatches,
} from "./services/clans.js";

// ── Phase 3c: pvm, chat ───────────────────────────────────────────────────────
import { initPvm,
  maybeSnapshotPvmForPlayer as _maybeSnapshotPvmForPlayer,
  takePvmSnapshotNow as _takePvmSnapshotNow,
  prunePvmSamples as _prunePvmSamples,
  recordPvmSampleForPlayer as _recordPvmSampleForPlayer,
  getPvmSnapshotStatus as _getPvmSnapshotStatus,
  getPvmSampleStats as _getPvmSampleStats,
  getPvmRollingDelta as _getPvmRollingDelta,
  getPvmCorrelationRolling as _getPvmCorrelationRolling,
  getPvmCorrelation as _getPvmCorrelation,
  fetchClanPvmProfile as _fetchClanPvmProfile,
  getClanPvmSnapshot as _getClanPvmSnapshot,
  fetchPlayerPvmProfile as _fetchPlayerPvmProfile,
  fetchPlayerPvmProfileAuto as _fetchPlayerPvmProfileAuto,
  getPlayerPvmLeaderboardSnapshot as _getPlayerPvmLeaderboardSnapshot,
} from "./services/pvm.js";

import { initChat,
  setChatMentionCallback as _setChatMentionCallback,
  setChatKeywords as _setChatKeywords,
  setChatIgnoredChannels as _setChatIgnoredChannels,
  getChatScanStatus as _getChatScanStatus,
  getRecentChat as _getRecentChat,
  getChatMessages as _getChatMessages,
  getChatMessagesAroundId as _getChatMessagesAroundId,
  getChatMessagesForPlayer as _getChatMessagesForPlayer,
  searchChatMessages as _searchChatMessages,
  getChatMessagesGlobal as _getChatMessagesGlobal,
  getChatCategories as _getChatCategories,
  getChatMessageCounts as _getChatMessageCounts,
  startChatScan as _startChatScan,
  stopChatScan as _stopChatScan,
} from "./services/chat.js";
const { parser } = streamJson;

const require = createRequire(import.meta.url);
// better-sqlite3 is a CommonJS native module; import via require() in an ESM project.
const BetterSqlite3 = require("better-sqlite3");

// dbState, exec, all, one, nowIso, lower, gameDataCache imported from ./db/core.js
// db and dbPath are kept as local variables here; setDb/setDbPath keep db/core.js in sync

let db     = null;
let dbPath = null;

function safeStat(p){
  try{ return fs.statSync(p); }catch{ return null; }
}

function resolveBackupDir(currentDbPath){
  // If a custom dir is set in settings, use it; otherwise default to ./backups/
  try{
    const s = getSettings();
    const custom = String(s.backupsCustomDir || "").trim();
    if (custom) return custom;
  }catch(e){ console.warn("[services] resolveBackupDir: failed to read settings", e?.message); }
  return path.join(path.dirname(currentDbPath), "backups");
}

function ensureBackupDir(currentDbPath){
  const dir = resolveBackupDir(currentDbPath);
  try{ fs.mkdirSync(dir, { recursive: true }); }catch{}
  return dir;
}

function rotateNumberedBackups(currentDbPath, keep=3, preResolvedDir=null){
  const bdir = preResolvedDir || ensureBackupDir(currentDbPath);
  try{ fs.mkdirSync(bdir, { recursive: true }); }catch{}
  const baseName = path.basename(currentDbPath).replace(/\.sqlite$/i, '');
  const oldest = path.join(bdir, `${baseName}.backup.${keep}.sqlite`);
  try{ if (fs.existsSync(oldest)) fs.unlinkSync(oldest); }catch{}
  for (let i=keep-1; i>=1; i--){
    const src = path.join(bdir, `${baseName}.backup.${i}.sqlite`);
    const dst = path.join(bdir, `${baseName}.backup.${i+1}.sqlite`);
    try{ if (fs.existsSync(src)) fs.renameSync(src, dst); }catch{}
  }
  const dst1 = path.join(bdir, `${baseName}.backup.1.sqlite`);
  try{ fs.copyFileSync(currentDbPath, dst1); dbState.lastBackupAt = nowIso(); }catch{}
}

function maintainDailyBackups(currentDbPath, keepDays=3, preResolvedDir=null){
  const bdir = preResolvedDir || ensureBackupDir(currentDbPath);
  try{ fs.mkdirSync(bdir, { recursive: true }); }catch{}
  const baseName = path.basename(currentDbPath).replace(/\.sqlite$/i, '');
  const day = new Date();
  const y = day.getFullYear();
  const m = String(day.getMonth()+1).padStart(2,'0');
  const d = String(day.getDate()).padStart(2,'0');
  const stamp = `${y}-${m}-${d}`;
  const dailyPath = path.join(bdir, `${baseName}.${stamp}.sqlite`);
  if (!fs.existsSync(dailyPath)){
    try{ fs.copyFileSync(currentDbPath, dailyPath); }catch{}
  }
  // prune older daily backups
  try{
    const files = fs.readdirSync(bdir)
      .filter(f => f.startsWith(baseName + '.') && f.endsWith('.sqlite') && f.includes('-'))
      .map(f => ({ p: path.join(bdir, f), t: (safeStat(path.join(bdir,f))?.mtimeMs || 0) }))
      .sort((a,b) => b.t - a.t);
    for (let i=keepDays; i<files.length; i++){
      try{ fs.unlinkSync(files[i].p); }catch{}
    }
  }catch{}
}

function atomicReplaceFile(targetPath, buffer){
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.tmp-${path.basename(targetPath)}-${Date.now()}`);
  const oldPath = targetPath + '.old';
  fs.writeFileSync(tmpPath, buffer);
  try{ if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); }catch{}
  if (fs.existsSync(targetPath)){
    // keep .old around until new file is in place
    fs.renameSync(targetPath, oldPath);
  }
  fs.renameSync(tmpPath, targetPath);
  try{ if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); }catch{}
}

// shouldSkipRecovery imported from ./utils.js

// gameDataCache imported from ./db/core.js

// nowIso, lower, GAME_DATA_URL, GAME_DATA_FILENAME, gameDataCache imported from ./db/core.js

let dbPathOverride = null;
export function setDbPathOverride(p){
  const s = String(p || "").trim();
  dbPathOverride = s ? s : null;
}

function getDefaultDbPath(){
  if (dbPathOverride && typeof dbPathOverride === "string") return dbPathOverride;
  if (!app.isPackaged) return path.join(process.cwd(), "idleclans-desktop.sqlite");
  // PORTABLE_EXECUTABLE_DIR is set by electron-builder for portable EXEs —
  // points to the real EXE folder, not the temp extraction dir.
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) return path.join(portableDir, "idleclans-desktop.sqlite");
  return path.join(path.dirname(process.execPath), "idleclans-desktop.sqlite");
}

export function saveDb({ forceBackup=false } = {}){
  // With better-sqlite3, writes are persisted incrementally.
  // We keep this function as a throttled checkpoint + backup hook so callers don't need to change.
  if (!db || !dbPath) return;
  if (dbState.readOnly) return;

  // WAL keeps large write bursts fast. Periodically checkpoint to keep the main file consistent.
  try{ db.pragma("wal_checkpoint(TRUNCATE)"); }catch{}
  dbState.lastSaveAt = nowIso();

  const st = safeStat(dbPath);
  if (!st || st.size <= 0) return;

  // Honour backupsEnabled setting
  try{
    const s = getSettings();
    if (String(s.backupsEnabled ?? "1") === "0" && !forceBackup) return;
  }catch(e){ console.warn("[services] saveDb: failed to read backup settings", e?.message); }

  // Throttle backups to avoid heavy disk work during bulk scans.
  const last = dbState.lastBackupAt ? Date.parse(dbState.lastBackupAt) : 0;
  const ageMs = Date.now() - (Number.isFinite(last) ? last : 0);
  const shouldBackup = forceBackup || ageMs > 10 * 60 * 1000; // 10 minutes
  if (!shouldBackup) return;

  try{
    const s2 = getSettings();
    const keepN = Math.max(1, Math.min(10, Number(s2.backupsKeepNumbered ?? 3) || 3));
    const keepD = Math.max(0, Math.min(30, Number(s2.backupsKeepDays ?? 3) || 3));
    rotateNumberedBackups(dbPath, keepN);
    if (keepD > 0) maintainDailyBackups(dbPath, keepD);
    dbState.lastBackupAt = nowIso();
  }catch(e){ console.warn("[services] saveDb: backup rotation failed", e?.message); }
}

function validateDbLight(){
  // Sanity check: ensure core tables exist and a simple query runs.
  // We intentionally do NOT run quick_check here — on a large corrupt DB it
  // scans the entire file and can hang for minutes. Instead we rely on the
  // SQLITE_CORRUPT code thrown by actual queries (caught in _handleQueryError)
  // to detect corruption at runtime without blocking startup.
  try{
    const r = one("SELECT name FROM sqlite_master WHERE type='table' AND name='players'");
    if (!r) return false;
    one("SELECT COUNT(*) AS n FROM players");
    return true;
  }catch(e){
    console.error("[services] validateDbLight error:", e?.message);
    return false;
  }
}

// _normParams, exec, all, one imported from ./db/core.js

function ensureColumn(table, column, type){
  // sql.js runs SQLite; ADD COLUMN has no IF NOT EXISTS. We detect via PRAGMA.
  try{
    const cols = all(`PRAGMA table_info(${table})`);
    const has = cols.some(c => String(c.name).toLowerCase() === String(column).toLowerCase());
    if (has) return;
    exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }catch{
    // ignore (table might not exist yet during first boot)
  }
}

async function ensureSchema(){
  exec(`CREATE TABLE IF NOT EXISTS players(
    lowerName TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    gameMode TEXT,
    guildName TEXT,
    profileJson TEXT,
    updatedAt TEXT,
    bannedAt TEXT
  );`);

  exec(`CREATE TABLE IF NOT EXISTS clans(
    lowerName TEXT PRIMARY KEY,
    clanName TEXT NOT NULL,
    gameMode TEXT,
    tag TEXT,
    dataJson TEXT,
    updatedAt TEXT
  );`);

  // In-place migrations for existing DB files (sql.js/SQLite doesn't support ADD COLUMN IF NOT EXISTS)
  ensureColumn("players", "gameMode", "TEXT");
  ensureColumn("players", "createdAt", "TEXT");
  ensureColumn("clans", "gameMode", "TEXT");
  ensureColumn("clans", "createdAt", "TEXT");

  exec(`CREATE TABLE IF NOT EXISTS clan_members(
    clanLower TEXT NOT NULL,
    memberLower TEXT NOT NULL,
    memberName TEXT NOT NULL,
    rank INTEGER,
    hoursOffline REAL,
    lastScannedAt TEXT,
    lastUpdatedAt TEXT,
    PRIMARY KEY (clanLower, memberLower)
  );`);

  
  // Server population samples (for homepage history + all-time high)
  exec(`CREATE TABLE IF NOT EXISTS server_population_samples(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sampledAt INTEGER NOT NULL,
    totalPlayers INTEGER NOT NULL,
    rawJson TEXT
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_server_population_samples_sampledAt ON server_population_samples(sampledAt);`);

exec(`CREATE TABLE IF NOT EXISTS logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entityType TEXT NOT NULL,
    entityLower TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    rawJson TEXT
  );`);

  exec(`CREATE TABLE IF NOT EXISTS chat_messages(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    senderLower TEXT NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    premium INTEGER,
    gilded INTEGER,
    gameMode INTEGER,
    isModerator INTEGER,
    receivedAt TEXT NOT NULL,
    rawJson TEXT
  );`);

  // Prevent duplicate chat messages across refreshes
  exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_unique ON chat_messages(category, timestamp, senderLower, message);`);
  exec(`CREATE INDEX IF NOT EXISTS idx_chat_cat_time ON chat_messages(category, timestamp);`);

  // Chat-derived player flags (Premium/Gilded/Moderator). Chat is currently the only source for these.
  exec(`CREATE TABLE IF NOT EXISTS player_chat_flags(
    lowerName TEXT PRIMARY KEY,
    premium INTEGER,
    gilded INTEGER,
    moderator INTEGER,
    lastSeenAt TEXT,
    updatedAt TEXT
  );`);


  // Prevent duplicate log spam when we re-fetch the same logs (important for backdating).
  // If the user already has duplicates from an older build, we must dedupe BEFORE creating the unique index,
  // otherwise SQLite will throw UNIQUE constraint failed during app boot.
  exec(`
      DELETE FROM logs
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM logs
        GROUP BY entityType, entityLower, timestamp, message
      );
  `);

  exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_unique
        ON logs(entityType, entityLower, timestamp, message);`);

  exec(`CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT
  );`);

  exec(`CREATE TABLE IF NOT EXISTS tracked(
    entityType TEXT NOT NULL,
    entityLower TEXT NOT NULL,
    entityName TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    intervalMinutes INTEGER,
    nextRunAt TEXT,
    PRIMARY KEY (entityType, entityLower)
  );`);

  exec(`CREATE TABLE IF NOT EXISTS pvm_snapshots(
    playerLower TEXT NOT NULL,
    playerName TEXT NOT NULL,
    gameMode TEXT NOT NULL,
    dayKey TEXT NOT NULL,
    takenAt TEXT NOT NULL,
    clanName TEXT,
    pvmJson TEXT NOT NULL,
    PRIMARY KEY(playerLower, gameMode, dayKey)
  );`);

  exec(`CREATE TABLE IF NOT EXISTS pvm_samples(
    playerLower TEXT NOT NULL,
    playerName TEXT NOT NULL,
    gameMode TEXT NOT NULL,
    takenAt TEXT NOT NULL,
    clanName TEXT,
    pvmJson TEXT NOT NULL
  );`);

  exec("CREATE INDEX IF NOT EXISTS idx_pvm_samples_player_time ON pvm_samples(playerLower, gameMode, takenAt)");

  // Clan PvM leaderboard snapshots (clans:default profile endpoint)
  exec(`CREATE TABLE IF NOT EXISTS clan_pvm_snapshots(
    clanLower TEXT NOT NULL,
    clanName  TEXT NOT NULL,
    takenAt   TEXT NOT NULL,
    pvmJson   TEXT NOT NULL,
    PRIMARY KEY(clanLower)
  );`);

  // Player PvM leaderboard snapshots (players:{gameMode} profile endpoint).
  // Mirrors clan_pvm_snapshots but keyed by player + game mode, since the
  // same player name can exist across default/ironman/groupironman boards
  // with different boss scores.
  exec(`CREATE TABLE IF NOT EXISTS player_pvm_leaderboard_snapshots(
    playerLower TEXT NOT NULL,
    playerName  TEXT NOT NULL,
    gameMode    TEXT NOT NULL,
    takenAt     TEXT NOT NULL,
    pvmJson     TEXT NOT NULL,
    PRIMARY KEY(playerLower, gameMode)
  );`);

  exec(`CREATE TABLE IF NOT EXISTS player_clan_history(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playerLower TEXT NOT NULL,
    fromClan TEXT,
    toClan TEXT,
    timestamp TEXT NOT NULL,
    source TEXT
  );`);

  // Avoid duplicate history rows when importing/backfilling from logs repeatedly.
  // Dedupe first to keep boot safe if an older build inserted duplicates.
  exec(`
      DELETE FROM player_clan_history
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM player_clan_history
        GROUP BY playerLower, COALESCE(fromClan,''), COALESCE(toClan,''), timestamp, COALESCE(source,'')
      );
  `);

  exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_player_clan_history_unique
        ON player_clan_history(playerLower, COALESCE(fromClan,''), COALESCE(toClan,''), timestamp, COALESCE(source,''));`);

  // Presence samples (for "last online" heatmaps).
  exec(`CREATE TABLE IF NOT EXISTS presence_samples(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playerLower TEXT NOT NULL,
    scannedAt TEXT NOT NULL,
    hoursOffline REAL,
    lastOnlineAt TEXT,
    source TEXT
  );`);

  // Keep samples idempotent: one sample per player per scan time.
  exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_samples_unique
        ON presence_samples(playerLower, scannedAt);`);

  // Alerts generated from scans (inactivity, join/leave, etc.)
  exec(`CREATE TABLE IF NOT EXISTS alerts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    createdAt TEXT NOT NULL,
    type TEXT NOT NULL,
    entityType TEXT NOT NULL,
    entityLower TEXT NOT NULL,
    entityName TEXT NOT NULL,
    severity TEXT,
    message TEXT NOT NULL,
    readAt TEXT
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_alerts_createdAt ON alerts(createdAt);`);
  exec(`CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entityType, entityLower);`);

  // Bulk scan markers (used by Home "Scan all" so it can resume without repeating work)
  exec(`CREATE TABLE IF NOT EXISTS bulk_scan_marks(
    entityType TEXT NOT NULL,
    entityLower TEXT NOT NULL,
    firstScannedAt TEXT NOT NULL,
    lastScannedAt TEXT NOT NULL,
    PRIMARY KEY(entityType, entityLower)
  );`);


// ------------------------------------------------------------------
// Leaderboards (offline cache + resumable scans)
// ------------------------------------------------------------------
exec(`CREATE TABLE IF NOT EXISTS leaderboard_cache(
  boardKey TEXT NOT NULL,
  rank INTEGER NOT NULL,
  nameLower TEXT NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  score REAL,
  expCapDate INTEGER,
  capturedAt TEXT NOT NULL,
  rawJson TEXT,
  PRIMARY KEY(boardKey, rank)
);`);
exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_board ON leaderboard_cache(boardKey, rank);`);
exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_name ON leaderboard_cache(boardKey, nameLower);`);
// Cross-board lookups (e.g. "show all leaderboard standings for player X")
// query by nameLower alone across every boardKey, so index it independently.
exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_namelower ON leaderboard_cache(nameLower);`);

exec(`CREATE TABLE IF NOT EXISTS leaderboard_scan_state(
  boardKey TEXT PRIMARY KEY,
  entityType TEXT NOT NULL,
  gameMode TEXT NOT NULL,
  category TEXT NOT NULL,
  nextStartCount INTEGER NOT NULL,
  nextMaxCount INTEGER NOT NULL,
  status TEXT NOT NULL,
  lastUpdatedAt TEXT,
  lastError TEXT,
  lastRank INTEGER,
  lastNameLower TEXT
);`);

// Persisted leaderboard scan jobs (allows stop/resume across app restarts)
exec(`CREATE TABLE IF NOT EXISTS leaderboard_jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  planJson TEXT NOT NULL,
  optionsJson TEXT NOT NULL,
  currentIndex INTEGER NOT NULL DEFAULT 0,
  currentBoardKey TEXT,
  currentLabel TEXT,
  lastError TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);`);
exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_jobs_status ON leaderboard_jobs(status, updatedAt);`);

  // ------------------------------------------------------------------
  // Leaderboard snapshots (frozen, coherent datasets for correlations)
  // ------------------------------------------------------------------
  exec(`CREATE TABLE IF NOT EXISTS leaderboard_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boardKey TEXT NOT NULL,
    title TEXT,
    createdAt TEXT NOT NULL,
    source TEXT,
    sourceJobId INTEGER,
    note TEXT,
    rowCount INTEGER NOT NULL DEFAULT 0
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_board ON leaderboard_snapshots(boardKey, createdAt);`);

  exec(`CREATE TABLE IF NOT EXISTS leaderboard_snapshot_rows(
    snapshotId INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    nameLower TEXT NOT NULL,
    name TEXT NOT NULL,
    level INTEGER,
    score REAL,
    expCapDate INTEGER,
    clanName TEXT,
    clanLower TEXT,
    clanSource TEXT,
    capturedAt TEXT NOT NULL,
    rawJson TEXT,
    PRIMARY KEY(snapshotId, rank)
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshot_rows_name ON leaderboard_snapshot_rows(snapshotId, nameLower);`);

  // migrations (older DBs)
  ensureColumn("leaderboard_snapshot_rows", "clanName", "TEXT");
  ensureColumn("leaderboard_snapshot_rows", "clanLower", "TEXT");
  ensureColumn("leaderboard_snapshot_rows", "clanSource", "TEXT");

  // ------------------------------------------------------------------
  // Leaderboard watches (scheduled board scans + optional snapshots)
  // ------------------------------------------------------------------
  exec(`CREATE TABLE IF NOT EXISTS leaderboard_watches(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boardKey TEXT NOT NULL,
    title TEXT,
    intervalMinutes INTEGER NOT NULL DEFAULT 10,
    enabled INTEGER NOT NULL DEFAULT 0,
    saveMode TEXT NOT NULL DEFAULT 'always', -- 'always' | 'ifChanged'
    retentionDays INTEGER,
    lastRunAt TEXT,
    nextRunAt TEXT,
    lastSignature TEXT,
    lastStatus TEXT,
    lastError TEXT,
    lastSnapshotId INTEGER,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_leaderboard_watches_due ON leaderboard_watches(enabled, nextRunAt);`);

  // ── Performance indexes for hot queries ─────────────────────────────────
  // players: bannedAt — used by getCounts, getAnalyticsSummary, listBannedPlayers
  exec(`CREATE INDEX IF NOT EXISTS idx_players_bannedAt  ON players(bannedAt) WHERE bannedAt IS NOT NULL;`);
  // players: updatedAt — used by getStaleEntities, getAnalyticsSummary scan-coverage counts
  exec(`CREATE INDEX IF NOT EXISTS idx_players_updatedAt ON players(updatedAt);`);
  // players: gameMode — used by getCounts GROUP BY gameMode
  exec(`CREATE INDEX IF NOT EXISTS idx_players_gameMode  ON players(gameMode);`);
  // players: (gameMode, guildName) — used by getCounts clansByMode COUNT(DISTINCT)
  exec(`CREATE INDEX IF NOT EXISTS idx_players_mode_guild ON players(gameMode, guildName);`);
  // players: guildName — used by clan membership lookups
  exec(`CREATE INDEX IF NOT EXISTS idx_players_guildName ON players(guildName) WHERE guildName IS NOT NULL;`);
  // players: notFoundAt — used by scan exclusion WHERE clauses
  // try/catch: column may not exist yet on older DBs; ensureColumn below adds it
  try{ exec(`CREATE INDEX IF NOT EXISTS idx_players_notFoundAt ON players(notFoundAt) WHERE notFoundAt IS NOT NULL;`); }catch{}
  // clans: updatedAt — used by getStaleEntities
  exec(`CREATE INDEX IF NOT EXISTS idx_clans_updatedAt   ON clans(updatedAt);`);
  // clans: notFoundAt
  try{ exec(`CREATE INDEX IF NOT EXISTS idx_clans_notFoundAt  ON clans(notFoundAt) WHERE notFoundAt IS NOT NULL;`); }catch{}
  // tracked: (entityType, enabled) — used by all tracked queries
  exec(`CREATE INDEX IF NOT EXISTS idx_tracked_type_enabled ON tracked(entityType, enabled);`);
  // tracked: (entityType, enabled, nextRunAt) — used by runOneDueTracked ORDER BY nextRunAt
  exec(`CREATE INDEX IF NOT EXISTS idx_tracked_due ON tracked(entityType, enabled, nextRunAt);`);
  // player_clan_history: timestamp — used by getAnalyticsSummary moves7/30/total
  exec(`CREATE INDEX IF NOT EXISTS idx_pch_timestamp ON player_clan_history(timestamp);`);
  // presence_samples: (playerLower, scannedAt) — used by getInactiveReport MAX(scannedAt) GROUP BY
  exec(`CREATE INDEX IF NOT EXISTS idx_presence_player_time ON presence_samples(playerLower, scannedAt);`);

  // migrations for older DBs
  ensureColumn("leaderboard_watches", "title", "TEXT");
  ensureColumn("leaderboard_watches", "intervalMinutes", "INTEGER");
  ensureColumn("leaderboard_watches", "enabled", "INTEGER");
  ensureColumn("leaderboard_watches", "saveMode", "TEXT");
  ensureColumn("leaderboard_watches", "retentionDays", "INTEGER");
  ensureColumn("leaderboard_watches", "lastRunAt", "TEXT");
  ensureColumn("leaderboard_watches", "nextRunAt", "TEXT");
  ensureColumn("leaderboard_watches", "lastSignature", "TEXT");
  ensureColumn("leaderboard_watches", "lastStatus", "TEXT");
  ensureColumn("leaderboard_watches", "lastError", "TEXT");
  ensureColumn("leaderboard_watches", "lastSnapshotId", "INTEGER");
  ensureColumn("leaderboard_watches", "createdAt", "TEXT");
  ensureColumn("leaderboard_watches", "updatedAt", "TEXT");

  // ------------------------------------------------------------------
  // Cross-clan name clusters (cached; used by Cross-Clan Matches page)
  // ------------------------------------------------------------------
  exec(`CREATE TABLE IF NOT EXISTS cross_clan_cache(
    cacheKey TEXT PRIMARY KEY,
    builtAt TEXT NOT NULL,
    buildParamsJson TEXT NOT NULL,
    clustersJson TEXT NOT NULL,
    statsJson TEXT NOT NULL
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_cross_clan_cache_builtAt ON cross_clan_cache(builtAt);`);

  // ------------------------------------------------------------------
  // Cases / dossiers (investigation snapshots + notes)
  // ------------------------------------------------------------------
  exec(`CREATE TABLE IF NOT EXISTS cases(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    summary TEXT
  );`);

  exec(`CREATE TABLE IF NOT EXISTS case_entities(
    caseId INTEGER NOT NULL,
    entityType TEXT NOT NULL,
    entityLower TEXT NOT NULL,
    entityName TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY(caseId, entityType, entityLower)
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_case_entities_caseId ON case_entities(caseId);`);

  exec(`CREATE TABLE IF NOT EXISTS case_notes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caseId INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    note TEXT NOT NULL
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_case_notes_caseId ON case_notes(caseId);`);

  exec(`CREATE TABLE IF NOT EXISTS case_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caseId INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT,
    dataJson TEXT NOT NULL
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_case_snapshots_caseId ON case_snapshots(caseId);`);

  // Safe migration: add auto-snapshot columns to existing cases tables
  // (no-ops on fresh DBs that get the columns via CREATE TABLE above in future runs)
  {
    const existingCols = all("PRAGMA table_info(cases)").map(r => r.name);
    if (!existingCols.includes("autoSnapshotEnabled"))
      exec("ALTER TABLE cases ADD COLUMN autoSnapshotEnabled INTEGER NOT NULL DEFAULT 0");
    if (!existingCols.includes("autoSnapshotIntervalHours"))
      exec("ALTER TABLE cases ADD COLUMN autoSnapshotIntervalHours INTEGER NOT NULL DEFAULT 24");
    if (!existingCols.includes("lastAutoSnapshotAt"))
      exec("ALTER TABLE cases ADD COLUMN lastAutoSnapshotAt TEXT");
  }

  // Game news — persisted locally so users can browse back through past items
  exec(`CREATE TABLE IF NOT EXISTS game_news(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    newsId TEXT UNIQUE,
    title TEXT,
    body TEXT,
    category TEXT,
    publishedAt TEXT,
    fetchedAt TEXT NOT NULL,
    rawJson TEXT
  );`);

  // Market prices — fetched from /api/PlayerMarket/items/prices/latest
  exec(`CREATE TABLE IF NOT EXISTS market_prices(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL,
    lowestSellPrice INTEGER,
    lowestPriceVolume INTEGER,
    highestBuyPrice INTEGER,
    highestPriceVolume INTEGER,
    dailyAveragePrice INTEGER,
    fetchedAt TEXT NOT NULL
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_mp_itemId   ON market_prices(itemId);`);
  exec(`CREATE INDEX IF NOT EXISTS idx_mp_fetchedAt ON market_prices(fetchedAt);`);

  // Verified player accounts — one-shot JWT proof, only username is stored
  exec(`CREATE TABLE IF NOT EXISTS verified_accounts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    lowerName TEXT NOT NULL UNIQUE,
    verifiedAt TEXT NOT NULL,
    tokenIssuer TEXT
  );`);

  // Skill progress snapshots for verified accounts
  exec(`CREATE TABLE IF NOT EXISTS account_skill_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lowerName TEXT NOT NULL,
    snappedAt TEXT NOT NULL,
    totalLevel INTEGER,
    totalXp REAL,
    skillsJson TEXT NOT NULL,
    pvmJson TEXT
  );`);
  exec(`CREATE INDEX IF NOT EXISTS idx_ass_lower ON account_skill_snapshots(lowerName);`);
  exec(`CREATE INDEX IF NOT EXISTS idx_ass_snapped ON account_skill_snapshots(snappedAt);`);
  ensureColumn("account_skill_snapshots", "pvmJson", "TEXT");

  // --- lightweight migrations (add missing columns) ---

  // market_prices: drop and recreate if any required column is missing.
  // This table is a pure API cache — safe to drop, data is re-fetched automatically.
  try{
    const mpCols = all("PRAGMA table_info(market_prices)").map(c => c.name);
    if (mpCols.length > 0){
      const required = ["lowestSellPrice","lowestPriceVolume","highestBuyPrice","highestPriceVolume","dailyAveragePrice"];
      const missing  = required.filter(c => !mpCols.includes(c));
      if (missing.length > 0){
        exec("DROP TABLE IF EXISTS market_prices");
        // Drop any index variant from previous builds
        for (const ix of ["idx_mp_itemId","idx_mp_fetchedAt","idx_market_prices_itemId","idx_market_prices_fetchedAt"]){
          try{ exec(`DROP INDEX IF EXISTS ${ix}`); }catch{}
        }
        exec(`CREATE TABLE market_prices(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          itemId INTEGER NOT NULL,
          lowestSellPrice INTEGER,
          lowestPriceVolume INTEGER,
          highestBuyPrice INTEGER,
          highestPriceVolume INTEGER,
          dailyAveragePrice INTEGER,
          fetchedAt TEXT NOT NULL
        );`);
        exec("CREATE INDEX IF NOT EXISTS idx_mp_itemId    ON market_prices(itemId);");
        exec("CREATE INDEX IF NOT EXISTS idx_mp_fetchedAt ON market_prices(fetchedAt);");
      }
    }
  }catch(e){ /* fresh install has correct schema from CREATE TABLE IF NOT EXISTS above */ }

  try{
    const cols = all("PRAGMA table_info(players)");
    const hasBannedAt = cols.some(c => String(c.name) === "bannedAt");
    if (!hasBannedAt){
      exec("ALTER TABLE players ADD COLUMN bannedAt TEXT");
    }
  } catch (e){
    // ignore migration failures; schema may already be up to date
  }

  // notFoundAt: marks players/clans that returned 404 from the API (deleted/renamed)
  ensureColumn("players", "notFoundAt", "TEXT");
  ensureColumn("clans",   "notFoundAt", "TEXT");
  // Now that the column is guaranteed to exist, ensure the indexes are built
  try{ exec(`CREATE INDEX IF NOT EXISTS idx_players_notFoundAt ON players(notFoundAt) WHERE notFoundAt IS NOT NULL;`); }catch{}
  try{ exec(`CREATE INDEX IF NOT EXISTS idx_clans_notFoundAt   ON clans(notFoundAt)   WHERE notFoundAt IS NOT NULL;`); }catch{}
  // dormantAt: marks players who have been offline for >= dormantThresholdDays.
  // They are excluded from automatic scans but can be re-checked manually.
  ensureColumn("players", "dormantAt", "TEXT");
  // Index must come AFTER ensureColumn so the column exists on existing DBs
  try{ exec(`CREATE INDEX IF NOT EXISTS idx_players_dormantAt ON players(dormantAt) WHERE dormantAt IS NOT NULL;`); }catch{}

  // leaderboardStandingsJson: a snapshot of this entity's cached leaderboard
  // rank/level/score per board, refreshed automatically whenever a
  // leaderboard scan covering this entity completes. Kept as a separate
  // column (rather than merged into profileJson/dataJson) so it survives
  // full profile re-fetches, which overwrite profileJson/dataJson wholesale.
  ensureColumn("players", "leaderboardStandingsJson", "TEXT");
  ensureColumn("players", "leaderboardStandingsAt", "TEXT");
  ensureColumn("clans", "leaderboardStandingsJson", "TEXT");
  ensureColumn("clans", "leaderboardStandingsAt", "TEXT");

  // defaults
  if (!one("SELECT 1 as x FROM settings WHERE key='apiCallsPerMinute'")) setSetting({key:"apiCallsPerMinute", value:"15"});
  if (!one("SELECT 1 as x FROM settings WHERE key='trackIntervalMinutes'")) setSetting({key:"trackIntervalMinutes", value:"10"});
  if (!one("SELECT 1 as x FROM settings WHERE key='chatScanIntervalMinutes'")) setSetting({key:"chatScanIntervalMinutes", value:"2"});
  if (!one("SELECT 1 as x FROM settings WHERE key='dormantThresholdDays'")) setSetting({key:"dormantThresholdDays", value:"14"});
  if (!one("SELECT 1 as x FROM settings WHERE key='accountSnapshotHours'")) setSetting({key:"accountSnapshotHours", value:"6"});
  if (!one("SELECT 1 as x FROM settings WHERE key='pvmSnapshotTime'")) setSetting({key:"pvmSnapshotTime", value:"02:00"});
  if (!one("SELECT 1 as x FROM settings WHERE key='pvmSampleRetentionDays'")) setSetting({key:"pvmSampleRetentionDays", value:"14"});
  if (!one("SELECT 1 as x FROM settings WHERE key='alertsEnabled'")) setSetting({key:"alertsEnabled", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='alertInactiveDays'")) setSetting({key:"alertInactiveDays", value:"7"});
  if (!one("SELECT 1 as x FROM settings WHERE key='alertJoinLeaveEnabled'")) setSetting({key:"alertJoinLeaveEnabled", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='alertsOnlyTracked'")) setSetting({key:"alertsOnlyTracked", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='marketPollMinutes'")) setSetting({key:"marketPollMinutes", value:"15"});
  if (!one("SELECT 1 as x FROM settings WHERE key='marketAlertPct'"))    setSetting({key:"marketAlertPct",    value:"0"});
  if (!one("SELECT 1 as x FROM settings WHERE key='mentionAlertDurationSecs'")) setSetting({key:"mentionAlertDurationSecs", value:"12"});
  if (!one("SELECT 1 as x FROM settings WHERE key='gameDataAutoUpdate'")) setSetting({key:"gameDataAutoUpdate", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='gameDataMaxAgeDays'")) setSetting({key:"gameDataMaxAgeDays", value:"7"});

  // Auto-refresh stale players/clans
  if (!one("SELECT 1 as x FROM settings WHERE key='autoRefreshStaleEnabled'")) setSetting({key:"autoRefreshStaleEnabled", value:"0"});
  if (!one("SELECT 1 as x FROM settings WHERE key='autoRefreshStaleDays'")) setSetting({key:"autoRefreshStaleDays", value:"7"});
  if (!one("SELECT 1 as x FROM settings WHERE key='autoRefreshWaveSize'")) setSetting({key:"autoRefreshWaveSize", value:"100"});
  if (!one("SELECT 1 as x FROM settings WHERE key='autoRefreshIntervalMinutes'")) setSetting({key:"autoRefreshIntervalMinutes", value:"30"});

  // homepage server status
  if (!one("SELECT 1 as x FROM settings WHERE key='serverInfoEnabled'")) setSetting({key:"serverInfoEnabled", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='serverInfoPollSeconds'")) setSetting({key:"serverInfoPollSeconds", value:"60"});
  // New: show/hide server IPs/addresses on the homepage (default hidden)
  if (!one("SELECT 1 as x FROM settings WHERE key='serverInfoShowAddresses'")) setSetting({key:"serverInfoShowAddresses", value:"0"});
  // Back-compat: older builds used a "mask" toggle. Keep the key around.
  if (!one("SELECT 1 as x FROM settings WHERE key='serverInfoMaskIp'")) setSetting({key:"serverInfoMaskIp", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='backupsEnabled'")) setSetting({key:"backupsEnabled", value:"1"});
  if (!one("SELECT 1 as x FROM settings WHERE key='backupsCustomDir'")) setSetting({key:"backupsCustomDir", value:""});
  if (!one("SELECT 1 as x FROM settings WHERE key='backupsKeepNumbered'")) setSetting({key:"backupsKeepNumbered", value:"3"});
  if (!one("SELECT 1 as x FROM settings WHERE key='backupsKeepDays'")) setSetting({key:"backupsKeepDays", value:"3"});
}

export async function initDb(){
  dbPath = getDefaultDbPath();
  setDbPath(dbPath);
  dbState.readOnly = false;
  dbState.degraded = false;
  dbState.lastError = null;

  const st = safeStat(dbPath);

  function _applyPragmas(instance){
    try{ instance.pragma("journal_mode = WAL"); }catch{}
    try{ instance.pragma("synchronous = NORMAL"); }catch{}
    try{ instance.pragma("temp_store = MEMORY"); }catch{}
    try{ instance.pragma("foreign_keys = ON"); }catch{}
    try{ instance.pragma("cache_size = -131072"); }catch{}
    try{ instance.pragma("mmap_size = 268435456"); }catch{}
  }

  // Attempt page-level recovery by opening the corrupt file and streaming good
  // pages to a fresh file via better-sqlite3's .backup() API.
  function _attemptRecovery(openError){
    const backupDir = path.join(path.dirname(dbPath), "backups");
    try{ fs.mkdirSync(backupDir, { recursive: true }); }catch{}

    // Archive the corrupt file before touching it.
    const corruptCopy = path.join(backupDir,
      `${path.basename(dbPath)}.corrupt.${Date.now()}.bak`);
    try{ fs.copyFileSync(dbPath, corruptCopy); }catch(ce){
      console.warn("[services] initDb recovery: could not archive corrupt file:", ce?.message);
    }

    // Use better-sqlite3's async .backup() with a progress callback so it
    // doesn't block the main process. We wrap it in a Promise with a 20s
    // timeout — if it stalls on a badly corrupt file we give up fast rather
    // than hanging the app indefinitely.
    return new Promise((resolve) => {
      let corruptDb = null;
      const recoveredPath = dbPath + ".recovered";
      const timer = setTimeout(() => {
        console.error("[services] _attemptRecovery: timed out after 20s, giving up");
        try{ corruptDb?.close(); }catch{}
        try{ fs.unlinkSync(recoveredPath); }catch{}
        resolve(false);
      }, 20000);

      try{
        corruptDb = new BetterSqlite3(dbPath);
        corruptDb.backup(recoveredPath, {
          progress({ totalPages, remainingPages }){
            // progress is called periodically; we just log it
            if (remainingPages % 1000 === 0){
              console.log(`[services] recovery: ${totalPages - remainingPages}/${totalPages} pages`);
            }
          }
        }).then(() => {
          clearTimeout(timer);
          try{ corruptDb?.close(); }catch{}
          try{
            atomicReplaceFile(dbPath, fs.readFileSync(recoveredPath));
            fs.unlinkSync(recoveredPath);
          }catch(we){
            console.error("[services] recovery: could not swap recovered file:", we?.message);
            resolve(false);
            return;
          }
          dbState.lastRecoveryWriteAt = nowIso();
          dbState.lastRecoveryPath    = dbPath;
          console.warn("[services] initDb: recovery succeeded — repaired file written to", dbPath,
                       "| corrupt copy archived at", corruptCopy);
          resolve(true);
        }).catch((re) => {
          clearTimeout(timer);
          try{ corruptDb?.close(); }catch{}
          try{ fs.unlinkSync(recoveredPath); }catch{}
          console.error("[services] initDb: recovery failed:", re?.message,
                        "| corrupt copy at:", corruptCopy, "| backups dir:", backupDir);
          dbState.lastRecoveryPath = backupDir;
          resolve(false);
        });
      }catch(openErr){
        clearTimeout(timer);
        try{ corruptDb?.close(); }catch{}
        console.error("[services] initDb: could not open corrupt DB for recovery:", openErr?.message);
        dbState.lastRecoveryPath = backupDir;
        resolve(false);
      }
    });
  }

  try{
    db = new BetterSqlite3(dbPath);
    setDb(db);
    _applyPragmas(db);
  }catch(e){
    const isCorrupt = e?.code === "SQLITE_CORRUPT" || e?.code === "SQLITE_NOTADB" || e?.code === "SQLITE_IOERR";

    if (isCorrupt && st && st.size > 0){
      console.error("[services] initDb: DB corrupt on open, attempting recovery. Error:", e?.message);
      const recovered = _attemptRecovery(e);
      if (recovered){
        try{
          db = new BetterSqlite3(dbPath);
          setDb(db);
          _applyPragmas(db);
          dbState.lastError = `DB was corrupt and has been auto-recovered. A copy of the corrupt file is in the backups/ folder. Please verify your data.`;
        }catch(e3){
          console.error("[services] initDb: recovered file also unreadable:", e3?.message);
          db = null;
        }
      }
    }

    // If db is still null after recovery attempt, try readonly then in-memory fallback.
    if (!db){
      try{
        db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
        setDb(db);
        dbState.readOnly = true;
        dbState.degraded = true;
        dbState.lastError = `Failed to open DB for writing at ${dbPath}: ${e?.message || e}. Opened in read-only mode. Check backups/ folder to restore data.`;
      }catch(e2){
        db = new BetterSqlite3(":memory:");
        setDb(db);
        _applyPragmas(db);
        dbState.readOnly = true;
        dbState.degraded = true;
        dbState.lastError = `Failed to open DB at ${dbPath}: ${e?.message || e}. Running in memory-only safe mode. Check backups/ folder to restore data.`;
      }
    }
  }

  await ensureSchema();
  try{ await loadGameDataFromDisk(); }catch(e){ console.warn("[services] initDb: failed to load game data from disk", e?.message); }

  // Run two cheap queries to probe for corruption that didn't prevent opening.
  // If the DB is corrupt, these will throw SQLITE_CORRUPT which _handleQueryError
  // catches and sets dbState.degraded. We then attempt recovery.
  // We do NOT run PRAGMA quick_check here — on a large corrupt DB it scans the
  // entire file and can hang for minutes, blocking the app from starting.
  if (!dbState.readOnly){
    try{
      const st2 = safeStat(dbPath);
      if (st2 && st2.size >= 1000000){
        // These will throw SQLITE_CORRUPT if pages are bad, setting dbState.degraded.
        validateDbLight();
      }
    }catch{}
  }

  if (dbState.degraded && !dbState.readOnly){
    console.error("[services] initDb: corruption detected via probe queries, attempting recovery...");
    try{ db.close(); }catch{}
    db = null;
    setDb(null);

    const recovered = await _attemptRecovery(new Error("probe queries failed"));
    if (recovered){
      try{
        db = new BetterSqlite3(dbPath);
        setDb(db);
        _applyPragmas(db);
        await ensureSchema();
        // Reset degraded — recovery succeeded, probe again to confirm
        dbState.degraded = false;
        dbState.readOnly = false;
        dbState.lastError = null;
        validateDbLight(); // will re-set degraded if still corrupt
        if (!dbState.degraded){
          dbState.lastError = `DB had corruption that was auto-recovered. A copy of the corrupt file is in the backups/ folder. Please verify your data.`;
          console.warn("[services] initDb: post-open recovery succeeded.");
        } else {
          throw new Error("still corrupt after recovery");
        }
      }catch(re){
        console.error("[services] initDb: post-open recovery failed:", re?.message);
        try{ if(db) db.close(); }catch{}
        db = new BetterSqlite3(":memory:");
        setDb(db);
        _applyPragmas(db);
        await ensureSchema();
        dbState.readOnly = true;
        dbState.degraded = true;
        dbState.lastError = `Database is corrupt and could not be recovered automatically. Running in memory-only safe mode. Restore from a backup in the backups/ folder.`;
      }
    } else {
      db = new BetterSqlite3(":memory:");
      setDb(db);
      _applyPragmas(db);
      await ensureSchema();
      dbState.readOnly = true;
      dbState.degraded = true;
      dbState.lastError = `Database is corrupt and recovery could not write a repaired file. Running in memory-only safe mode. Check backups/ folder to restore data.`;
    }
  }

  // Create an initial backup checkpoint on first boot of a non-trivial DB.
  if (st && st.size > 0){
    saveDb({ forceBackup: true });
  } else {
    saveDb();
  }

  // ── Initialise domain service modules with shared dependencies ────────────
  initHelpers({ getSettings });
  initMarket({ saveDb, apiGetJson });
  initAccounts({ saveDb });
  initCases({ saveDb });

  // Phase 3b — players, clans, logs (order matters: logs needs upsert functions)
  initPlayers({ saveDb, apiGetJson, apiGetJsonAllow404, getSettings, insertLogs: _insertLogs });
  initClans({ saveDb, apiGetJson, apiGetJsonAllow404, insertLogs: _insertLogs, upsertPlayerFromApi: _upsertPlayerFromApi });
  initLogs({ saveDb, apiGetJsonAllow404, upsertPlayerFromApi: _upsertPlayerFromApi, upsertClanFromApi: _upsertClanFromApi });

  // Phase 3c — pvm, chat
  initPvm({ saveDb, apiGetJsonAllow404, getSettings });
  initChat({ saveDb, apiGetJson, getSettings, listVerifiedAccounts: _listVerifiedAccounts, upsertPlayerFromApi: _upsertPlayerFromApi, log });
}

export async function pickBackupFolder(){
  const { dialog, BrowserWindow } = await import("electron");
  const win = BrowserWindow.getAllWindows()[0] || null;
  const r = await dialog.showOpenDialog(win, {
    title: "Select backup folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return { ok: true, path: r.filePaths[0] };
}

export function pruneBackups({ keepNumbered=3, keepDays=3 } = {}){
  if (!dbPath) return { ok:false, error:"DB not open" };
  const bdir = path.join(path.dirname(dbPath), "backups");
  if (!fs.existsSync(bdir)) return { ok:true, removed:0 };
  const baseName = path.basename(dbPath).replace(/\.sqlite$/i, "");
  let removed = 0;

  // Prune numbered backups beyond keepNumbered
  for (let i = keepNumbered + 1; i <= 20; i++){
    const f = path.join(bdir, `${baseName}.backup.${i}.sqlite`);
    if (fs.existsSync(f)){ try{ fs.unlinkSync(f); removed++; }catch{} }
  }

  // Prune daily backups — keep only the newest keepDays
  try{
    const dailies = fs.readdirSync(bdir)
      .filter(f => f.startsWith(baseName + ".") && f.endsWith(".sqlite") && /\.\d{4}-\d{2}-\d{2}\./.test(f))
      .map(f => ({ p: path.join(bdir, f), t: safeStat(path.join(bdir, f))?.mtimeMs || 0 }))
      .sort((a, b) => b.t - a.t);
    for (let i = keepDays; i < dailies.length; i++){
      try{ fs.unlinkSync(dailies[i].p); removed++; }catch{}
    }
  }catch{}

  return { ok:true, removed };
}

export function getDbInfo(){
  let sizeBytes = 0;
  try{ sizeBytes = fs.statSync(dbPath).size; }catch{}
  let backupsDir = null;
  let backupCount = 0;
  try{
    backupsDir = resolveBackupDir(dbPath);
    if (fs.existsSync(backupsDir)){
      backupCount = fs.readdirSync(backupsDir).filter(f=>/\.sqlite$/i.test(String(f||""))).length;
    }
  }catch{}
  return {
    path: dbPath,
    sizeBytes,
    backupsDir,
    backupCount,
    readOnly: dbState.readOnly,
    degraded: dbState.degraded,
    lastError: dbState.lastError,
    lastSaveAt: dbState.lastSaveAt,
    lastBackupAt: dbState.lastBackupAt,
    lastRecoveryWriteAt: dbState.lastRecoveryWriteAt,
    lastRecoveryPath: dbState.lastRecoveryPath,
  };
}

export function getStorageBreakdown(){
  if (!db) return { ok:false, error:"DB not initialized" };
  // Uses SQLite's dbstat virtual table (available in most builds) for per-table page sizes.
  // Falls back to row-count-only if dbstat is unavailable.
  try{
    const rows = db.prepare(`
      SELECT name as tableName,
             SUM(pgsize) as bytes,
             COUNT(*) as pages
      FROM dbstat
      GROUP BY name
      ORDER BY bytes DESC
    `).all();

    const filtered = rows.filter(r=>{
      const t = String(r.tableName||"");
      if (!t) return false;
      if (t.startsWith("sqlite_")) return false;
      if (t === "dbstat") return false;
      return true;
    });

    const tables = filtered.map(r=>{
      let count = null;
      try{ count = db.prepare(`SELECT COUNT(*) as c FROM "${r.tableName}"`).get()?.c ?? null; }catch{}
      return {
        table: r.tableName,
        bytes: Number(r.bytes||0),
        pages: Number(r.pages||0),
        rows: (count===null ? null : Number(count)),
      };
    });

    const totalBytes = tables.reduce((a,b)=>a + (b.bytes||0), 0);
    return { ok:true, totalBytes, tables };
  }catch(err){
    // Fallback: list tables + row counts. (No byte estimate)
    try{
      const tbls = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all().map(r=>r.name);

      const tables = tbls.map(t=>{
        let count = null;
        try{ count = db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get()?.c ?? null; }catch{}
        return { table: t, bytes: null, pages: null, rows: (count===null?null:Number(count)) };
      });

      return { ok:true, totalBytes: null, tables, warning: 'dbstat unavailable', error: String(err?.message||err) };
    }catch(err2){
      return { ok:false, error: String(err2?.message||err2) };
    }
  }
}


export function deleteAllData(){
  // Resolve the backup dir while the DB is still open so getSettings() works.
  const backupDir = resolveBackupDir(dbPath);
  try{ if (db) db.close(); }catch{}
  if (dbPath && fs.existsSync(dbPath)){
    // Safety: keep a backup before destructive reset.
    try{ rotateNumberedBackups(dbPath, 3, backupDir); maintainDailyBackups(dbPath, 7, backupDir); }catch{}
    try{ fs.unlinkSync(dbPath); }catch{}
    // If WAL mode is enabled, these companion files may exist.
    try{ fs.unlinkSync(dbPath + "-wal"); }catch{}
    try{ fs.unlinkSync(dbPath + "-shm"); }catch{}
  }
  db = new BetterSqlite3(dbPath);
  setDb(db);
  try{ db.pragma("journal_mode = WAL"); }catch{}
  try{ db.pragma("synchronous = NORMAL"); }catch{}
  ensureSchema();
  saveDb({ forceBackup: true });
  return { ok:true };
}

export function getCounts(){
  const p = one("SELECT COUNT(*) AS n FROM players")?.n || 0;
  const c = one("SELECT COUNT(*) AS n FROM clans")?.n || 0;
  // bannedAt index makes this fast
  const banned = one("SELECT COUNT(*) AS n FROM players WHERE bannedAt IS NOT NULL AND TRIM(bannedAt)<>''")?.n || 0;

  // gameMode index makes this fast
  const playersByMode = {};
  for (const r of all("SELECT COALESCE(gameMode,'unknown') AS gameMode, COUNT(*) AS n FROM players GROUP BY COALESCE(gameMode,'unknown')")){
    playersByMode[r.gameMode] = r.n;
  }

  // (gameMode, guildName) index makes this fast
  const clansByMode = {};
  for (const r of all(
    "SELECT COALESCE(gameMode,'unknown') AS gameMode, COUNT(DISTINCT LOWER(guildName)) AS n FROM players WHERE guildName IS NOT NULL AND TRIM(guildName)<>'' GROUP BY COALESCE(gameMode,'unknown')"
  )){
    clansByMode[r.gameMode] = r.n;
  }

  return { players: p, clans: c, bannedPlayers: banned, playersByMode, clansByMode };
}

// Lightweight version for the 10-second dashboard ticker — only re-reads
// the three numbers that can change without a full scan.
export function getCountsFast(){
  const players = one("SELECT COUNT(*) AS n FROM players")?.n || 0;
  const clans   = one("SELECT COUNT(*) AS n FROM clans")?.n   || 0;
  const banned  = one("SELECT COUNT(*) AS n FROM players WHERE bannedAt IS NOT NULL AND TRIM(bannedAt)<>''")?.n || 0;
  return { players, clans, bannedPlayers: banned };
}

export function getPlayerClanHistory(playerName, limit=250){
  const ln = lower(playerName);
  const n = Math.max(1, Math.min(1000, Number(limit||250)));
  // De-dupe the same event appearing from multiple sources (e.g. clanLog + playerLog).
  // We collapse rows by (playerLower, fromClan, toClan, timestamp) and aggregate sources.
  return all(
    `WITH grouped AS (
        SELECT h.playerLower,
               COALESCE(p.username, h.playerLower) AS playerName,
               h.fromClan,
               h.toClan,
               h.timestamp,
               GROUP_CONCAT(DISTINCT COALESCE(h.source,'')) AS sources
        FROM player_clan_history h
        LEFT JOIN players p ON p.lowerName = h.playerLower
        WHERE h.playerLower = ?
        GROUP BY h.playerLower, COALESCE(h.fromClan,''), COALESCE(h.toClan,''), h.timestamp
    )
    SELECT playerLower,
           playerName,
           fromClan,
           toClan,
           timestamp,
           CASE
             WHEN INSTR(COALESCE(sources,''), 'clanLog') > 0 THEN 'clanLog'
             WHEN INSTR(COALESCE(sources,''), 'playerLog') > 0 THEN 'playerLog'
             WHEN INSTR(COALESCE(sources,''), 'profile') > 0 THEN 'profile'
             ELSE NULL
           END AS source,
           sources
    FROM grouped
    ORDER BY timestamp DESC
    LIMIT ?`,
    [ln, n]
  );
}

export function getClanMemberChanges(clanName, limit=250){
  const cl = lower(clanName);
  const n = Math.max(1, Math.min(1000, Number(limit||250)));
  // Same de-dupe as player history: one row per event, aggregate sources.
  return all(
    `WITH grouped AS (
        SELECT h.playerLower,
               COALESCE(p.username, h.playerLower) AS playerName,
               h.fromClan,
               h.toClan,
               h.timestamp,
               GROUP_CONCAT(DISTINCT COALESCE(h.source,'')) AS sources
        FROM player_clan_history h
        LEFT JOIN players p ON p.lowerName = h.playerLower
        WHERE LOWER(COALESCE(h.fromClan,'')) = ? OR LOWER(COALESCE(h.toClan,'')) = ?
        GROUP BY h.playerLower, COALESCE(h.fromClan,''), COALESCE(h.toClan,''), h.timestamp
    )
    SELECT playerLower,
           playerName,
           fromClan,
           toClan,
           timestamp,
           CASE
             WHEN INSTR(COALESCE(sources,''), 'clanLog') > 0 THEN 'clanLog'
             WHEN INSTR(COALESCE(sources,''), 'playerLog') > 0 THEN 'playerLog'
             WHEN INSTR(COALESCE(sources,''), 'profile') > 0 THEN 'profile'
             ELSE NULL
           END AS source,
           sources
    FROM grouped
    ORDER BY timestamp DESC
    LIMIT ?`,
    [cl, cl, n]
  );
}



// parseVaultEventMessage imported from ./utils.js

export function getVaultTimeline({ clanName, since, until, minQty = 0, limit = 5000 }){
  const cl = lower(clanName);
  const lim = Math.max(1, Math.min(20000, Number(limit) || 5000));
  const min = Math.max(0, Number(minQty) || 0);

  // We intentionally fetch by string timestamps (ISO) - app already stores timestamps as ISO-ish strings.
  // If since/until not provided, we return most recent window (desc) then sort ascending in JS.
  let rows;
  if (since || until){
    const s = since ? String(since) : "0000-01-01T00:00:00.000Z";
    const u = until ? String(until) : "9999-12-31T23:59:59.999Z";
    rows = all(
      `SELECT message, timestamp, rawJson FROM logs
       WHERE entityType='clan' AND entityLower=?
         AND timestamp >= ? AND timestamp <= ?
         AND (message LIKE '% added %' OR message LIKE '% withdrew %' OR message LIKE '% Added %' OR message LIKE '% Withdrew %')
       ORDER BY timestamp ASC
       LIMIT ?`,
      [cl, s, u, lim]
    );
  } else {
    rows = all(
      `SELECT message, timestamp, rawJson FROM logs
       WHERE entityType='clan' AND entityLower=?
         AND (message LIKE '% added %' OR message LIKE '% withdrew %' OR message LIKE '% Added %' OR message LIKE '% Withdrew %')
       ORDER BY timestamp DESC
       LIMIT ?`,
      [cl, lim]
    ).reverse();
  }

  const out = [];
  for (const r of rows){
    const pv = parseVaultEventMessage(r.message);
    if (!pv) continue;
    if (min && pv.qty < min) continue;
    out.push({
      timestamp: r.timestamp,
      actor: pv.actor,
      action: pv.action,
      qty: pv.qty,
      item: pv.item,
      message: r.message
    });
  }
  return out;
}

// Computes the net "estimated current contents" of a clan vault by replaying all log events.
// Returns { gold, items: [{name, snakeName, itemId, qty}], eventCount, oldestEvent, newestEvent }
export function getVaultContents({ clanName, limit = 20000 } = {}){
  const cl = lower(clanName);
  const lim = Math.max(1, Math.min(100000, Number(limit) || 20000));
  const GOLD_NAMES = new Set(["gold","coins","coin","gold coins"]);

  // Build name→snakeName→itemId reverse map from game data cache
  const itemsById = gameDataCache.itemsById || {}; // id -> snake_name
  const snakeNameToId = {}; // snake_name -> id
  for (const [id, snakeName] of Object.entries(itemsById)){
    snakeNameToId[String(snakeName).toLowerCase()] = Number(id);
  }

  // Display skill name → internal scroll skill name.
  // The game logs use display names (e.g. "attack") but item data uses internal names (e.g. "rigour").
  const SKILL_NAME_MAP = {
    "attack": "rigour",
    // Add further mappings here if the game ever renames more skills
  };

  // Helper: normalise a vault log item name to the game data snake_case Name.
  // Handles the main patterns seen in logs:
  //   "Rare enchantment scroll (farming)"  -> "rare_scroll_of_farming"
  //   "Common enchantment scroll (attack)" -> "common_scroll_of_rigour"
  //   "Common Scroll Of Woodcutting"       -> "common_scroll_of_woodcutting"
  //   "Iron Ore"                           -> "iron_ore"
  const toSnake = s => {
    const str = String(s||"").trim();
    // Pattern: "{rarity} enchantment scroll ({skill})"
    const enchM = str.match(/^(common|rare|exceptional)\s+enchantment\s+scroll\s+\(([^)]+)\)$/i);
    if (enchM){
      const displaySkill = enchM[2].toLowerCase().trim().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
      const internalSkill = SKILL_NAME_MAP[displaySkill] || displaySkill;
      return enchM[1].toLowerCase() + "_scroll_of_" + internalSkill;
    }
    // Pattern: "{rarity} scroll of {skill}" (title-cased or already snake)
    const ofM = str.match(/^(common|rare|exceptional)\s+scroll\s+of\s+(.+)$/i);
    if (ofM){
      const displaySkill = ofM[2].toLowerCase().trim().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
      const internalSkill = SKILL_NAME_MAP[displaySkill] || displaySkill;
      return ofM[1].toLowerCase() + "_scroll_of_" + internalSkill;
    }
    // Default: lowercase, spaces→underscore, strip non-alphanum-underscore
    return str.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
  };

  const rows = all(
    `SELECT message, timestamp FROM logs
     WHERE entityType='clan' AND entityLower=?
       AND (message LIKE '% added %' OR message LIKE '% withdrew %'
         OR message LIKE '% Added %' OR message LIKE '% Withdrew %')
     ORDER BY timestamp ASC
     LIMIT ?`,
    [cl, lim]
  );

  let gold = 0;
  const itemMap = new Map(); // lowerName -> { name, snakeName, itemId, qty, tier }
  let oldestEvent = null;
  let newestEvent = null;

  for (const r of rows){
    const pv = parseVaultEventMessage(r.message);
    if (!pv) continue;
    if (!oldestEvent) oldestEvent = r.timestamp;
    newestEvent = r.timestamp;
    const sign = pv.action === "added" ? 1 : -1;
    if (GOLD_NAMES.has(pv.item.toLowerCase().trim())){
      gold += sign * pv.qty;
    } else {
      // pv.item has already had any trailing "(Tier N)" vault-tier qualifier
      // stripped by parseVaultEventMessage, so this resolves to the item's
      // real snake name/itemId regardless of which vault tier it's stored in.
      const key = pv.item.toLowerCase().trim();
      if (!itemMap.has(key)){
        const snake = toSnake(pv.item);
        const itemId = snakeNameToId[snake] ?? null;
        itemMap.set(key, { name: pv.item, snakeName: snake, itemId, qty: 0, tier: null });
      }
      const entry = itemMap.get(key);
      entry.qty += sign * pv.qty;
      // Track the vault tier this item is stored in. Use the most recent
      // event that carried a tier qualifier — rows are processed oldest
      // first, so a later event's tier overwrites an earlier one (handles
      // the rare case of an item being moved to a different vault tier).
      if (pv.tier != null) entry.tier = pv.tier;
    }
  }

  // Filter out fully-withdrawn items
  const items = [...itemMap.values()]
    .filter(i => i.qty > 0)
    .sort((a, b) => b.qty - a.qty);

  return {
    gold: Math.max(0, gold),
    items,
    eventCount: rows.length,
    oldestEvent,
    newestEvent,
  };
}

// Returns a leaderboard of clans ranked by how much of a specific item they hold.
// If itemName is omitted, returns a summary leaderboard ranked by total unique item types.
// Each entry: { clanName, lowerName, qty, gold, itemCount, snakeName }
export function getVaultLeaderboard({ itemName = "", topN = 50, limitEventsPerClan = 20000 } = {}){
  const lim = Math.max(1, Math.min(100000, Number(limitEventsPerClan) || 20000));

  // Shared helpers — same as getVaultContents
  const GOLD_NAMES = new Set(["gold","coins","coin","gold coins"]);
  const itemsById = gameDataCache.itemsById || {};
  const snakeNameToId = {};
  for (const [id, snakeName] of Object.entries(itemsById)){
    snakeNameToId[String(snakeName).toLowerCase()] = Number(id);
  }
  const SKILL_NAME_MAP = { "attack": "rigour" };
  const toSnake = s => {
    const str = String(s||"").trim();
    const enchM = str.match(/^(common|rare|exceptional)\s+enchantment\s+scroll\s+\(([^)]+)\)$/i);
    if (enchM){
      const ds = enchM[2].toLowerCase().trim().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
      return enchM[1].toLowerCase() + "_scroll_of_" + (SKILL_NAME_MAP[ds] || ds);
    }
    const ofM = str.match(/^(common|rare|exceptional)\s+scroll\s+of\s+(.+)$/i);
    if (ofM){
      const ds = ofM[2].toLowerCase().trim().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
      return ofM[1].toLowerCase() + "_scroll_of_" + (SKILL_NAME_MAP[ds] || ds);
    }
    return str.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
  };

  // Pull all vault events across all clans in one query
  const rows = all(
    `SELECT entityLower, message FROM logs
     WHERE entityType='clan'
       AND (message LIKE '% added %' OR message LIKE '% withdrew %'
         OR message LIKE '% Added %' OR message LIKE '% Withdrew %')
     ORDER BY entityLower, timestamp ASC
     LIMIT ?`,
    [lim * 10] // generous limit across all clans
  );

  // Aggregate: clanLower -> { gold, items: Map<lowerItemName, { name, snakeName, qty }> }
  const clanMap = new Map();
  for (const r of rows){
    const pv = parseVaultEventMessage(r.message);
    if (!pv) continue;
    const cl = r.entityLower;
    if (!clanMap.has(cl)) clanMap.set(cl, { gold:0, items: new Map() });
    const entry = clanMap.get(cl);
    const sign = pv.action === "added" ? 1 : -1;
    if (GOLD_NAMES.has(pv.item.toLowerCase().trim())){
      entry.gold += sign * pv.qty;
    } else {
      const key = pv.item.toLowerCase().trim();
      if (!entry.items.has(key)){
        const snake = toSnake(pv.item);
        entry.items.set(key, { name: pv.item, snakeName: snake, qty: 0 });
      }
      entry.items.get(key).qty += sign * pv.qty;
    }
  }

  // Remove negatives
  for (const [, entry] of clanMap){
    entry.gold = Math.max(0, entry.gold);
    for (const [k, v] of entry.items) if (v.qty <= 0) entry.items.delete(k);
  }

  // Look up pretty clan names from the clans table
  const clanNames = {};
  for (const row of all("SELECT lowerName, clanName FROM clans")){
    clanNames[row.lowerName] = row.clanName;
  }

  const targetKey   = itemName.toLowerCase().trim();
  const targetSnake = targetKey ? toSnake(itemName) : null;

  let results;
  if (targetKey){
    // Rank by quantity of a specific item
    results = [];
    for (const [cl, entry] of clanMap){
      // Match by display name OR snake name
      let best = null;
      for (const [k, v] of entry.items){
        if (k === targetKey || v.snakeName === targetSnake){
          best = v; break;
        }
      }
      if (!best || best.qty <= 0) continue;
      results.push({
        clanName:  clanNames[cl] || cl,
        lowerName: cl,
        qty:       best.qty,
        snakeName: best.snakeName,
        gold:      entry.gold,
        itemCount: entry.items.size,
      });
    }
    results.sort((a,b) => b.qty - a.qty);
  } else {
    // No item specified — rank by total non-zero item types (wealth breadth)
    results = [];
    for (const [cl, entry] of clanMap){
      if (entry.items.size === 0 && entry.gold === 0) continue;
      results.push({
        clanName:  clanNames[cl] || cl,
        lowerName: cl,
        qty:       null,
        snakeName: null,
        gold:      entry.gold,
        itemCount: entry.items.size,
        // Top 3 items by qty for the preview grid
        topItems:  [...entry.items.values()]
          .sort((a,b) => b.qty - a.qty)
          .slice(0, 3)
          .map(i => ({ name:i.name, snakeName:i.snakeName, qty:i.qty })),
      });
    }
    results.sort((a,b) => b.itemCount - a.itemCount);
  }

  return {
    itemName: itemName || null,
    targetSnake,
    results: results.slice(0, Math.max(1, Math.min(200, Number(topN) || 50))),
    totalClansWithVaultData: clanMap.size,
  };
}

export function getMovementTimeline({ playerName, clanName, since, until, limit = 5000 }){
  const lim = Math.max(1, Math.min(20000, Number(limit) || 5000));
  const s = since ? String(since) : "0000-01-01T00:00:00.000Z";
  const u = until ? String(until) : "9999-12-31T23:59:59.999Z";

  const filters = [];
  const args = [];
  filters.push("timestamp >= ?");
  args.push(s);
  filters.push("timestamp <= ?");
  args.push(u);

  if (playerName){
    filters.push("playerLower=?");
    args.push(lower(playerName));
  }
  if (clanName){
    const cn = String(clanName||"");
    // Match either side (from or to)
    filters.push("(fromClan=? OR toClan=?)");
    args.push(cn);
    args.push(cn);
  }

  const where = filters.length ? ("WHERE " + filters.join(" AND ")) : "";
  const rows = all(
    `SELECT playerLower, fromClan, toClan, timestamp, source
     FROM player_clan_history
     ${where}
     ORDER BY timestamp ASC
     LIMIT ?`,
    [...args, lim]
  );

  // Provide a "playerName" for UI convenience (we only store lower; keep as lower if no nicer name)
  return rows.map(r=>({
    playerName: r.playerLower,
    fromClan: r.fromClan || null,
    toClan: r.toClan || null,
    timestamp: r.timestamp,
    sources: r.source ? [r.source] : []
  }));
}

export function getSettings(){
  const rows = all("SELECT key, value FROM settings");
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * Returns players and clans whose updatedAt is older than staleDays (or never updated).
 * Used by the auto-refresh stale background job and the UI stale indicator.
 * Returns at most `limit` rows total, players first then clans, oldest first.
 */
export function getStaleEntities({ staleDays = 7, limit = 200 } = {}){
  const days = Math.max(1, Math.min(365, Number(staleDays) || 7));
  const lim = Math.max(1, Math.min(500000, Number(limit) || 200));
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const players = all(
    `SELECT 'player' AS entityType, username AS entityName, updatedAt
     FROM players
     WHERE (updatedAt IS NULL OR updatedAt < ?)
       AND (notFoundAt IS NULL OR TRIM(notFoundAt) = '')
       AND (dormantAt IS NULL OR TRIM(dormantAt) = '')
     ORDER BY updatedAt ASC NULLS FIRST
     LIMIT ?`,
    [cutoff, lim]
  );

  const clans = all(
    `SELECT 'clan' AS entityType, clanName AS entityName, updatedAt
     FROM clans
     WHERE (updatedAt IS NULL OR updatedAt < ?)
       AND (notFoundAt IS NULL OR TRIM(notFoundAt) = '')
     ORDER BY updatedAt ASC NULLS FIRST
     LIMIT ?`,
    [cutoff, lim]
  );

  return { players, clans, cutoff, staleDays: days };
}

// ---------------------------
// Game-data caching (items, equipment ids)
// ---------------------------

export function getGameDataLookup(){
  return {
    info: {
      ok: !!gameDataCache.ok,
      path: gameDataCache.path || "",
      updatedAt: gameDataCache.updatedAt,
      itemCount: Number(gameDataCache.itemCount || 0),
      error: gameDataCache.error || null,
    },
    itemsById: gameDataCache.itemsById || {},
  };
}

// Returns the holiday event schedule parsed from idleclans-game-data.json,
// along with cache metadata so the UI can show "last refreshed" / fall back
// gracefully if game data hasn't loaded yet.
export function getGameDataEvents(){
  return {
    ok: !!gameDataCache.ok,
    updatedAt: gameDataCache.updatedAt || null,
    events: gameDataCache.holidayEvents || [],
  };
}

export async function updateGameData({ force=false } = {}){
  // Optional staleness check is done by UI (or caller). This always fetches unless caller chooses not to.
  // We keep it simple: if force is false and we already have data loaded, we still allow refresh
  // because the user explicitly clicked the button.
  const startedAt = Date.now();
  const res = await fetch(GAME_DATA_URL, {
    method: "GET",
    headers: { "accept": "application/json,text/plain,*/*" },
  });
  if (!res.ok){
    const txt = await res.text().catch(()=>"");
    throw new Error(`Failed to fetch game-data (${res.status}): ${txt.slice(0,200)}`);
  }

  const rawText = await res.text();
  const sanitized = sanitizeGameDataText(rawText);
  const parsed = JSON.parse(sanitized);
  const { itemsById, enrichedById, itemCount, holidayEvents } = extractItemsMap(parsed);

  const updatedAt = nowIso();

  // Save next to real EXE (PORTABLE_EXECUTABLE_DIR for portables), fall back to userData.
  const _portDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const _exeDir  = !app.isPackaged ? process.cwd() : _portDir ? _portDir : path.dirname(process.execPath);
  const preferredPath = path.join(_exeDir, GAME_DATA_FILENAME);
  let savedPath = preferredPath;
  try{
    fs.writeFileSync(preferredPath, JSON.stringify(parsed), "utf8");
  } catch(err){
    const fallback = path.join(app.getPath("userData"), GAME_DATA_FILENAME);
    fs.writeFileSync(fallback, JSON.stringify(parsed), "utf8");
    savedPath = fallback;
  }

  // Cache in memory for fast lookups.
  Object.assign(gameDataCache, {
    ok: true,
    path: savedPath,
    updatedAt,
    itemCount,
    itemsById,
    enrichedById,
    holidayEvents,
    error: null,
  });

  // Persist metadata in settings table (optional, but useful for auto-update decisions).
  try{
    setSetting({ key: "gameDataPath", value: savedPath });
    setSetting({ key: "gameDataUpdatedAt", value: updatedAt });
  } catch(e){ console.warn("[services] loadGameData: failed to persist metadata", e?.message); }

  const tookMs = Date.now() - startedAt;
  return { ok:true, path:savedPath, updatedAt, itemCount, tookMs };
}

async function loadGameDataFromDisk(){
  // Try real EXE dir first (PORTABLE_EXECUTABLE_DIR), then settings, then userData.
  const _portDir2 = process.env.PORTABLE_EXECUTABLE_DIR;
  const _exeDir2  = !app.isPackaged ? process.cwd() : _portDir2 ? _portDir2 : path.dirname(process.execPath);
  const preferred = path.join(_exeDir2, GAME_DATA_FILENAME);
  const fromSettings = safeGetSetting("gameDataPath");
  const fallback = path.join(app.getPath("userData"), GAME_DATA_FILENAME);
  const candidates = [preferred, fromSettings, fallback].filter(Boolean);

  for (const p of candidates){
    try{
      if (!fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(txt);
      const { itemsById, enrichedById, itemCount, holidayEvents } = extractItemsMap(parsed);
      Object.assign(gameDataCache, {
        ok: true,
        path: p,
        updatedAt: safeGetSetting("gameDataUpdatedAt") || null,
        itemCount,
        itemsById,
        enrichedById,
        holidayEvents,
        error: null,
      });
      return;
    } catch(err){
      // keep trying other candidates
      gameDataCache.ok = false;
      gameDataCache.error = String(err?.message || err);
    }
  }
}

function sanitizeGameDataText(text){
  // API text can include Mongo-style ObjectId("...") tokens. Convert them to plain string values.
  return String(text || "").replace(/ObjectId\("([0-9a-fA-F]+)"\)/g, '"$1"');
}

function extractItemsMap(parsed){
  // Expected shape (from your sample): { Items: { Items: [...] } }
  // We'll be defensive and search a couple of reasonable places.
  const itemsArr =
    parsed?.Items?.Items ||
    parsed?.items?.items ||
    parsed?.items ||
    [];

  const itemsById   = {};
  const enrichedById = {};
  if (Array.isArray(itemsArr)){
    for (const it of itemsArr){
      const id   = Number(it?.ItemId ?? it?.itemId ?? it?.id);
      const name = it?.Name ?? it?.name;
      if (!Number.isFinite(id) || !name) continue;
      itemsById[id]   = String(name);
      enrichedById[id] = {
        name:         String(name),
        baseValue:    Number(it?.BaseValue ?? it?.baseValue ?? 0) || 0,
        canSellToGame: it?.CanNotBeSoldToGameShop ? false : true,
      };
    }
  }

  // Extract holiday event schedule (array at HolidayEvents or holidayEvents).
  // Shape per entry: { EventType, StartMonth, StartDay, StartHour, EndMonth, EndDay, EndHour,
  //                    Milestones[{ ExperienceBoost }], ... }
  const rawEvents = parsed?.HolidayEvents ?? parsed?.holidayEvents ?? [];
  const holidayEvents = Array.isArray(rawEvents) ? rawEvents.map(e => ({
    eventType:   Number(e.EventType   ?? e.eventType   ?? 0),
    startMonth:  Number(e.StartMonth  ?? e.startMonth  ?? 0),
    startDay:    Number(e.StartDay    ?? e.startDay    ?? 0),
    startHour:   Number(e.StartHour   ?? e.startHour   ?? 9),
    startMinute: Number(e.StartMinute ?? e.startMinute ?? 0),
    endMonth:    Number(e.EndMonth    ?? e.endMonth    ?? 0),
    endDay:      Number(e.EndDay      ?? e.endDay      ?? 0),
    endHour:     Number(e.EndHour     ?? e.endHour     ?? 9),
    endMinute:   Number(e.EndMinute   ?? e.endMinute   ?? 0),
    // Best XP boost = highest milestone ExperienceBoost value
    maxXpBoost:  Array.isArray(e.Milestones)
      ? Math.max(...e.Milestones.map(m => Number(m.ExperienceBoost ?? 0)))
      : 0,
  })) : [];

  return { itemsById, enrichedById, itemCount: Object.keys(itemsById).length, holidayEvents };
}

function safeGetSetting(key){
  try{
    const r = one("SELECT value FROM settings WHERE key = ?", [key]);
    return r?.value ?? null;
  } catch{
    return null;
  }
}

export function setSetting({ key, value }){
  const k = String(key||"");
  const v = String(value);
  exec("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [k, v]);

  // If retention policy changes, prune immediately so the DB matches settings.
  if (k === "pvmSampleRetentionDays"){
    const days = Math.max(1, Math.min(365, Number(v||14)));
    try{ prunePvmSamples(days); }catch{}
  }

  saveDb();
  return { ok:true };
}



// ----------------------
// Alerts / Reports / Export
// ----------------------

// isTrackedEnabled, alertsEnabled, alertsOnlyTracked, getAlertInactiveDays,
// joinLeaveAlertsEnabled, insertAlert imported from ./shared/helpers.js

export function getAlerts({ unreadOnly=false, limit=500 } = {}){
  const n = Math.max(1, Math.min(5000, Number(limit || 500)));
  const where = unreadOnly ? "WHERE readAt IS NULL" : "";
  const rows = all(
    `SELECT id, createdAt, type, entityType, entityName, severity, message, readAt
     FROM alerts
     ${where}
     ORDER BY createdAt DESC
     LIMIT ?`,
    [n]
  );
  return { rows };
}

export function markAlertRead(id){
  const numId = Number(id);
  if (!Number.isFinite(numId)) return { ok:false };
  exec("UPDATE alerts SET readAt=? WHERE id=?", [nowIso(), numId]);
  saveDb();
  return { ok:true };
}

export function clearAlerts({ mode="read" } = {}){
  if (mode === "all"){
    exec("DELETE FROM alerts");
  } else {
    exec("DELETE FROM alerts WHERE readAt IS NOT NULL");
  }
  saveDb();
  return { ok:true };
}

export function runIntegrityCheck(){
  // orphan logs: entity referenced but missing parent row in players/clans tables
  const orphanLogs = one(
    `SELECT COUNT(*) AS n
     FROM logs l
     WHERE (l.entityType='player' AND NOT EXISTS (SELECT 1 FROM players p WHERE p.lowerName=l.entityLower))
        OR (l.entityType='clan'   AND NOT EXISTS (SELECT 1 FROM clans c WHERE c.lowerName=l.entityLower))`
  )?.n || 0;

  const orphanHistoryPlayers = one(
    `SELECT COUNT(*) AS n
     FROM player_clan_history h
     WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.lowerName=h.playerLower)`
  )?.n || 0;

  const orphanTracked = one(
    `SELECT COUNT(*) AS n
     FROM tracked t
     WHERE (t.entityType='player' AND NOT EXISTS (SELECT 1 FROM players p WHERE p.lowerName=t.entityLower))
        OR (t.entityType='clan'   AND NOT EXISTS (SELECT 1 FROM clans c WHERE c.lowerName=t.entityLower))`
  )?.n || 0;

  const orphanClanMembers = one(
    `SELECT COUNT(*) AS n
     FROM clan_members cm
     WHERE NOT EXISTS (SELECT 1 FROM clans c WHERE c.lowerName=cm.clanLower)`
  )?.n || 0;

  return { orphanLogs, orphanHistoryPlayers, orphanTracked, orphanClanMembers };
}

// csvEscape imported from ./utils.js

export function exportCsv({ kind="players", limit=5000 } = {}){
  const n = Math.max(1, Math.min(200000, Number(limit || 5000)));
  let header = [];
  let rows = [];

  if (kind === "players"){
    header = ["username","gameMode","guildName","updatedAt"];
    rows = all(
      `SELECT username, gameMode, guildName, updatedAt
       FROM players
       ORDER BY lowerName
       LIMIT ?`,
      [n]
    );
  } else if (kind === "clans"){
    header = ["clanName","tag","gameMode","updatedAt"];
    rows = all(
      `SELECT clanName, tag, gameMode, updatedAt
       FROM clans
       ORDER BY lowerName
       LIMIT ?`,
      [n]
    );
  } else if (kind === "history"){
    header = ["player","fromClan","toClan","timestamp","source"];
    rows = all(
      `SELECT COALESCE(p.username, h.playerLower) AS player,
              h.fromClan, h.toClan, h.timestamp, h.source
       FROM player_clan_history h
       LEFT JOIN players p ON p.lowerName=h.playerLower
       ORDER BY h.timestamp DESC
       LIMIT ?`,
      [n]
    );
  } else if (kind === "alerts"){
    header = ["createdAt","type","entityType","entityName","severity","message","readAt"];
    rows = all(
      `SELECT createdAt, type, entityType, entityName, severity, message, readAt
       FROM alerts
       ORDER BY createdAt DESC
       LIMIT ?`,
      [n]
    );
  } else {
    return { ok:false, error:"Unknown export kind" };
  }

  const lines = [];
  lines.push(header.join(","));
  for (const r of rows){
    lines.push(header.map(k=>csvEscape(r[k])).join(","));
  }
  return { ok:true, csv: lines.join("\n") };
}

export function exportShareableJson({ kind="players", limit=50000 } = {}){
  const n = Math.max(1, Math.min(200000, Number(limit||50000)));

  if (kind === "players"){
    // Export a list of player names — the lightest format, importable as a name list
    const rows = all(
      `SELECT username FROM players ORDER BY lowerName LIMIT ?`, [n]
    );
    return {
      ok: true,
      json: JSON.stringify({ players: rows.map(r=>({ username: r.username })) }, null, 2),
    };

  } else if (kind === "clans"){
    const rows = all(
      `SELECT clanName, tag, gameMode FROM clans ORDER BY lowerName LIMIT ?`, [n]
    );
    return {
      ok: true,
      json: JSON.stringify({ clans: rows.map(r=>({ clanName: r.clanName, tag: r.tag||null, gameMode: r.gameMode||null })) }, null, 2),
    };

  } else if (kind === "flaggedPlayers"){
    // Flagged/tracked players — useful for sharing a watchlist
    const rows = all(
      `SELECT t.entityName AS username, p.gameMode, p.guildName
       FROM tracked t
       LEFT JOIN players p ON p.lowerName = t.entityLower
       WHERE t.entityType='player' AND t.enabled=1
       ORDER BY t.entityName
       LIMIT ?`,
      [n]
    );
    return {
      ok: true,
      json: JSON.stringify({ players: rows.map(r=>({ username: r.username, gameMode: r.gameMode||null, guildName: r.guildName||null })) }, null, 2),
    };

  } else if (kind === "flaggedClans"){
    const rows = all(
      `SELECT t.entityName AS clanName, c.tag, c.gameMode
       FROM tracked t
       LEFT JOIN clans c ON c.lowerName = t.entityLower
       WHERE t.entityType='clan' AND t.enabled=1
       ORDER BY t.entityName
       LIMIT ?`,
      [n]
    );
    return {
      ok: true,
      json: JSON.stringify({ clans: rows.map(r=>({ clanName: r.clanName, tag: r.tag||null, gameMode: r.gameMode||null })) }, null, 2),
    };

  } else if (kind === "banned"){
    const rows = all(
      `SELECT username, gameMode, guildName FROM players
       WHERE bannedAt IS NOT NULL AND TRIM(bannedAt)!=''
       ORDER BY lowerName LIMIT ?`,
      [n]
    );
    return {
      ok: true,
      json: JSON.stringify({ players: rows.map(r=>({ username: r.username, gameMode: r.gameMode||null, guildName: r.guildName||null })) }, null, 2),
    };

  } else if (kind === "all"){
    // Full combined export — both players and clans
    const players = all(`SELECT username, gameMode, guildName FROM players ORDER BY lowerName LIMIT ?`, [n]);
    const clans   = all(`SELECT clanName, tag, gameMode FROM clans ORDER BY lowerName LIMIT ?`, [n]);
    return {
      ok: true,
      json: JSON.stringify({
        players: players.map(r=>({ username: r.username, gameMode: r.gameMode||null, guildName: r.guildName||null })),
        clans:   clans.map(r=>({ clanName: r.clanName, tag: r.tag||null, gameMode: r.gameMode||null })),
      }, null, 2),
    };
  }

  return { ok:false, error:"Unknown export kind" };
}

// ── Full backup export ───────────────────────────────────────────────────────
// Spawns a worker thread so the main process / UI stays fully responsive.
// onProgress(msg) is called with { table, tableRows, totalRows } periodically.
export function exportFullBackup(destPath, onProgress){
  const { Worker } = createRequire(import.meta.url)("worker_threads");
  const workerPath = new URL("./export-worker.cjs", import.meta.url);
  // fileURLToPath handles %20 and other URL encoding correctly on all platforms
  const { fileURLToPath } = createRequire(import.meta.url)("url");
  const workerFile = fileURLToPath(workerPath);

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, {
      workerData: { dbPath: dbPath || getDefaultDbPath(), destPath },
    });

    worker.on("message", (msg) => {
      if (msg.type === "progress"){
        try{ onProgress?.(msg); }catch{}
      } else if (msg.type === "done"){
        resolve({ ok:true, destPath:msg.destPath, counts:msg.counts, failedTables:msg.failedTables, totalRows:msg.totalRows });
      } else if (msg.type === "error"){
        reject(new Error(msg.message));
      }
    });

    worker.on("error",  (e) => reject(e));
    worker.on("exit",   (code) => { if (code !== 0) reject(new Error(`Worker exited with code ${code}`)); });
  });
}

// ── Full backup import ───────────────────────────────────────────────────────
// Reads the backup JSON line-by-line using Node's built-in readline module.
// The export writes exactly one JSON row per line inside each table array,
// so we can parse rows incrementally without loading the whole file into RAM.
export async function importFullBackup({ filePath, onProgress }){
  if (!filePath) return { ok:false, error:"No file path provided" };

  const readline = createRequire(import.meta.url)("readline");
  const results  = {};
  const errors   = {};
  let   exportedAt   = null;
  let   exportCounts = null;

  // Insert function lookup — keyed by table name
  function getInsertFn(table){
    const map = {
      players: r => exec(
        `INSERT OR REPLACE INTO players(lowerName,username,gameMode,guildName,profileJson,updatedAt,bannedAt,notFoundAt,dormantAt) VALUES(?,?,?,?,?,?,?,?,?)`,
        [r.lowerName,r.username,r.gameMode??null,r.guildName??null,r.profileJson??null,r.updatedAt??null,r.bannedAt??null,r.notFoundAt??null,r.dormantAt??null]),
      clans: r => exec(
        `INSERT OR REPLACE INTO clans(lowerName,clanName,gameMode,tag,dataJson,updatedAt,notFoundAt) VALUES(?,?,?,?,?,?,?)`,
        [r.lowerName,r.clanName,r.gameMode??null,r.tag??null,r.dataJson??null,r.updatedAt??null,r.notFoundAt??null]),
      clan_members: r => exec(
        `INSERT OR REPLACE INTO clan_members(clanLower,memberLower,memberName,rank,hoursOffline,lastScannedAt,lastUpdatedAt) VALUES(?,?,?,?,?,?,?)`,
        [r.clanLower,r.memberLower,r.memberName,r.rank??null,r.hoursOffline??null,r.lastScannedAt??null,r.lastUpdatedAt??null]),
      tracked: r => exec(
        `INSERT OR REPLACE INTO tracked(entityType,entityLower,entityName,enabled,intervalMinutes,nextRunAt) VALUES(?,?,?,?,?,?)`,
        [r.entityType,r.entityLower,r.entityName,r.enabled??1,r.intervalMinutes??null,r.nextRunAt??null]),
      player_clan_history: r => exec(
        `INSERT OR IGNORE INTO player_clan_history(playerLower,fromClan,toClan,timestamp,source) VALUES(?,?,?,?,?)`,
        [r.playerLower,r.fromClan??null,r.toClan??null,r.timestamp,r.source??null]),
      logs: r => exec(
        `INSERT OR IGNORE INTO logs(entityType,entityLower,message,timestamp,rawJson) VALUES(?,?,?,?,?)`,
        [r.entityType,r.entityLower,r.message,r.timestamp,r.rawJson??null]),
      alerts: r => exec(
        `INSERT OR IGNORE INTO alerts(createdAt,type,entityType,entityLower,entityName,severity,message,readAt) VALUES(?,?,?,?,?,?,?,?)`,
        [r.createdAt,r.type,r.entityType,r.entityLower,r.entityName,r.severity??null,r.message,r.readAt??null]),
      cases: r => exec(
        `INSERT OR REPLACE INTO cases(id,title,status,createdAt,updatedAt,summary) VALUES(?,?,?,?,?,?)`,
        [r.id,r.title,r.status??"open",r.createdAt,r.updatedAt??r.createdAt,r.summary??null]),
      case_entities: r => exec(
        `INSERT OR IGNORE INTO case_entities(caseId,entityType,entityLower,entityName,createdAt) VALUES(?,?,?,?,?)`,
        [r.caseId,r.entityType,r.entityLower,r.entityName,r.createdAt??r.addedAt??null]),
      case_notes: r => exec(
        `INSERT OR IGNORE INTO case_notes(caseId,createdAt,note) VALUES(?,?,?)`,
        [r.caseId,r.createdAt,r.note]),
      case_snapshots: r => exec(
        `INSERT OR REPLACE INTO case_snapshots(id,caseId,createdAt,kind,title,dataJson) VALUES(?,?,?,?,?,?)`,
        [r.id,r.caseId,r.createdAt??r.takenAt,r.kind??"manual",r.title??null,r.dataJson??r.snapshotJson??null]),
      pvm_snapshots: r => exec(
        `INSERT OR REPLACE INTO pvm_snapshots(playerLower,playerName,gameMode,dayKey,takenAt,clanName,pvmJson) VALUES(?,?,?,?,?,?,?)`,
        [r.playerLower,r.playerName,r.gameMode,r.dayKey,r.takenAt,r.clanName??null,r.pvmJson]),
      pvm_samples: r => exec(
        `INSERT OR IGNORE INTO pvm_samples(playerLower,playerName,gameMode,takenAt,clanName,pvmJson) VALUES(?,?,?,?,?,?)`,
        [r.playerLower,r.playerName,r.gameMode,r.takenAt,r.clanName??null,r.pvmJson]),
      clan_pvm_snapshots: r => exec(
        `INSERT OR REPLACE INTO clan_pvm_snapshots(clanLower,clanName,takenAt,pvmJson) VALUES(?,?,?,?)`,
        [r.clanLower,r.clanName,r.takenAt,r.pvmJson]),
      leaderboard_cache: r => exec(
        `INSERT OR REPLACE INTO leaderboard_cache(boardKey,rank,nameLower,name,level,score,expCapDate,capturedAt,rawJson) VALUES(?,?,?,?,?,?,?,?,?)`,
        [r.boardKey,r.rank,r.nameLower,r.name,r.level??null,r.score??null,r.expCapDate??null,r.capturedAt,r.rawJson??null]),
      leaderboard_snapshots: r => exec(
        `INSERT OR REPLACE INTO leaderboard_snapshots(id,boardKey,title,createdAt,source,sourceJobId,note,rowCount) VALUES(?,?,?,?,?,?,?,?)`,
        [r.id,r.boardKey,r.title??null,r.createdAt,r.source??null,r.sourceJobId??null,r.note??null,r.rowCount??0]),
      leaderboard_snapshot_rows: r => exec(
        `INSERT OR REPLACE INTO leaderboard_snapshot_rows(snapshotId,rank,nameLower,name,level,score,expCapDate,clanName,clanLower,clanSource,capturedAt,rawJson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.snapshotId,r.rank,r.nameLower,r.name,r.level??null,r.score??null,r.expCapDate??null,r.clanName??null,r.clanLower??null,r.clanSource??null,r.capturedAt,r.rawJson??null]),
      leaderboard_watches: r => exec(
        `INSERT OR REPLACE INTO leaderboard_watches(id,boardKey,title,intervalMinutes,enabled,saveMode,retentionDays,lastRunAt,nextRunAt,lastSignature,lastStatus,lastError) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.id,r.boardKey,r.title??null,r.intervalMinutes??10,r.enabled??0,r.saveMode??"always",r.retentionDays??null,r.lastRunAt??null,r.nextRunAt??null,r.lastSignature??null,r.lastStatus??null,r.lastError??null]),
      presence_samples: r => exec(
        `INSERT OR IGNORE INTO presence_samples(playerLower,scannedAt,hoursOffline,lastOnlineAt,source) VALUES(?,?,?,?,?)`,
        [r.playerLower,r.scannedAt,r.hoursOffline??null,r.lastOnlineAt??null,r.source??null]),
      game_news: r => exec(
        `INSERT OR REPLACE INTO game_news(newsId,title,body,category,publishedAt,fetchedAt,rawJson) VALUES(?,?,?,?,?,?,?)`,
        [r.newsId??null,r.title??null,r.body??null,r.category??null,r.publishedAt??null,r.fetchedAt,r.rawJson??null]),
      market_prices: r => exec(
        `INSERT OR REPLACE INTO market_prices(itemId,lowestSellPrice,lowestPriceVolume,highestBuyPrice,highestPriceVolume,dailyAveragePrice,fetchedAt) VALUES(?,?,?,?,?,?,?)`,
        [r.itemId,r.lowestSellPrice??null,r.lowestPriceVolume??null,r.highestBuyPrice??null,r.highestPriceVolume??null,r.dailyAveragePrice??null,r.fetchedAt]),
      verified_accounts: r => exec(
        `INSERT OR REPLACE INTO verified_accounts(username,lowerName,verifiedAt,tokenIssuer) VALUES(?,?,?,?)`,
        [r.username,r.lowerName,r.verifiedAt,r.tokenIssuer??null]),
      account_skill_snapshots: r => exec(
        `INSERT OR REPLACE INTO account_skill_snapshots(lowerName,snappedAt,totalLevel,totalXp,skillsJson,pvmJson) VALUES(?,?,?,?,?,?)`,
        [r.lowerName,r.snappedAt??r.takenAt,r.totalLevel??null,r.totalXp??null,r.skillsJson,r.pvmJson??null]),
      settings: r => exec(
        `INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`,
        [r.key,r.value??null]),
      chat_messages: r => exec(
        `INSERT OR IGNORE INTO chat_messages(category,senderLower,sender,message,timestamp,premium,gilded,gameMode,isModerator,receivedAt,rawJson) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [r.category,r.senderLower,r.sender,r.message,r.timestamp,r.premium??null,r.gilded??null,r.gameMode??null,r.isModerator??null,r.receivedAt,r.rawJson??null]),
      player_chat_flags: r => exec(
        `INSERT OR REPLACE INTO player_chat_flags(lowerName,premium,gilded,moderator,lastSeenAt,updatedAt) VALUES(?,?,?,?,?,?)`,
        [r.lowerName,r.premium??null,r.gilded??null,r.moderator??null,r.lastSeenAt??null,r.updatedAt??null]),
    };
    return map[table] || null;
  }

  // ── Line-by-line parser ───────────────────────────────────────────────────
  // The export writes the file like:
  //   {
  //     "players": [
  //       {"lowerName":"...", ...}        <- one JSON object per line
  //       ,{"lowerName":"...", ...}
  //     ]
  //   , "clans": [ ...
  //     "_meta": {...}
  //   }
  //
  // We track which table we're currently inside and parse rows one at a time.

  const BATCH_SIZE = 500;

  await new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let currentTable  = null;
    let insertFn      = null;
    let batch         = [];
    let n             = 0;

    function flushBatch(){
      if (!batch.length || !insertFn) return;
      const rows = batch.splice(0);
      const txn = db.transaction(() => {
        for (const row of rows){
          try{ insertFn(row); n++; }catch(re){
            if (results[currentTable] === undefined)
              console.warn(`[importFullBackup] ${currentTable}: row error:`, re?.message);
          }
        }
      });
      try{ txn(); }catch(te){
        console.warn(`[importFullBackup] ${currentTable}: batch txn error:`, te?.message);
      }
      try{ onProgress?.({ table: currentTable, tableRows: n, totalInserted: Object.values(results).reduce((a,b)=>a+b,0) + n }); }catch{}
    }

    rl.on("line", (raw) => {
      const line = raw.trim();
      if (!line || line === "{" || line === "}") return;

      // Top-level key line: `"tableName": [` or `,"tableName": [`
      const keyMatch = line.match(/^,?\s*"([^"]+)":\s*\[/);
      if (keyMatch){
        // Flush previous table
        if (currentTable){ flushBatch(); results[currentTable] = n; n = 0; }
        currentTable = keyMatch[1];
        insertFn     = getInsertFn(currentTable);
        return;
      }

      // _meta object line: `"_meta": {`
      const metaMatch = line.match(/^,?\s*"_meta":\s*\{/);
      if (metaMatch){
        if (currentTable){ flushBatch(); results[currentTable] = n; n = 0; }
        currentTable = "_meta";
        insertFn     = null;
        return;
      }

      // Closing bracket of a table array
      if (line === "]" || line === "],"){
        if (currentTable && currentTable !== "_meta"){
          flushBatch();
          results[currentTable] = n;
          n = 0;
        }
        currentTable = null;
        insertFn     = null;
        return;
      }

      // _meta content lines — parse the whole object lazily
      if (currentTable === "_meta"){
        // Collect lines until we can parse exportedAt / counts
        try{
          // Try to extract exportedAt from any line containing it
          const eaMatch = line.match(/"exportedAt"\s*:\s*"([^"]+)"/);
          if (eaMatch) exportedAt = eaMatch[1];
        }catch{}
        return;
      }

      // Data row line — strip leading comma
      if (!currentTable || !insertFn) return;
      const rowStr = line.replace(/^,/, "").trim();
      if (!rowStr || rowStr === "[" || rowStr === "]") return;

      try{
        const row = JSON.parse(rowStr);
        batch.push(row);
        if (batch.length >= BATCH_SIZE) flushBatch();
      }catch(pe){
        // Malformed row — skip silently
      }
    });

    rl.on("close", () => {
      // Flush any remaining rows
      if (currentTable && currentTable !== "_meta"){
        flushBatch();
        results[currentTable] = n;
      }
      resolve();
    });

    rl.on("error", reject);
    fileStream.on("error", reject);
  });

  saveDb({ forceBackup: true });

  const totalInserted = Object.values(results).reduce((a, b) => a + b, 0);
  const failedTables  = Object.keys(errors);

  return {
    ok: true,
    results,
    errors:       failedTables.length ? errors : undefined,
    failedTables: failedTables.length ? failedTables : undefined,
    totalInserted,
    exportedAt,
    exportCounts,
  };
}


export function getAnalyticsSummary(){
  // ── Counts (indexes on bannedAt, gameMode make these fast) ────────────────
  const players  = one("SELECT COUNT(*) AS n FROM players")?.n || 0;
  const clans    = one("SELECT COUNT(*) AS n FROM clans")?.n || 0;
  const banned   = one("SELECT COUNT(*) AS n FROM players WHERE bannedAt IS NOT NULL AND TRIM(bannedAt)<>''")?.n || 0;
  const flagged  = one("SELECT COUNT(*) AS n FROM tracked WHERE entityType='player' AND enabled=1")?.n || 0;
  const flaggedClans = one("SELECT COUNT(*) AS n FROM tracked WHERE entityType='clan' AND enabled=1")?.n || 0;

  // ── Scan coverage (index on updatedAt) ────────────────────────────────────
  const now = Date.now();
  const cutoff7  = new Date(now - 7*86400000).toISOString();
  const cutoff30 = new Date(now - 30*86400000).toISOString();
  const scanned7  = one("SELECT COUNT(*) AS n FROM players WHERE updatedAt >= ?", [cutoff7])?.n  || 0;
  const scanned30 = one("SELECT COUNT(*) AS n FROM players WHERE updatedAt >= ?", [cutoff30])?.n || 0;
  const neverScanned = one("SELECT COUNT(*) AS n FROM players WHERE updatedAt IS NULL")?.n || 0;

  // ── Clan movement (index on timestamp) ───────────────────────────────────
  // Single pass: get all three counts in one query using conditional aggregation
  const movesRow = one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS last30,
            SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS last7
     FROM player_clan_history`,
    [cutoff30, cutoff7]
  ) || {};
  const totalMoves = movesRow.total || 0;
  const moves30    = movesRow.last30 || 0;
  const moves7     = movesRow.last7  || 0;

  // ── Chat + Logs + PvM (simple indexed COUNTs) ────────────────────────────
  const chatMessages  = one("SELECT COUNT(*) AS n FROM chat_messages")?.n || 0;
  const totalLogs     = (() => { try{ return one("SELECT COUNT(*) AS n FROM player_logs")?.n || 0; }catch{ return 0; } })();
  const pvmSnapshots  = (() => { try{ return one("SELECT COUNT(*) AS n FROM pvm_snapshots")?.n  || 0; }catch{ return 0; } })();

  // ── Recent bans (bannedAt index) ─────────────────────────────────────────
  const recentBanned = all(
    `SELECT username, guildName, gameMode, bannedAt
     FROM players WHERE bannedAt IS NOT NULL AND TRIM(bannedAt)<>''
     ORDER BY bannedAt DESC LIMIT 10`
  );

  // ── Mode breakdown (gameMode index) ──────────────────────────────────────
  const byMode = {};
  for (const r of all("SELECT COALESCE(gameMode,'unknown') AS m, COUNT(*) AS n FROM players GROUP BY m")){
    byMode[r.m] = r.n;
  }

  return {
    players, clans, banned, flagged, flaggedClans,
    scanned7, scanned30, neverScanned,
    moves7, moves30, totalMoves,
    chatMessages, totalLogs, pvmSnapshots,
    recentBanned, byMode,
  };
}

export function getInactiveReport({ days=7, trackedOnly=true, limit=500 } = {}){
  const d = Math.max(1, Math.min(365, Number(days || 7)));
  const n = Math.max(1, Math.min(5000, Number(limit || 500)));

  // Latest presence sample per player
  // daysOffline = (scannedAt - lastOnlineAt) / 86400000
  // We filter by daysOffline >= requested threshold.
  const whereTracked = trackedOnly ? "AND EXISTS(SELECT 1 FROM tracked t WHERE t.entityType='player' AND t.entityLower=p.lowerName AND t.enabled=1)" : "";
  const rows = all(
    `WITH latest AS (
        SELECT ps.playerLower, MAX(ps.scannedAt) AS scannedAt
        FROM presence_samples ps
        GROUP BY ps.playerLower
     )
     SELECT p.lowerName AS playerLower,
            p.username AS playerName,
            p.guildName,
            ps.scannedAt,
            ps.lastOnlineAt,
            CASE
              WHEN ps.lastOnlineAt IS NOT NULL THEN (julianday(ps.scannedAt) - julianday(ps.lastOnlineAt))
              ELSE NULL
            END AS daysOffline
     FROM latest l
     JOIN presence_samples ps ON ps.playerLower=l.playerLower AND ps.scannedAt=l.scannedAt
     JOIN players p ON p.lowerName=ps.playerLower
     WHERE ps.lastOnlineAt IS NOT NULL
       ${whereTracked}
       AND (julianday(ps.scannedAt) - julianday(ps.lastOnlineAt)) >= ?
     ORDER BY daysOffline DESC
     LIMIT ?`,
    [d, n]
  );
  return { rows };
}

// ── Logs query functions ──────────────────────────────────────────────────────
export function getLogs({ entityType, entityName }){
  return all(
    `SELECT message, timestamp FROM logs
     WHERE entityType=? AND entityLower=?
     ORDER BY timestamp DESC LIMIT 200`,
    [entityType, lower(entityName)]
  );
}

export function getLogsDetailed({ entityType, entityName, limit=2000, since }){
  const lim = Math.max(1, Math.min(20000, Number(limit) || 2000));
  const ent = lower(entityName);
  if (since){
    return all(
      `SELECT message, timestamp, rawJson FROM logs
       WHERE entityType=? AND entityLower=? AND timestamp >= ?
       ORDER BY timestamp DESC LIMIT ?`,
      [entityType, ent, String(since), lim]
    );
  }
  return all(
    `SELECT message, timestamp, rawJson FROM logs
     WHERE entityType=? AND entityLower=?
     ORDER BY timestamp DESC LIMIT ?`,
    [entityType, ent, lim]
  );
}

// ── Tracked entity management ─────────────────────────────────────────────────
export function setTracked({ entityType, name, enabled }){
  const s = getSettings();
  const en = enabled ? 1 : 0;
  const interval  = Number(s.trackIntervalMinutes ?? 10);
  const nextRunAt = new Date(Date.now() + interval * 60000).toISOString();
  exec(
    `INSERT INTO tracked(entityType, entityLower, entityName, enabled, intervalMinutes, nextRunAt)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(entityType, entityLower) DO UPDATE SET
       enabled=excluded.enabled, intervalMinutes=excluded.intervalMinutes,
       nextRunAt=excluded.nextRunAt, entityName=excluded.entityName`,
    [entityType, lower(name), name, en, interval, nextRunAt]
  );
  saveDb();
  return { ok:true };
}

export function getTracked({ entityType, name }){
  const r = one(
    "SELECT enabled, intervalMinutes, nextRunAt FROM tracked WHERE entityType=? AND entityLower=?",
    [entityType, lower(name)]
  );
  if (!r) return { enabled:false };
  return { enabled: !!r.enabled, intervalMinutes: r.intervalMinutes, nextRunAt: r.nextRunAt };
}

// ── Players query + modifier functions (extracted to services/players.js) ──────
export const listPlayers            = (...a) => _listPlayers(...a);
export const listPlayersWithEquipment = (...a) => _listPlayersWithEquipment(...a);
export const getPlayersWithItem     = (...a) => _getPlayersWithItem(...a);
export const getTaskActivitySummary = (...a) => _getTaskActivitySummary(...a);
export const getPlayersByTask       = (...a) => _getPlayersByTask(...a);
export const getPlayer              = (...a) => _getPlayer(...a);
export const getAllPlayerNames       = (...a) => _getAllPlayerNames(...a);
export const setPlayerBanned        = (...a) => _setPlayerBanned(...a);
export const banClanMembers         = (...a) => _banClanMembers(...a);
export const flagClanMembers        = (...a) => _flagClanMembers(...a);
export const listBannedPlayers      = (...a) => _listBannedPlayers(...a);
export const listNotFoundEntities   = (...a) => _listNotFoundEntities(...a);
export const clearNotFoundEntity    = (...a) => _clearNotFoundEntity(...a);
export const recheckNotFoundEntity  = (...a) => _recheckNotFoundEntity(...a);
export const listDormantPlayers     = (...a) => _listDormantPlayers(...a);
export const clearDormantPlayer     = (...a) => _clearDormantPlayer(...a);
export const recheckDormantPlayer   = (...a) => _recheckDormantPlayer(...a);
export const listFlaggedPlayers     = (...a) => _listFlaggedPlayers(...a);
export const getPlayersClanMap      = (...a) => _getPlayersClanMap(...a);

// ── Clans query + modifier functions (extracted to services/clans.js) ─────────
export const listClans              = (...a) => _listClans(...a);
export const getClan                = (...a) => _getClan(...a);
export const getAllClanNames        = (...a) => _getAllClanNames(...a);
export const listFlaggedClans       = (...a) => _listFlaggedClans(...a);
export const listClanSkillSignals   = (...a) => _listClanSkillSignals(...a);
export const listPotentialClans     = (...a) => _listPotentialClans(...a);

export function getPvmDelta24h({ name } = {}){
  const nm = String(name||"").trim();
  if (!nm) return { ok:false, reason:"no_name" };
  const ln = lower(nm);
  const prow = one(`SELECT username, gameMode FROM players WHERE lowerName=?`, [ln]);
  const gm = String(prow?.gameMode || "normal").toLowerCase() || "normal";

  const snaps = all(
    `SELECT dayKey, takenAt, clanName, pvmJson
     FROM pvm_snapshots
     WHERE playerLower=? AND gameMode=?
     ORDER BY dayKey DESC
     LIMIT 2`,
    [ln, gm]
  );
  if (!snaps || snaps.length === 0) return { ok:true, hasBaseline:false, gameMode: gm, deltas:null };

  const cur = snaps[0];
  if (snaps.length < 2){
    let curObj=null;
    try{ curObj = JSON.parse(cur.pvmJson); }catch{}
    return { ok:true, hasBaseline:false, gameMode: gm, currentDayKey: cur.dayKey, deltas:null, current: curObj };
  }
  const prev = snaps[1];

  let curObj=null, prevObj=null;
  try{ curObj = JSON.parse(cur.pvmJson); }catch{}
  try{ prevObj = JSON.parse(prev.pvmJson); }catch{}
  if (!curObj || !prevObj) return { ok:false, reason:"bad_json" };

  const deltas = {};
  const keys = new Set([...Object.keys(curObj), ...Object.keys(prevObj)]);
  for (const k of keys){
    const a = Number(curObj[k] ?? 0);
    const b = Number(prevObj[k] ?? 0);
    if (Number.isFinite(a) && Number.isFinite(b)){
      deltas[k] = a - b;
    }
  }
  return { ok:true, hasBaseline:true, gameMode: gm, currentDayKey: cur.dayKey, prevDayKey: prev.dayKey, deltas, current: curObj };
}

// ── PvM (extracted to services/pvm.js) ───────────────────────────────────────
export const getPvmSnapshotStatus     = (...a) => _getPvmSnapshotStatus(...a);
export const maybeSnapshotPvmForPlayer= (...a) => _maybeSnapshotPvmForPlayer(...a);
export const takePvmSnapshotNow       = (...a) => _takePvmSnapshotNow(...a);
export const prunePvmSamples          = (...a) => _prunePvmSamples(...a);
export const recordPvmSampleForPlayer = (...a) => _recordPvmSampleForPlayer(...a);
export const getPvmSampleStats        = (...a) => _getPvmSampleStats(...a);
export const getPvmRollingDelta       = (...a) => _getPvmRollingDelta(...a);
export const getPvmCorrelationRolling = (...a) => _getPvmCorrelationRolling(...a);
export const getPvmCorrelation        = (...a) => _getPvmCorrelation(...a);


// Map PvM boss keys (often Pascal/Camel) to leaderboard category keys (snake_case lower).
function pvmBossKeyToLeaderboardCategory(bossKey){
  const raw = String(bossKey || "").trim();
  if (!raw) return "";
  const hasUnderscore = raw.includes("_");
  if (hasUnderscore) return raw.toLowerCase();
  // Convert PascalCase/CamelCase -> snake_case
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
  return snake;
}

// Option 1: Use cached leaderboard data as baseline, then rescan the relevant leaderboard now,
// and compare per-player deltas against the expected PvM delta.
export async function verifyPvmGroupLeaderboard({ bossKey, gameMode="default", expectedDelta=null, playerNames=[] } = {}){
  const bk = String(bossKey || "").trim();
  if (!bk) return { ok:false, error:"Missing bossKey" };
  const gm = String(gameMode || "default").trim() || "default";
  const category = pvmBossKeyToLeaderboardCategory(bk);
  if (!category) return { ok:false, error:"Unable to map bossKey to leaderboard category" };

  const names = Array.isArray(playerNames) ? playerNames.map(n=>String(n||"").trim()).filter(Boolean) : [];
  if (names.length === 0) return { ok:false, error:"No players provided" };
  const lowers = [...new Set(names.map(n=>lower(n)))];

  const boardKey = leaderboardBoardKey("players", gm, category);

  // Baseline: take the latest cached score for each player on this board
  const baseRows = all(
    `SELECT nameLower, score, MAX(capturedAt) AS capturedAt
     FROM leaderboard_cache
     WHERE boardKey=? AND nameLower IN (${lowers.map(()=>"?").join(",")})
     GROUP BY nameLower`,
    [boardKey, ...lowers]
  );

  const baseMap = new Map();
  let baselineCapturedAt = null;
  for (const r of (baseRows||[])){
    baseMap.set(String(r.nameLower), { score: Number(r.score), capturedAt: r.capturedAt });
    if (r.capturedAt && (!baselineCapturedAt || r.capturedAt > baselineCapturedAt)) baselineCapturedAt = r.capturedAt;
  }

  if (baseMap.size === 0){
    return {
      ok:false,
      error:`No cached leaderboard data found for ${category} (${gm}). Please scan this leaderboard once first.`
    };
  }

  // Rescan now (updates cache for this board). Keep it as a normal scan so it uses the existing rate limiter.
  const scanRes = await scanLeaderboardBoard({ entityType:"players", gameMode: gm, category, clearCache:true, importMissing:false });

  // Latest after scan
  const latestRows = all(
    `SELECT nameLower, score, MAX(capturedAt) AS capturedAt
     FROM leaderboard_cache
     WHERE boardKey=? AND nameLower IN (${lowers.map(()=>"?").join(",")})
     GROUP BY nameLower`,
    [boardKey, ...lowers]
  );

  const latestMap = new Map();
  let latestCapturedAt = null;
  for (const r of (latestRows||[])){
    latestMap.set(String(r.nameLower), { score: Number(r.score), capturedAt: r.capturedAt });
    if (r.capturedAt && (!latestCapturedAt || r.capturedAt > latestCapturedAt)) latestCapturedAt = r.capturedAt;
  }

  const exp = (expectedDelta === null || expectedDelta === undefined) ? null : Number(expectedDelta);

  const results = names.map(n=>{
    const ln = lower(n);
    const b = baseMap.get(ln);
    const a = latestMap.get(ln);
    const baseline = (b && Number.isFinite(b.score)) ? b.score : null;
    const latest = (a && Number.isFinite(a.score)) ? a.score : null;
    const delta = (baseline !== null && latest !== null) ? (latest - baseline) : null;
    const matchesExpected = (exp !== null && delta !== null) ? (delta == exp) : false;
    return { playerName: n, baseline, latest, delta, matchesExpected };
  });

  const note = scanRes?.status === "stalled" ? "Scan stalled (repeat-guard); results may be incomplete." : null;

  return {
    ok:true,
    category,
    gameMode: gm,
    boardKey,
    baselineCapturedAt,
    latestCapturedAt,
    expectedDelta: exp,
    results,
    note
  };
}


export async function runOneDueTracked({ callsPerMin, intervalDefault }, runner){
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  // We want tracked refreshes to feel like a single "run" (cycle) rather than
  // a random one-off that depends on when each entity was flagged.
  //
  // Behavior:
  // - When ANY enabled tracked item becomes due, we start a cycle.
  // - A cycle iterates all enabled tracked items in a stable order.
  // - Each item gets its nextRunAt aligned to the cycle start + its interval.
  // - Subsequent scheduler ticks continue where we left off until done.
  //
  // This keeps the UI intuitive: X/Y done, and the next due is the next cycle.

  // Prevent overlapping tracked work.
  if (globalThis.__idleclansTrackedCurrent) return;

  let cycle = globalThis.__idleclansTrackedCycle || null;
  if (!cycle || cycle.done >= cycle.total){
    // Start a new cycle only when something is due.
    const dueCount = one(
      `SELECT COUNT(*) AS c FROM tracked
       WHERE enabled=1 AND (nextRunAt IS NULL OR nextRunAt <= ?)`
      , [now]
    )?.c || 0;
    if (!dueCount) return;

    const items = all(
      `SELECT entityType, entityLower, entityName, intervalMinutes
       FROM tracked
       WHERE enabled=1
       ORDER BY entityType ASC, entityName COLLATE NOCASE ASC`
    ) || [];
    cycle = {
      startedAt: now,
      startedAtMs: nowMs,
      total: items.length,
      done: 0,
      items,
    };
    try{ globalThis.__idleclansTrackedCycle = cycle; }catch{}
  }

  const idx = Number(cycle.done || 0);
  const item = cycle.items?.[idx];
  if (!item){
    try{ globalThis.__idleclansTrackedCycle = null; }catch{}
    return;
  }

  const interval = Number(item.intervalMinutes ?? intervalDefault ?? 10);
  const nextRunAtIso = new Date((cycle.startedAtMs || nowMs) + interval * 60000).toISOString();

  // Align nextRunAt to the cycle start (so the next pass is predictable).
  exec(
    "UPDATE tracked SET nextRunAt=?, intervalMinutes=? WHERE entityType=? AND entityLower=?",
    [nextRunAtIso, interval, item.entityType, item.entityLower]
  );
  saveDb();

  // Expose runtime info for dashboards (best-effort only).
  try{
    globalThis.__idleclansTrackedCurrent = {
      entityType: item.entityType,
      entityLower: item.entityLower,
      entityName: item.entityName,
      startedAt: new Date().toISOString(),
      cycleStartedAt: cycle.startedAt,
      cycleIndex: idx + 1,
      cycleTotal: cycle.total,
    };
  }catch{}

  try{
    await runner({ entityType: item.entityType, entityName: item.entityName });
    try{
      globalThis.__idleclansTrackedLast = {
        entityType: item.entityType,
        entityLower: item.entityLower,
        entityName: item.entityName,
        finishedAt: new Date().toISOString(),
        ok: true,
      };
    }catch{}
  }catch(err){
    try{
      globalThis.__idleclansTrackedLast = {
        entityType: item.entityType,
        entityLower: item.entityLower,
        entityName: item.entityName,
        finishedAt: new Date().toISOString(),
        ok: false,
        error: String(err?.message||err),
      };
    }catch{}
    throw err;
  } finally {
    try{ globalThis.__idleclansTrackedCurrent = null; }catch{}
    try{
      const cur = globalThis.__idleclansTrackedCycle;
      if (cur && cur.startedAt === cycle.startedAt){
        cur.done = (Number(cur.done || 0) + 1);
        globalThis.__idleclansTrackedCycle = cur;
        // Auto-clear when done.
        if (cur.done >= cur.total){
          globalThis.__idleclansTrackedCycle = { ...cur, completedAt: new Date().toISOString() };
        }
      }
    }catch{}
  }
}

// ── Market + News (extracted to services/market.js) ───────────────────────────
export const fetchLatestNews       = (...a) => _fetchLatestNews(...a);
export const listNews              = (...a) => _listNews(...a);
export const fetchMarketPrices     = (...a) => _fetchMarketPrices(...a);
export const getMarketSnapshot     = (...a) => _getMarketSnapshot(...a);
export const getMarketPriceChanges = (...a) => _getMarketPriceChanges(...a);
export const getMarketTopVolume    = (...a) => _getMarketTopVolume(...a);
export const getMarketHistory      = (...a) => _getMarketHistory(...a);


// ── Verified Accounts ─────────────────────────────────────────────────────────
// JWT functions imported from ./api/client.js

// ── Accounts (extracted to services/accounts.js) ─────────────────────────────
export const verifyAccountToken      = (...a) => _verifyAccountToken(...a);
export const listVerifiedAccounts    = (...a) => _listVerifiedAccounts(...a);
export const removeVerifiedAccount   = (...a) => _removeVerifiedAccount(...a);
export const getFirstLinkedAccount   = (...a) => _getFirstLinkedAccount(...a);
export const snapshotAccountSkills   = (...a) => _snapshotAccountSkills(...a);
export const getAccountSkillHistory  = (...a) => _getAccountSkillHistory(...a);
export const getAccountSkillLatest   = (...a) => _getAccountSkillLatest(...a);
export const pruneAccountSkillHistory= (...a) => _pruneAccountSkillHistory(...a);


export async function importData(payload){
  // If a file path is provided, stream from disk (prevents freezing/huge IPC payloads)
  if (payload?.path){
    return importDataFromFile({
      filePath: payload.path,
      mode: payload.mode || "auto",
      signal: payload.signal,
      onProgress: payload.onProgress,
    });
  }

  const mode = payload?.mode || "auto";
  const text = String(payload?.text || "");
  let obj = null;

  // auto detect json
  if (mode === "auto" || mode === "exportJson"){
    try{ obj = JSON.parse(text); }catch{ obj = null; }
  }

  const importedAt = nowIso();

  if (obj && typeof obj === "object"){
    // try common shapes
    const players = Array.isArray(obj.players) ? obj.players
      : (Array.isArray(obj.playerProfiles) ? obj.playerProfiles
      : (Array.isArray(obj.player_profiles) ? obj.player_profiles : []));
    const clans = Array.isArray(obj.clans) ? obj.clans : (Array.isArray(obj.clanProfiles) ? obj.clanProfiles : []);
    for (const p of players){
      if (!p) continue;
      const norm = normalizePlayerRecord(p);
      if (!norm) continue;
      const username = norm.username || norm.name || norm.playerName;
      if (!username) continue;
      upsertPlayerBasic(username, norm.guildName || norm.clanName || null, norm, importedAt);
    }
    for (const c of clans){
      if (!c) continue;
      const clanName = c.clanName || c.name;
      if (!clanName) continue;
      upsertClanBasic(clanName, c.tag || null, c, importedAt);
      if (Array.isArray(c.memberlist)){
        upsertClanMembers(clanName, c.memberlist, importedAt);
      }
    }
    saveDb();
    return { ok:true };
  }

  // text list modes
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (mode === "playersText"){
    for (const line of lines) upsertPlayerBasic(line, null, { username: line }, importedAt);
  } else if (mode === "clansText"){
    for (const line of lines) upsertClanBasic(line, null, { clanName: line }, importedAt);
  } else {
    // auto: decide by line count and capitals - fallback store as players
    for (const line of lines) upsertPlayerBasic(line, null, { username: line }, importedAt);
  }

  saveDb();
  return { ok:true };
}

function normalizePlayerRecord(raw){
  if (!raw) return null;

  // Wrapper format from your JSON: { lowerName, name, dataJson: "{...}", lastUpdated }
  if (typeof raw === "object" && typeof raw.dataJson === "string"){
    try{
      const parsed = JSON.parse(raw.dataJson);
      if (parsed && typeof parsed === "object"){
        // carry useful metadata forward
        if (!parsed.username) parsed.username = raw.name || raw.lowerName;
        if (raw.lastUpdated && !parsed._lastUpdated) parsed._lastUpdated = raw.lastUpdated;
        return parsed;
      }
    }catch{
      // fallthrough
    }
  }

  // Already a normal player object
  if (typeof raw === "object") return raw;
  return null;
}

async function importDataFromFile({ filePath, mode, signal, onProgress }){
  const stat = fs.statSync(filePath);
  const totalBytes = stat.size;
  const importedAt = nowIso();

  const report = (p)=>{
    try{ onProgress?.(p); }catch{}
  };

  const firstChar = await sniffFirstNonWhitespaceChar(filePath);
  if (signal?.aborted) throw new Error("Import cancelled");

  // Text list modes: stream lines (no huge memory)
  if (mode === "playersText" || mode === "clansText"){
    report({ phase:"readingText", totalBytes, bytesRead:0 });
    await importTextLines({ filePath, totalBytes, signal, onProgress: report, mode, importedAt });
    saveDb();
    return { ok:true };
  }

  // Auto-detect: JSON object/array
  if (firstChar !== "{" && firstChar !== "["){
    // fallback: treat as playersText
    await importTextLines({ filePath, totalBytes, signal, onProgress: report, mode:"playersText", importedAt });
    saveDb();
    return { ok:true };
  }

  // JSON array at root: stream items once
  if (firstChar === "["){
    let playersImported = 0;
    let clansImported = 0;
    await streamJsonArray(filePath, totalBytes, signal, report, (item)=>{
      if (!item || typeof item !== "object") return;
      // Try decoding wrapper player records (player_profiles style)
      const norm = normalizePlayerRecord(item);
      const candidate = norm || item;
      // Heuristic: player has username; clan has clanName or memberlist
      const username = candidate.username || candidate.name || candidate.playerName;
      const clanName = candidate.clanName || candidate.guildName;
      const looksLikeClan = !!(candidate.memberlist || candidate.tag || candidate.clanName) && !candidate.skillExperiences;

      if (username && !looksLikeClan){
        upsertPlayerBasic(username, candidate.guildName || candidate.clanName || null, candidate, importedAt);
        playersImported++;
      } else if (clanName || looksLikeClan){
        const cn = candidate.clanName || candidate.guildName || candidate.name;
        if (cn){
          upsertClanBasic(cn, candidate.tag || null, candidate, importedAt);
          if (Array.isArray(candidate.memberlist)) upsertClanMembers(cn, candidate.memberlist, importedAt);
          clansImported++;
        }
      }
      if ((playersImported + clansImported) % 250 === 0){
        report({ phase:"importing", playersImported, clansImported });
      }
    });
    report({ phase:"importing", playersImported, clansImported });
    saveDb();
    return { ok:true, playersImported, clansImported };
  }

    // JSON object at root: stream players and clans without loading whole file
  let playersImported = 0;
  let clansImported = 0;

  // Pass 1: players (try common array keys, then common object/map keys)
  report({ phase:"importingPlayers", totalBytes, bytesRead:0 });

  const playerArrayKeys = ["players", "playerProfiles", "player_profiles", "profiles", "playerData", "userProfiles", "users"];
  for (const key of playerArrayKeys){
    if (playersImported > 0) break;
    report({ phase:"importingPlayers", note:`Trying ${key}[]` });
    playersImported = await streamJsonArrayAtKey(filePath, totalBytes, signal, report, key, (p)=>{
      if (!p || typeof p !== "object") return;
      const norm = normalizePlayerRecord(p);
      if (!norm) return;
      const username = norm.username || norm.name || norm.playerName;
      if (!username) return;
      upsertPlayerBasic(username, norm.guildName || norm.clanName || null, norm, importedAt);
    });
  }

  if (playersImported === 0){
    const playerObjectKeys = ["playersByName", "playersMap", "profilesByName", "players", "profiles"];
    for (const key of playerObjectKeys){
      if (playersImported > 0) break;
      report({ phase:"importingPlayers", note:`Trying ${key}{}` });
      playersImported = await streamJsonObjectAtKey(filePath, totalBytes, signal, report, key, (k, p)=>{
        if (!p || typeof p !== "object") return;
        const norm = normalizePlayerRecord(p) || p;
        const username = norm.username || norm.name || norm.playerName || k;
        if (!username) return;
        upsertPlayerBasic(username, norm.guildName || norm.clanName || null, { ...norm, username }, importedAt);
      });
    }
  }

  // Pass 2: clans (try common array keys)
  report({ phase:"importingClans", totalBytes, bytesRead:0 });

  const clanArrayKeys = ["clans", "clanProfiles", "guilds"];
  for (const key of clanArrayKeys){
    if (clansImported > 0) break;
    report({ phase:"importingClans", note:`Trying ${key}[]` });
    clansImported = await streamJsonArrayAtKey(filePath, totalBytes, signal, report, key, (c)=>{
      if (!c || typeof c !== "object") return;
      const clanName = c.clanName || c.name;
      if (!clanName) return;
      upsertClanBasic(clanName, c.tag || null, c, importedAt);
      if (Array.isArray(c.memberlist)) upsertClanMembers(clanName, c.memberlist, importedAt);
    });
  }

  saveDb();
  return { ok:true, playersImported, clansImported };
}

async function sniffFirstNonWhitespaceChar(filePath){
  const fd = fs.openSync(filePath, "r");
  try{
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.subarray(0, n).toString("utf-8");
    for (let i=0;i<s.length;i++){
      const ch = s[i];
      if (!/\s/.test(ch)) return ch;
    }
    return "";
  } finally {
    fs.closeSync(fd);
  }
}

async function importTextLines({ filePath, totalBytes, signal, onProgress, mode, importedAt }){
  const rs = fs.createReadStream(filePath, { encoding:"utf-8" });
  let bytesRead = 0;
  let buf = "";
  let imported = 0;
  let lastReport = 0;

  const maybeReport = ()=>{
    const now = Date.now();
    if (now - lastReport < 200) return;
    lastReport = now;
    onProgress({ phase:"readingText", bytesRead, totalBytes, imported });
  };

  rs.on("data", (chunk)=>{
    if (signal?.aborted) rs.destroy(new Error("Import cancelled"));
    bytesRead += Buffer.byteLength(chunk, "utf-8");
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0){
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const name = line.split(",")[0].trim();
      if (!name) continue;
      if (mode === "playersText") upsertPlayerBasic(name, null, { username:name }, importedAt);
      if (mode === "clansText") upsertClanBasic(name, null, { clanName:name }, importedAt);
      imported++;
      if (imported % 500 === 0) maybeReport();
    }
    maybeReport();
  });

  await new Promise((resolve, reject)=>{
    rs.on("end", ()=>{
      const last = buf.trim();
      if (last){
        const name = last.split(",")[0].trim();
        if (name){
          if (mode === "playersText") upsertPlayerBasic(name, null, { username:name }, importedAt);
          if (mode === "clansText") upsertClanBasic(name, null, { clanName:name }, importedAt);
          imported++;
        }
      }
      onProgress({ phase:"readingText", bytesRead: totalBytes, totalBytes, imported });
      resolve();
    });
    rs.on("error", reject);
  });
}

async function streamJsonArray(filePath, totalBytes, signal, onProgress, onItem){
  const rs = fs.createReadStream(filePath);
  let bytesRead = 0;
  let lastReport = 0;

  rs.on("data", (chunk)=>{
    bytesRead += chunk.length;
    if (signal?.aborted) rs.destroy(new Error("Import cancelled"));
    const now = Date.now();
    if (now - lastReport > 200){
      lastReport = now;
      onProgress({ phase:"parsing", bytesRead, totalBytes });
    }
  });

  const sArray = StreamArray.withParser();
  sArray.on("data", ({ value })=>{
    if (signal?.aborted) return;
    onItem(value);
  });

  await pipeline(rs, sArray);
  onProgress({ phase:"parsing", bytesRead: totalBytes, totalBytes });
}

async function streamJsonArrayAtKey(filePath, totalBytes, signal, onProgress, key, onItem){
  const rs = fs.createReadStream(filePath);
  let bytesRead = 0;
  let lastReport = 0;
  let imported = 0;

  rs.on("data", (chunk)=>{
    bytesRead += chunk.length;
    if (signal?.aborted) rs.destroy(new Error("Import cancelled"));
    const now = Date.now();
    if (now - lastReport > 200){
      lastReport = now;
      onProgress({ phase:"parsing", bytesRead, totalBytes, key, imported });
    }
  });

  const p = parser();
  const pick = new Pick({ filter: key });
  const sArray = new StreamArray();

  sArray.on("data", ({ value })=>{
    if (signal?.aborted) return;
    onItem(value);
    imported++;
    if (imported % 250 === 0){
      onProgress({ phase:"importing", key, imported });
    }
  });

  await pipeline(rs, p, pick, sArray);
  onProgress({ phase:"parsing", bytesRead: totalBytes, totalBytes, key, imported });
  return imported;
}

async function streamJsonObjectAtKey(filePath, totalBytes, signal, onProgress, key, onEntry){
  const rs = fs.createReadStream(filePath);
  let bytesRead = 0;
  let lastReport = 0;
  let imported = 0;

  rs.on("data", (chunk)=>{
    bytesRead += chunk.length;
    if (signal?.aborted) rs.destroy(new Error("Import cancelled"));
    const now = Date.now();
    if (now - lastReport > 200){
      lastReport = now;
      onProgress({ phase:"parsing", bytesRead, totalBytes, key, imported });
    }
  });

  const p = parser();
  const pick = new Pick({ filter: key });
  const sObj = new StreamObject();

  sObj.on("data", ({ key: k, value })=>{
    if (signal?.aborted) return;
    onEntry(k, value);
    imported++;
    if (imported % 250 === 0){
      onProgress({ phase:"importing", key, imported });
    }
  });

  await pipeline(rs, p, pick, sObj);
  onProgress({ phase:"parsing", bytesRead: totalBytes, totalBytes, key, imported });
  return imported;
}

// normaliseEquipment, ensureClanGameMode, log, upsertPlayerBasic,
// upsertClanBasic, upsertClanMembers imported from ./shared/helpers.js

// API_BASE, API_STARTUP_INFO, sleep/sleepMs/abortError/isTransientFetchError imported from ./api/client.js
// rateLimit and getApiRateStats stay here because they depend on getSettings()

let lastApiAt = 0;
const apiCallLog = [];
const API_CALL_LOG_WINDOW_MS = 120000; // 2-minute rolling window

export function getApiRateStats(){
  const now = Date.now();
  const cutoff = now - API_CALL_LOG_WINDOW_MS;
  while (apiCallLog.length && apiCallLog[0] < cutoff) apiCallLog.shift();
  const count = apiCallLog.length;
  const s = getSettings();
  const configuredPerMin = Math.max(1, Math.min(60, Number(s.apiCallsPerMinute ?? 15)));
  const minDelayMs = Math.ceil(60000 / configuredPerMin);
  const spanMs = count > 1 ? (now - apiCallLog[0]) : 0;
  const observedPerMin = count > 1 && spanMs > 0
    ? Math.round((count / (spanMs / 60000)) * 10) / 10
    : 0;
  return {
    configuredPerMin,
    minDelayMs,
    observedPerMin,
    recentCalls: count,
    lastCallAt: apiCallLog.length ? apiCallLog[apiCallLog.length - 1] : null,
  };
}

// Serialize *all* API calls across the whole app.
// Without this, concurrent calls can burst (many calls see the same lastApiAt)
// and trip server-side 429s even when a per-minute setting looks safe.
let apiRateLimitChain = Promise.resolve();

// abortError, sleep, sleepMs, parseRetryAfterMs, isTransientFetchError imported from ./api/client.js

async function rateLimit(signal){
  // Chain to ensure calls are spaced even when multiple async flows call the API at once.
  const work = apiRateLimitChain.then(async ()=>{
    const s = getSettings();
    const callsPerMin = Math.max(1, Math.min(60, Number(s.apiCallsPerMinute ?? 15)));
    const minDelay = Math.ceil(60000 / callsPerMin);
    const wait = Math.max(0, (lastApiAt + minDelay) - Date.now());
    if (wait > 0) await sleep(wait, signal);
    // Important: update after waiting, while still holding our place in the chain.
    lastApiAt = Date.now();
    apiCallLog.push(lastApiAt);
    if (apiCallLog.length > 500) apiCallLog.shift();
  });

  // Keep the chain alive even if a caller aborts/errors.
  apiRateLimitChain = work.catch(()=>{});
  return work;
}

// apiGetJson and apiGetJsonAllow404 are wrappers defined at the top of this file
// that inject rateLimit into the versions from ./api/client.js

// ------------------------------------------------------------------
// Server info
// ------------------------------------------------------------------
export async function getServerInfo({ signal } = {}){
  // Example response:
  // {
  //   buildVersionInfo:{ requiredBuildVersion, latestBuildVersion, configVersion },
  //   serverInfo:{ recommendedServerAddress, allServers:[{displ...address,currentPlayers,maxPlayers,loadPercentage,isAvailable}] }
  // }
  const data = await apiGetJson(API_STARTUP_INFO, { signal, retries: 3 });

  // Persist a population sample for "all-time high" + daily averages graph.
  try{
    const si = data?.serverInfo ?? data;
    const all = Array.isArray(si?.allServers) ? si.allServers : [];
    const totalPlayers = all.reduce((sum, s)=>sum + Number(s?.currentPlayers || 0), 0);
    exec(
      "INSERT INTO server_population_samples(sampledAt, totalPlayers, rawJson) VALUES(?,?,?)",
      [Date.now(), Math.max(0, Math.floor(totalPlayers)), JSON.stringify(data)]
    );
  }catch{
    // ignore sample write failures (should never block UI)
  }

  return data;
}

export async function getServerPopulationStats({ days = 30 } = {}){
  const nDays = Math.max(1, Math.min(365, Number(days) || 30));
  const since = Date.now() - nDays * 24 * 60 * 60 * 1000;

  // All-time high
  let allTimeHigh = null;
  let allTimeHighAt = null;
  try{
    const row = all(`SELECT totalPlayers, sampledAt
                     FROM server_population_samples
                     ORDER BY totalPlayers DESC, sampledAt DESC
                     LIMIT 1`)[0];
    if (row){
      allTimeHigh = Number(row.totalPlayers || 0);
      allTimeHighAt = row.sampledAt ? new Date(Number(row.sampledAt)).toISOString() : null;
    }
  }catch{}

  // Daily averages (UTC day buckets)
  let daily = [];
  try{
    daily = all(
      `SELECT strftime('%Y-%m-%d', sampledAt/1000, 'unixepoch') AS day,
              AVG(totalPlayers) AS avgPlayers
       FROM server_population_samples
       WHERE sampledAt >= ?
       GROUP BY day
       ORDER BY day ASC`,
      [since]
    ).map(r=>({ day: String(r.day), avgPlayers: Number(r.avgPlayers || 0) }));
  }catch{}

  return { allTimeHigh, allTimeHighAt, daily };
}




//
// ------------------------------------------------------------------
// Leaderboard API + cache helpers
// ------------------------------------------------------------------
function leaderboardBoardKey(entityType, gameMode, category){
  return `${String(entityType||"").trim()}:${String(gameMode||"default").trim()}|${String(category||"").trim()}`;
}

function parseBoardKey(boardKey){
  const bk = String(boardKey||"");
  const [left, category] = bk.split("|");
  const [entityType, gameMode] = String(left||"").split(":");
  return { entityType: entityType || "", gameMode: gameMode || "default", category: category || "" };
}

function leaderboardUrl({ entityType, gameMode, category, startCount, maxCount }){
  const lbName = `${String(entityType)}:${String(gameMode)}`;
  const cat = String(category||"");
  const start = Number(startCount||1);
  const max = Number(maxCount||100);
  return `${API_BASE}/Leaderboard/top/${encodeURIComponent(lbName)}/${encodeURIComponent(cat)}?startCount=${start}&maxCount=${max}`;
}

function extractLeaderboardName(row){
  if (!row || typeof row !== "object") return "";
  return String(
    row.username ??
    row.playerName ??
    row.memberName ??
    row.clanName ??
    row.guildName ??
    row.name ??
    row.petName ??
    ""
  ).trim();
}

function normalizeLeaderboardRow(row){
  const name = extractLeaderboardName(row);
  const level = (row && typeof row === "object") ? Number(row.level ?? row.totalLevel ?? row.value ?? null) : null;
  const score = (row && typeof row === "object") ? Number(row.score ?? row.exp ?? row.points ?? null) : null;
  const expCapDate = (row && typeof row === "object") ? Number(row.expCapDate ?? 0) : 0;
  return {
    name,
    nameLower: lower(name),
    level: Number.isFinite(level) ? level : null,
    score: Number.isFinite(score) ? score : null,
    expCapDate: Number.isFinite(expCapDate) ? expCapDate : 0,
    raw: row || null,
  };
}

function upsertPlayerStubFromLeaderboard(name, gameMode){
  const nm = String(name||"").trim();
  if (!nm) return false;
  const ln = lower(nm);
  const existed = !!one(`SELECT 1 AS x FROM players WHERE lowerName=?`, [ln]);
  const now = nowIso();
  exec(
    `INSERT INTO players(lowerName, username, gameMode, guildName, profileJson, updatedAt, bannedAt, createdAt)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(lowerName) DO UPDATE SET username=excluded.username`,
    [ln, nm, gameMode || null, null, null, now, null, now]
  );
  return !existed;
}

function upsertClanStubFromLeaderboard(name, gameMode){
  const nm = String(name||"").trim();
  if (!nm) return false;
  const ln = lower(nm);
  const existed = !!one(`SELECT 1 AS x FROM clans WHERE lowerName=?`, [ln]);
  const now = nowIso();
  exec(
    `INSERT INTO clans(lowerName, clanName, gameMode, tag, dataJson, updatedAt, createdAt)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(lowerName) DO UPDATE SET clanName=excluded.clanName`,
    [ln, nm, gameMode || null, null, null, now, now]
  );
  return !existed;
}

export function getLeaderboardScanState(boardKey){
  const bk = String(boardKey||"");
  const r = one(`SELECT * FROM leaderboard_scan_state WHERE boardKey=? LIMIT 1`, [bk]);
  if (!r) return null;
  return {
    boardKey: r.boardKey,
    entityType: r.entityType,
    gameMode: r.gameMode,
    category: r.category,
    nextStartCount: Number(r.nextStartCount||1),
    nextMaxCount: Number(r.nextMaxCount||100),
    status: r.status,
    lastUpdatedAt: r.lastUpdatedAt || null,
    lastError: r.lastError || null,
    lastRank: r.lastRank ? Number(r.lastRank) : null,
    lastNameLower: r.lastNameLower || null,
  };
}

export function listLeaderboardBoards(){
  // Boards we have cached or have scan state for.
  const rows = all(`
    SELECT boardKey, MAX(capturedAt) AS lastCapturedAt, COUNT(1) AS rows
    FROM leaderboard_cache
    GROUP BY boardKey
    UNION
    SELECT boardKey, lastUpdatedAt AS lastCapturedAt, 0 AS rows
    FROM leaderboard_scan_state
    WHERE boardKey NOT IN (SELECT DISTINCT boardKey FROM leaderboard_cache)
    ORDER BY lastCapturedAt DESC
  `);
  return rows.map(r=>({
    boardKey: r.boardKey,
    lastCapturedAt: r.lastCapturedAt || null,
    rows: Number(r.rows||0),
    ...parseBoardKey(r.boardKey),
  }));
}

export function getLeaderboardCache({ boardKey, limit=250, offset=0, nameQuery=null } = {}){
  const bk = String(boardKey||"");
  const q = (nameQuery === null || nameQuery === undefined) ? null : String(nameQuery).trim();
  const qLower = q ? q.toLowerCase() : null;
  const like = qLower ? `%${qLower.replace(/%/g, "\\%").replace(/_/g, "\\_")}%` : null;

  const n = Math.max(1, Math.min(5000, Number(limit||250)));
  const off = Math.max(0, Number(offset||0));

  const where = qLower
    ? `WHERE boardKey=? AND nameLower LIKE ? ESCAPE '\\'`
    : `WHERE boardKey=?`;
  const args = qLower ? [bk, like, n, off] : [bk, n, off];

  const rows = all(
    `SELECT boardKey, rank, name, level, score, expCapDate, capturedAt
     FROM leaderboard_cache
     ${where}
     ORDER BY rank ASC
     LIMIT ? OFFSET ?`,
    args
  );

  const last = qLower
    ? one(
      `SELECT MAX(capturedAt) AS t, COUNT(1) AS n
       FROM leaderboard_cache
       WHERE boardKey=? AND nameLower LIKE ? ESCAPE '\\'`,
      [bk, like]
    )
    : one(`SELECT MAX(capturedAt) AS t, COUNT(1) AS n FROM leaderboard_cache WHERE boardKey=?`, [bk]);

  return {
    boardKey: bk,
    nameQuery: q || "",
    lastCapturedAt: last?.t || null,
    totalRows: Number(last?.n||0),
    rows: rows.map(r=>({
      rank: Number(r.rank),
      name: r.name,
      level: r.level !== null && r.level !== undefined ? Number(r.level) : null,
      score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
      expCapDate: r.expCapDate !== null && r.expCapDate !== undefined ? Number(r.expCapDate) : 0,
      capturedAt: r.capturedAt,
    })),
  };
}

export function clearLeaderboardCache(boardKey){
  const bk = String(boardKey||"");
  exec(`DELETE FROM leaderboard_cache WHERE boardKey=?`, [bk]);
  saveDb();
  return { ok:true };
}

// Returns every cached leaderboard row for a given player/clan name, across
// all boards (game modes + categories). Used by PlayerDetailPage /
// ClanDetailPage to surface "Leaderboard standings" without requiring a full
// profile re-scan — leaderboard scans are a separate, standalone data source
// (rank/level/score per board) that doesn't otherwise touch players/clans.
export function getEntityLeaderboardStandings(name, { entityType=null } = {}){
  const ln = lower(String(name||"").trim());
  if (!ln) return { rows: [] };

  const rows = all(
    `SELECT boardKey, rank, name, level, score, expCapDate, capturedAt
     FROM leaderboard_cache
     WHERE nameLower=?
     ORDER BY boardKey ASC, rank ASC`,
    [ln]
  );

  const out = rows.map(r => {
    const { entityType: et, gameMode, category } = parseBoardKey(r.boardKey);
    return {
      boardKey: r.boardKey,
      entityType: et,
      gameMode,
      category,
      rank: Number(r.rank),
      name: r.name,
      level: r.level !== null && r.level !== undefined ? Number(r.level) : null,
      score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
      expCapDate: r.expCapDate !== null && r.expCapDate !== undefined ? Number(r.expCapDate) : 0,
      capturedAt: r.capturedAt,
    };
  });

  // Optionally filter to a specific entity type (players/clans/pets) — useful
  // since the same name could theoretically appear on a pet board too.
  const filtered = entityType ? out.filter(r => r.entityType === String(entityType)) : out;

  return { rows: filtered };
}

// Pushes a board's freshly-cached leaderboard rows onto the matching
// players/clans records (leaderboardStandingsJson column), so a player's or
// clan's profile reflects their leaderboard rank/level/score for that board
// without requiring a separate API re-fetch. Called automatically when a
// leaderboard scan finishes (status "completed") for entityType
// "players"/"clans" (pets have no profile table to update).
//
// Each entity's leaderboardStandingsJson is a map of
// "<gameMode>|<category>" -> { rank, level, score, expCapDate, capturedAt,
// category, gameMode }, merged in (existing entries for other boards are
// preserved; only this board's key is replaced).
export function syncLeaderboardStandingsToProfiles(boardKey){
  const { entityType, gameMode, category } = parseBoardKey(boardKey);
  if (entityType !== "players" && entityType !== "clans") return { ok:true, updated:0, skipped:"unsupported entityType" };

  const table = entityType === "players" ? "players" : "clans";
  const rows = all(
    `SELECT rank, nameLower, name, level, score, expCapDate, capturedAt
     FROM leaderboard_cache WHERE boardKey=?`,
    [boardKey]
  );
  if (!rows.length) return { ok:true, updated:0 };

  const standingKey = `${gameMode}|${category}`;
  const now = nowIso();
  let updated = 0;

  for (const r of rows){
    const ln = r.nameLower;
    if (!ln) continue;

    const existingRow = one(`SELECT leaderboardStandingsJson FROM ${table} WHERE lowerName=?`, [ln]);
    if (!existingRow) continue; // entity not in our DB — importMissing handles creation separately

    let standings = {};
    try{ standings = JSON.parse(existingRow.leaderboardStandingsJson || "{}") || {}; }catch{ standings = {}; }
    if (typeof standings !== "object" || Array.isArray(standings)) standings = {};

    standings[standingKey] = {
      category,
      gameMode,
      rank: Number(r.rank),
      level: r.level !== null && r.level !== undefined ? Number(r.level) : null,
      score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
      expCapDate: r.expCapDate !== null && r.expCapDate !== undefined ? Number(r.expCapDate) : 0,
      capturedAt: r.capturedAt,
    };

    exec(
      `UPDATE ${table} SET leaderboardStandingsJson=?, leaderboardStandingsAt=? WHERE lowerName=?`,
      [JSON.stringify(standings), now, ln]
    );
    updated++;
  }

  if (updated > 0) saveDb();
  return { ok:true, updated, boardKey, total: rows.length };
}

// Performs a full profile refresh (the same API call used when manually
// looking up a player/clan) for every name cached for a board. This is the
// "real" data update the user wants — leaderboard scans only return
// rank/level/score, not the full profile (skills, equipment, members, etc).
// Refreshing every entity on a board can mean hundreds or thousands of API
// calls, so this:
//  - respects the existing apiCallsPerMinute rate limit (lookupPlayerLive /
//    lookupClanLive both go through the shared rate-limit chain)
//  - is abortable via `signal` (checked between each entity)
//  - reports progress via progressCb({ phase:"refreshing", current, total, name })
//  - never throws on a single entity's failure — logs and continues, so one
//    bad/renamed name doesn't abort refreshing the rest of the board
export async function refreshProfilesFromLeaderboard(boardKey, { signal, progressCb } = {}){
  const { entityType } = parseBoardKey(boardKey);
  if (entityType !== "players" && entityType !== "clans"){
    return { ok:true, refreshed:0, failed:0, total:0, skipped:"unsupported entityType" };
  }

  const rows = all(`SELECT name FROM leaderboard_cache WHERE boardKey=? ORDER BY rank ASC`, [boardKey]);
  const total = rows.length;
  if (!total) return { ok:true, refreshed:0, failed:0, total:0 };

  let refreshed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++){
    if (signal?.aborted) throw abortError();
    const name = rows[i]?.name;
    if (!name) continue;

    try{
      if (entityType === "players"){
        await _lookupPlayerLive(name, { signal });
      } else {
        await _lookupClanLive(name, { signal });
      }
      refreshed++;
    }catch(err){
      if (err?.name === "AbortError") throw err;
      failed++;
      console.warn(`[leaderboard] profile refresh failed for ${entityType==="players"?"player":"clan"} "${name}":`, err?.message || err);
    }

    if (progressCb){
      progressCb({
        boardKey, running:true, phase:"refreshing",
        current: i + 1, total, refreshed, failed, name,
      });
    }
  }

  return { ok:true, refreshed, failed, total };
}

// ------------------------------------------------------------------
// Leaderboard snapshots (DB-backed baselines for repeatable correlation)
// ------------------------------------------------------------------

export function listLeaderboardSnapshots({ boardKey, limit=25, offset=0 } = {}){
  const bk = String(boardKey||"").trim();
  if (!bk) return [];
  // Allow the UI to page/expand large histories for investigator workflows.
  const lim = Math.max(1, Math.min(5000, Number(limit||25)));
  const off = Math.max(0, Math.min(1000000, Number(offset||0)));
  const rows = all(
    `SELECT id, boardKey, title, createdAt, source, sourceJobId, note, rowCount
     FROM leaderboard_snapshots
     WHERE boardKey=?
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`,
    [bk, lim, off]
  );
  return rows.map(r=>({
    id: Number(r.id),
    boardKey: r.boardKey,
    title: r.title || null,
    createdAt: r.createdAt,
    source: r.source || null,
    sourceJobId: r.sourceJobId !== null && r.sourceJobId !== undefined ? Number(r.sourceJobId) : null,
    note: r.note || null,
    rowCount: Number(r.rowCount||0),
  }));
}

// Count snapshots for a board (used for pagination / badges in the UI)
export function countLeaderboardSnapshots({ boardKey } = {}){
  const bk = String(boardKey||"").trim();
  if (!bk) return 0;
  // Use the same DB helper used elsewhere in this file.
  // ("get" was referenced in an earlier refactor but is not defined here.)
  const row = one(`SELECT COUNT(1) AS c FROM leaderboard_snapshots WHERE boardKey=?`, [bk]);
  return Number(row?.c || 0);
}

export function getLeaderboardSnapshot({ snapshotId } = {}){
  const id = Number(snapshotId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const r = one(
    `SELECT id, boardKey, title, createdAt, source, sourceJobId, note, rowCount
     FROM leaderboard_snapshots
     WHERE id=? LIMIT 1`,
    [id]
  );
  if (!r) return null;
  return {
    id: Number(r.id),
    boardKey: r.boardKey,
    title: r.title || null,
    createdAt: r.createdAt,
    source: r.source || null,
    sourceJobId: r.sourceJobId !== null && r.sourceJobId !== undefined ? Number(r.sourceJobId) : null,
    note: r.note || null,
    rowCount: Number(r.rowCount||0),
  };
}

export function getLeaderboardSnapshotRows({ snapshotId, limit=5000, offset=0, nameQuery=null } = {}){
  const id = Number(snapshotId);
  if (!Number.isFinite(id) || id <= 0) return { ok:false, error:"Invalid snapshotId" };

  const q = (nameQuery === null || nameQuery === undefined) ? null : String(nameQuery).trim();
  const qLower = q ? q.toLowerCase() : null;
  const like = qLower ? `%${qLower.replace(/%/g, "\\%" ).replace(/_/g, "\\_" )}%` : null;

  const n = Math.max(1, Math.min(20000, Number(limit||5000)));
  const off = Math.max(0, Number(offset||0));

  const where = qLower
    ? `WHERE snapshotId=? AND nameLower LIKE ? ESCAPE '\\'`
    : `WHERE snapshotId=?`;
  const args = qLower ? [id, like, n, off] : [id, n, off];

  const rows = all(
    `SELECT rank, name, level, score, expCapDate, clanName, clanLower, clanSource, capturedAt
     FROM leaderboard_snapshot_rows
     ${where}
     ORDER BY rank ASC
     LIMIT ? OFFSET ?`,
    args
  );

  const meta = one(
    `SELECT s.boardKey AS boardKey, s.createdAt AS createdAt, s.rowCount AS rowCount
     FROM leaderboard_snapshots s
     WHERE s.id=?`,
    [id]
  );

  return {
    ok: true,
    snapshotId: id,
    boardKey: meta?.boardKey || null,
    createdAt: meta?.createdAt || null,
    totalRows: Number(meta?.rowCount||0),
    nameQuery: q || "",
    rows: rows.map(r=>({
      rank: Number(r.rank),
      name: r.name,
      clanName: r.clanName || null,
      clanLower: r.clanLower || null,
      clanSource: r.clanSource || null,
      level: r.level !== null && r.level !== undefined ? Number(r.level) : null,
      score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
      expCapDate: r.expCapDate !== null && r.expCapDate !== undefined ? Number(r.expCapDate) : 0,
      capturedAt: r.capturedAt,
    })),
  };
}

export function deleteLeaderboardSnapshot({ snapshotId } = {}){
  const id = Number(snapshotId);
  if (!Number.isFinite(id) || id <= 0) return { ok:false, error:"Invalid snapshotId" };

  // Remove rows first (FK constraints are not guaranteed).
  try{
    exec(`DELETE FROM leaderboard_snapshot_rows WHERE snapshotId=?`, [id]);
    exec(`DELETE FROM leaderboard_snapshots WHERE id=?`, [id]);
    // Clear watch backrefs if they point at this snapshot.
    exec(`UPDATE leaderboard_watches SET lastSnapshotId=NULL WHERE lastSnapshotId=?`, [id]);
    saveDb({ forceBackup:true });
    return { ok:true };
  }catch(err){
    return { ok:false, error:String(err?.message||err) };
  }
}

// ------------------------------------------------------------------
// Leaderboard watches (scheduled scans while the app is open)
// ------------------------------------------------------------------


function computeLeaderboardCacheSignature(boardKey, { sample=300 } = {}){
  const bk = String(boardKey||"").trim();
  const n = Math.max(50, Math.min(2000, Number(sample||300)));
  const meta = one(`SELECT COUNT(1) AS n, MAX(capturedAt) AS t FROM leaderboard_cache WHERE boardKey=?`, [bk]);
  const rowCount = Number(meta?.n||0);
  const rows = all(
    `SELECT rank, nameLower, score, level
     FROM leaderboard_cache
     WHERE boardKey=?
     ORDER BY rank ASC
     LIMIT ?`,
    [bk, n]
  );
  const parts = [String(rowCount)];
  for (const r of rows){
    parts.push(`${Number(r.rank)||0}:${String(r.nameLower||"")}:${r.score===null||r.score===undefined?"":String(r.score)}:${r.level===null||r.level===undefined?"":String(r.level)}`);
  }
  const raw = parts.join("|");
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  return { rowCount, signature: `n=${rowCount};h=${hash}` };
}

function normalizeWatch(r){
  if (!r) return null;
  return {
    id: Number(r.id),
    boardKey: r.boardKey,
    title: r.title || null,
    intervalMinutes: Number(r.intervalMinutes||10),
    enabled: Number(r.enabled||0) === 1,
    saveMode: r.saveMode || "always",
    retentionDays: r.retentionDays !== null && r.retentionDays !== undefined ? Number(r.retentionDays) : null,
    lastRunAt: r.lastRunAt || null,
    nextRunAt: r.nextRunAt || null,
    lastSignature: r.lastSignature || null,
    lastStatus: r.lastStatus || null,
    lastError: r.lastError || null,
    lastSnapshotId: r.lastSnapshotId !== null && r.lastSnapshotId !== undefined ? Number(r.lastSnapshotId) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function listLeaderboardWatches({ boardKey=null, enabled=null, limit=100 } = {}){
  const bk = boardKey ? String(boardKey).trim() : null;
  const lim = Math.max(1, Math.min(500, Number(limit||100)));
  const args = [];
  const where = [];
  if (bk){ where.push("boardKey=?"); args.push(bk); }
  if (enabled === true){ where.push("enabled=1"); }
  if (enabled === false){ where.push("enabled=0"); }
  const w = where.length ? (`WHERE ${where.join(" AND ")}`) : "";
  const rows = all(
    `SELECT * FROM leaderboard_watches ${w} ORDER BY enabled DESC, nextRunAt ASC, id DESC LIMIT ?`,
    [...args, lim]
  );
  return rows.map(normalizeWatch);
}

export function upsertLeaderboardWatch({ id=null, boardKey, title=null, intervalMinutes=10, enabled=false, saveMode="always", retentionDays=null } = {}){
  const bk = String(boardKey||"").trim();
  if (!bk) return { ok:false, error:"Missing boardKey" };
  const now = nowIso();
  const iv = Math.max(1, Math.min(24*60, Number(intervalMinutes||10)));
  const en = enabled ? 1 : 0;
  const sm = (String(saveMode||"always") === "ifChanged") ? "ifChanged" : "always";
  const rd = (retentionDays === null || retentionDays === undefined || retentionDays === "") ? null : Math.max(1, Math.min(3650, Number(retentionDays)));

  const ttl = (title !== null && title !== undefined && String(title).trim()) ? String(title).trim() : null;

  // When a user saves/enables a watch, we schedule the first automatic run *after* the interval,
  // not immediately. (Immediate runs are done via runLeaderboardWatchNow.)
  const nextDueIso = () => new Date(Date.now() + iv * 60 * 1000).toISOString();

  if (id){
    const cur = one(`SELECT * FROM leaderboard_watches WHERE id=?`, [Number(id)]);
    if (!cur) return { ok:false, error:"Watch not found" };
    // If enabling and nextRunAt is empty, schedule first run after the interval.
    const isFirstEnable = (en === 1 && !cur.nextRunAt);
    const nextRunAt = isFirstEnable ? nextDueIso() : (cur.nextRunAt || null);
    exec(
      `UPDATE leaderboard_watches
       SET boardKey=?, title=?, intervalMinutes=?, enabled=?, saveMode=?, retentionDays=?, nextRunAt=?, updatedAt=?
       WHERE id=?`,
      [bk, ttl, iv, en, sm, rd, nextRunAt, now, Number(id)]
    );
    // Make the watch row self-explanatory immediately after enabling.
    if (isFirstEnable){
      exec(`UPDATE leaderboard_watches SET lastStatus=?, lastError=NULL WHERE id=?`, ["scheduled", Number(id)]);
    }
    saveDb();
    return { ok:true, watch: normalizeWatch(one(`SELECT * FROM leaderboard_watches WHERE id=?`, [Number(id)])) };
  }

  const nextRunAt = en === 1 ? nextDueIso() : null;
  exec(
    `INSERT INTO leaderboard_watches(boardKey, title, intervalMinutes, enabled, saveMode, retentionDays, lastRunAt, nextRunAt, lastSignature, lastStatus, lastError, lastSnapshotId, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [bk, ttl, iv, en, sm, rd, null, nextRunAt, null, (en === 1 ? "scheduled" : null), null, null, now, now]
  );
  saveDb();
  const w = one(`SELECT * FROM leaderboard_watches ORDER BY id DESC LIMIT 1`);
  return { ok:true, watch: normalizeWatch(w) };
}

export function deleteLeaderboardWatch({ id } = {}){
  const wid = Number(id);
  if (!Number.isFinite(wid) || wid <= 0) return { ok:false, error:"Invalid id" };
  exec(`DELETE FROM leaderboard_watches WHERE id=?`, [wid]);
  saveDb();
  return { ok:true };
}

export function runLeaderboardWatchNow({ id } = {}){
  const wid = Number(id);
  if (!Number.isFinite(wid) || wid <= 0) return { ok:false, error:"Invalid id" };
  const now = nowIso();
  // Queue for immediate run. Also set a human-friendly status so the UI doesn't show blanks.
  exec(
    `UPDATE leaderboard_watches
     SET nextRunAt=?, enabled=1, lastStatus=?, lastError=NULL, updatedAt=?
     WHERE id=?`,
    [now, "queued", now, wid]
  );
  saveDb();
  return { ok:true, watch: normalizeWatch(one(`SELECT * FROM leaderboard_watches WHERE id=?`, [wid])) };
}

function cleanupWatchSnapshots({ watchId, retentionDays } = {}){
  const wid = Number(watchId);
  const rd = Number(retentionDays);
  if (!Number.isFinite(wid) || wid <= 0) return;
  if (!Number.isFinite(rd) || rd <= 0) return;
  const cutoff = new Date(Date.now() - rd * 24 * 60 * 60 * 1000).toISOString();
  // Delete snapshots created by this watch (source='watch' and sourceJobId=watchId).
  const old = all(
    `SELECT id FROM leaderboard_snapshots WHERE source='watch' AND sourceJobId=? AND createdAt < ?`,
    [wid, cutoff]
  );
  for (const r of old){
    try{ deleteLeaderboardSnapshot({ snapshotId: Number(r.id) }); }catch{}
  }
}

export async function runOneDueLeaderboardWatch(){
  // Avoid re-entrancy (scheduler ticks every few seconds).
  if (globalThis.__idleclansLeaderboardWatchRunner) return { ok:true, skipped:true, reason:"runner_busy" };
  globalThis.__idleclansLeaderboardWatchRunner = true;

  try{
    const now = nowIso();
    const due = one(
      `SELECT * FROM leaderboard_watches
       WHERE enabled=1 AND nextRunAt IS NOT NULL AND nextRunAt <= ?
       ORDER BY nextRunAt ASC, id ASC
       LIMIT 1`,
      [now]
    );
    if (!due){
      return { ok:true, skipped:true, reason:"no_due" };
    }

    const wid = Number(due.id);
    const interval = Math.max(1, Math.min(24*60, Number(due.intervalMinutes||10)));
    const next = new Date(Date.now() + interval * 60 * 1000).toISOString();
    // Mark running + schedule next immediately (even if scan fails, we don't hammer).
    exec(
      `UPDATE leaderboard_watches
       SET lastRunAt=?, nextRunAt=?, lastStatus='running', lastError=NULL, updatedAt=?
       WHERE id=?`,
      [now, next, now, wid]
    );
    saveDb();

    // If another leaderboard scan is running, skip this tick and retry soon.
    if (globalThis.__idleclansLeaderboardScanController){
      exec(
        `UPDATE leaderboard_watches
         SET lastStatus='skipped', lastError='Leaderboard scan already running', nextRunAt=?, updatedAt=?
         WHERE id=?`,
        [new Date(Date.now() + 30 * 1000).toISOString(), nowIso(), wid]
      );
      saveDb();
      return { ok:true, skipped:true, reason:"scan_busy", watchId: wid };
    }

    const bk = String(due.boardKey||"").trim();
    const { entityType, gameMode, category } = parseBoardKey(bk);
    const scanRes = await scanLeaderboardBoard({ entityType, gameMode, category, resume:true, importMissing:false, clearCache:false });
    const status = scanRes?.status || "completed";

    // Decide whether to create a snapshot.
    let createdSnapshot = null;
    let signature = null;
    let rowCount = 0;
    try{
      const sig = computeLeaderboardCacheSignature(bk, { sample: 300 });
      signature = sig.signature;
      rowCount = sig.rowCount;
    }catch{}

    const saveMode = (String(due.saveMode||"always") === "ifChanged") ? "ifChanged" : "always";
    const shouldSave = (status === "completed" || status === "stalled")
      ? (saveMode === "always" ? true : (signature && signature !== (due.lastSignature||null)))
      : false;

    if (shouldSave){
      const title = due.title || null;
      const note = saveMode === "ifChanged" ? "watch:changed" : "watch";
      const snapRes = createLeaderboardSnapshotFromCache({ boardKey: bk, title, note, source:"watch", sourceJobId: wid });
      if (snapRes?.ok && snapRes.snapshot){
        createdSnapshot = snapRes.snapshot;
      }
    }

    // Cleanup based on retention.
    try{ cleanupWatchSnapshots({ watchId: wid, retentionDays: due.retentionDays }); }catch{}

    exec(
      `UPDATE leaderboard_watches
       SET lastStatus=?, lastError=?, lastSignature=?, lastSnapshotId=?, updatedAt=?
       WHERE id=?`,
      [
        status,
        scanRes?.error ? String(scanRes.error) : null,
        signature,
        createdSnapshot ? Number(createdSnapshot.id) : (due.lastSnapshotId || null),
        nowIso(),
        wid
      ]
    );
    saveDb();

    return { ok:true, watchId: wid, boardKey: bk, status, saved: !!createdSnapshot, snapshot: createdSnapshot, rowCount };

  }catch(err){
    // Best-effort: record error on the most recently due watch.
    try{ console.error("[watch] runOneDueLeaderboardWatch failed:", err); }catch{}
    return { ok:false, error: String(err?.message||err) };
  } finally {
    globalThis.__idleclansLeaderboardWatchRunner = false;
  }
}

// Lightweight runtime status for UI dashboards.
// Keep this cheap: no heavy joins, no snapshot row loads.
export function getSchedulerStatus(){
  // Leaderboard scan meta is set when scanLeaderboardBoard starts.
  const lbMeta = globalThis.__idleclansLeaderboardScanMeta || null;
  const lbRunning = !!globalThis.__idleclansLeaderboardScanController;
  const bulkRunning = !!globalThis.__idleclansBulkScanController;

  // Watches (enabled + due soon)
  const enabledWatches = listLeaderboardWatches({ enabled:true, limit:200 });
  const nowMs = Date.now();
  const watches = enabledWatches.map(w=>{
    let dueInSec = null;
    if (w.nextRunAt){
      const t = Date.parse(w.nextRunAt);
      if (Number.isFinite(t)) dueInSec = Math.max(0, Math.round((t - nowMs)/1000));
    }
    return { ...w, dueInSec };
  }).sort((a,b)=>{
    const da = (a.dueInSec === null ? 1e18 : a.dueInSec);
    const db = (b.dueInSec === null ? 1e18 : b.dueInSec);
    return da - db;
  });

  // Tracked / flagged refresh queue (players/clans)
  const trackedEnabled = one(`SELECT COUNT(1) AS n FROM tracked WHERE enabled=1`);
  const trackedPlayers = one(`SELECT COUNT(1) AS n FROM tracked WHERE enabled=1 AND entityType='player'`);
  const trackedClans = one(`SELECT COUNT(1) AS n FROM tracked WHERE enabled=1 AND entityType='clan'`);

  const nextAny = one(
    `SELECT entityType, entityName, nextRunAt
     FROM tracked
     WHERE enabled=1
     ORDER BY (CASE WHEN nextRunAt IS NULL THEN 0 ELSE 1 END) ASC, nextRunAt ASC
     LIMIT 1`
  );
  const nextPlayer = one(
    `SELECT entityType, entityName, nextRunAt
     FROM tracked
     WHERE enabled=1 AND entityType='player'
     ORDER BY (CASE WHEN nextRunAt IS NULL THEN 0 ELSE 1 END) ASC, nextRunAt ASC
     LIMIT 1`
  );

  function dueInSec(nextRunAt){
    if (!nextRunAt) return 0;
    const t = Date.parse(nextRunAt);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((t - nowMs)/1000));
  }

  const trackedCurrent = globalThis.__idleclansTrackedCurrent || null;
  const trackedLast = globalThis.__idleclansTrackedLast || null;
  const trackedCycle = globalThis.__idleclansTrackedCycle || null;

  return {
    ok: true,
    now: new Date().toISOString(),
    scans: {
      leaderboard: { running: lbRunning, meta: lbMeta },
      bulk: { running: bulkRunning },
    },
    tracked: {
      enabledCount: Number(trackedEnabled?.n||0),
      enabledPlayers: Number(trackedPlayers?.n||0),
      enabledClans: Number(trackedClans?.n||0),
      cycle: trackedCycle ? {
        startedAt: trackedCycle.startedAt || null,
        intervalMinutes: Number(trackedCycle.intervalMinutes || 0) || null,
        total: Number(trackedCycle.total || 0),
        done: Number(trackedCycle.done || 0),
      } : null,
      current: trackedCurrent,
      last: trackedLast,
      nextDueAny: nextAny ? { entityType: nextAny.entityType, entityName: nextAny.entityName, nextRunAt: nextAny.nextRunAt || null, dueInSec: dueInSec(nextAny.nextRunAt) } : null,
      nextDuePlayer: nextPlayer ? { entityType: nextPlayer.entityType, entityName: nextPlayer.entityName, nextRunAt: nextPlayer.nextRunAt || null, dueInSec: dueInSec(nextPlayer.nextRunAt) } : null,
    },
    watches: {
      enabledCount: enabledWatches.length,
      nextDue: watches.length ? { id: watches[0].id, boardKey: watches[0].boardKey, dueInSec: watches[0].dueInSec, lastStatus: watches[0].lastStatus } : null,
      items: watches.slice(0, 25),
    }
  };
}

export function createLeaderboardSnapshotFromCache({ boardKey, title=null, note=null, source="cache", sourceJobId=null } = {}){
  const bk = String(boardKey||"").trim();
  if (!bk) return { ok:false, error:"Missing boardKey" };

  const last = one(`SELECT MAX(capturedAt) AS t, COUNT(1) AS n FROM leaderboard_cache WHERE boardKey=?`, [bk]);
  const rowCount = Number(last?.n||0);
  if (rowCount <= 0){
    return { ok:false, error:`No cached leaderboard rows for ${bk}. Scan it once first.` };
  }

  const now = nowIso();
  const t = (title !== null && title !== undefined) ? String(title).trim() : "";
  const ttl = t || `Snapshot ${now}`;
  const nt = (note !== null && note !== undefined) ? String(note) : null;
  const src = source ? String(source) : "cache";
  const sj = (sourceJobId !== null && sourceJobId !== undefined) ? Number(sourceJobId) : null;

  exec(
    `INSERT INTO leaderboard_snapshots(boardKey, title, createdAt, source, sourceJobId, note, rowCount)
     VALUES(?,?,?,?,?,?,?)`,
    [bk, ttl, now, src, sj, nt, rowCount]
  );
  const snap = one(`SELECT * FROM leaderboard_snapshots ORDER BY id DESC LIMIT 1`);
  const snapshotId = Number(snap?.id||0);

  exec(
    `INSERT INTO leaderboard_snapshot_rows(
        snapshotId, rank, nameLower, name, level, score, expCapDate,
        clanName, clanLower, clanSource,
        capturedAt, rawJson
     )
     SELECT
       ?, c.rank, c.nameLower, c.name, c.level, c.score, c.expCapDate,
       p.guildName AS clanName,
       CASE WHEN p.guildName IS NOT NULL AND TRIM(p.guildName) <> '' THEN LOWER(TRIM(p.guildName)) ELSE NULL END AS clanLower,
       CASE WHEN p.guildName IS NOT NULL AND TRIM(p.guildName) <> '' THEN 'player_cache' ELSE 'unknown' END AS clanSource,
       c.capturedAt,
       c.rawJson
     FROM leaderboard_cache c
     LEFT JOIN players p ON p.lowerName = c.nameLower
     WHERE c.boardKey=?
     ORDER BY c.rank ASC`,
    [snapshotId, bk]
  );

  saveDb({ forceBackup:true });
  return {
    ok: true,
    snapshot: {
      id: snapshotId,
      boardKey: bk,
      title: snap?.title || ttl,
      createdAt: snap?.createdAt || now,
      source: snap?.source || src,
      sourceJobId: snap?.sourceJobId !== null && snap?.sourceJobId !== undefined ? Number(snap.sourceJobId) : null,
      note: snap?.note || nt,
      rowCount: Number(snap?.rowCount||rowCount),
    }
  };
}

// Create a DB snapshot from a provided set of rows (renderer can freeze a baseline/compare in-memory and save later).
// Rows are expected to look like leaderboard_cache rows: { rank, nameLower, name, level, score, expCapDate, rawJson, capturedAt }
export function createLeaderboardSnapshotFromRows({ boardKey, title=null, note=null, source="rows", sourceJobId=null, capturedAt=null, rows=[] } = {}){
  const bk = String(boardKey||"").trim();
  if (!bk) return { ok:false, error:"Missing boardKey" };
  const arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) return { ok:false, error:"Missing rows" };

  const now = nowIso();
  const t = (title !== null && title !== undefined) ? String(title).trim() : "";
  const ttl = t || `Snapshot ${now}`;
  const nt = (note !== null && note !== undefined) ? String(note) : null;
  const src = source ? String(source) : "rows";
  const sj = (sourceJobId !== null && sourceJobId !== undefined) ? Number(sourceJobId) : null;
  const cap = capturedAt ? String(capturedAt) : now;

  exec(
    `INSERT INTO leaderboard_snapshots(boardKey, title, createdAt, source, sourceJobId, note, rowCount)
     VALUES(?,?,?,?,?,?,?)`,
    [bk, ttl, now, src, sj, nt, arr.length]
  );
  const snap = one(`SELECT * FROM leaderboard_snapshots ORDER BY id DESC LIMIT 1`);
  const snapshotId = Number(snap?.id||0);

  // Resolve clans from players table (best-known)
  const lowers = [];
  for (const r of arr){
    const nl = String(r?.nameLower || r?.name || "").toLowerCase().trim();
    if (nl) lowers.push(nl);
  }
  const clanMapRes = getPlayersClanMap({ names: Array.from(new Set(lowers)) });
  const clans = clanMapRes?.ok ? (clanMapRes.clans || {}) : {};

  const stmt = db.prepare(
    `INSERT INTO leaderboard_snapshot_rows(
        snapshotId, rank, nameLower, name, level, score, expCapDate,
        clanName, clanLower, clanSource,
        capturedAt, rawJson
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  db.transaction(()=>{
    for (const r of arr){
      const rank = (r?.rank !== null && r?.rank !== undefined) ? Number(r.rank) : null;
      const name = String(r?.name || r?.username || "").trim();
      const nameLower = String(r?.nameLower || name).toLowerCase().trim();
      if (!nameLower) continue;
      const level = (r?.level !== null && r?.level !== undefined) ? Number(r.level) : null;
      const score = (r?.score !== null && r?.score !== undefined) ? Number(r.score) : null;
      const expCapDate = (r?.expCapDate !== null && r?.expCapDate !== undefined) ? Number(r.expCapDate) : 0;
      const rawJson = (r?.rawJson !== null && r?.rawJson !== undefined) ? String(r.rawJson) : null;
      const capAt = (r?.capturedAt !== null && r?.capturedAt !== undefined) ? String(r.capturedAt) : cap;

      const cm = clans[nameLower];
      const clanName = cm?.clanName || null;
      const clanLower = clanName ? lower(clanName) : null;
      const clanSource = clanName ? "player_cache" : "unknown";

      stmt.run(
        snapshotId,
        rank,
        nameLower,
        name || nameLower,
        level,
        score,
        expCapDate,
        clanName,
        clanLower,
        clanSource,
        capAt,
        rawJson
      );
    }
  })();

  saveDb({ forceBackup:true });
  return {
    ok: true,
    snapshot: {
      id: snapshotId,
      boardKey: bk,
      title: snap?.title || ttl,
      createdAt: snap?.createdAt || now,
      source: snap?.source || src,
      sourceJobId: snap?.sourceJobId !== null && snap?.sourceJobId !== undefined ? Number(snap.sourceJobId) : null,
      note: snap?.note || nt,
      rowCount: Number(snap?.rowCount||arr.length),
    }
  };
}


export function listLeaderboardImportedStubs({ entityType, gameMode=null, sinceIso=null, limit=250 } = {}){
  const et = String(entityType||"").trim();
  const gm = gameMode ? String(gameMode).trim() : null;
  const since = sinceIso ? String(sinceIso) : null;
  const lim = Math.max(1, Math.min(5000, Number(limit||250)));

  if (et === "players"){
    const rows = all(
      `SELECT username AS name
       FROM players
       WHERE (profileJson IS NULL OR profileJson = '')
         AND (? IS NULL OR gameMode = ?)
         AND (? IS NULL OR createdAt >= ?)
       ORDER BY createdAt DESC
       LIMIT ?`,
      [gm, gm, since, since, lim]
    );
    return rows.map(r=>r.name).filter(Boolean);
  }
  if (et === "clans"){
    const rows = all(
      `SELECT clanName AS name
       FROM clans
       WHERE (dataJson IS NULL OR dataJson = '')
         AND (? IS NULL OR gameMode = ?)
         AND (? IS NULL OR createdAt >= ?)
       ORDER BY createdAt DESC
       LIMIT ?`,
      [gm, gm, since, since, lim]
    );
    return rows.map(r=>r.name).filter(Boolean);
  }
  // pets currently have no detail page or live lookup in this tool.
  return [];
}

// ------------------------------------------------------------------
// Leaderboard scan jobs (persisted; allows pause/resume across restarts)
// ------------------------------------------------------------------

export function createLeaderboardJob({ title, plan, options } = {}){
  const now = nowIso();
  const t = String(title || "Leaderboard Scan").trim() || "Leaderboard Scan";
  const p = Array.isArray(plan) ? plan : [];
  const o = options && typeof options === "object" ? options : {};
  exec(
    `INSERT INTO leaderboard_jobs(title, status, planJson, optionsJson, currentIndex, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?,?)`,
    [t, "queued", JSON.stringify(p), JSON.stringify(o), 0, now, now]
  );
  const row = one(`SELECT * FROM leaderboard_jobs ORDER BY id DESC LIMIT 1`);
  saveDb();
  return normalizeLeaderboardJob(row);
}

export function getLeaderboardJob(jobId){
  const id = Number(jobId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = one(`SELECT * FROM leaderboard_jobs WHERE id=? LIMIT 1`, [id]);
  return normalizeLeaderboardJob(row);
}

export function listLeaderboardJobs({ limit=25 } = {}){
  const lim = Math.max(1, Math.min(200, Number(limit||25)));
  const rows = all(`SELECT * FROM leaderboard_jobs ORDER BY id DESC LIMIT ?`, [lim]);
  return rows.map(normalizeLeaderboardJob).filter(Boolean);
}

export function updateLeaderboardJob(jobId, patch = {}){
  const id = Number(jobId);
  if (!Number.isFinite(id) || id <= 0) return { ok:false, error:"Invalid jobId" };
  const now = nowIso();

  const cur = one(`SELECT * FROM leaderboard_jobs WHERE id=? LIMIT 1`, [id]);
  if (!cur) return { ok:false, error:"Job not found" };

  const next = {
    status: ("status" in patch) ? String(patch.status||"") : cur.status,
    currentIndex: ("currentIndex" in patch) ? Number(patch.currentIndex||0) : Number(cur.currentIndex||0),
    currentBoardKey: ("currentBoardKey" in patch) ? (patch.currentBoardKey ? String(patch.currentBoardKey) : null) : cur.currentBoardKey,
    currentLabel: ("currentLabel" in patch) ? (patch.currentLabel ? String(patch.currentLabel) : null) : cur.currentLabel,
    lastError: ("lastError" in patch) ? (patch.lastError ? String(patch.lastError) : null) : cur.lastError,
  };

  exec(
    `UPDATE leaderboard_jobs
     SET status=?, currentIndex=?, currentBoardKey=?, currentLabel=?, lastError=?, updatedAt=?
     WHERE id=?`,
    [next.status, next.currentIndex, next.currentBoardKey, next.currentLabel, next.lastError, now, id]
  );
  saveDb();
  return { ok:true, job: getLeaderboardJob(id) };
}

export function setLeaderboardJobPlan(jobId, { plan, options } = {}){
  const id = Number(jobId);
  if (!Number.isFinite(id) || id <= 0) return { ok:false, error:"Invalid jobId" };
  const now = nowIso();
  const p = Array.isArray(plan) ? plan : [];
  const o = options && typeof options === "object" ? options : {};
  exec(
    `UPDATE leaderboard_jobs
     SET planJson=?, optionsJson=?, updatedAt=?
     WHERE id=?`,
    [JSON.stringify(p), JSON.stringify(o), now, id]
  );
  saveDb();
  return { ok:true, job: getLeaderboardJob(id) };
}

function normalizeLeaderboardJob(r){
  if (!r) return null;
  let plan = [];
  let options = {};
  try{ plan = JSON.parse(r.planJson||"[]") || []; }catch{}
  try{ options = JSON.parse(r.optionsJson||"{}") || {}; }catch{}
  return {
    id: Number(r.id),
    title: r.title,
    status: r.status,
    plan,
    options,
    currentIndex: Number(r.currentIndex||0),
    currentBoardKey: r.currentBoardKey || null,
    currentLabel: r.currentLabel || null,
    lastError: r.lastError || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function scanLeaderboardBoard(
  { entityType, gameMode="default", category, startCount=1, maxCount=100, resume=false, importMissing=false, clearCache=false, maxRank=null, refreshProfiles=false } = {},
  progressCb
){
  // Optional cap on how far the scan walks down the board (e.g. "Top 1000").
  // null/0/negative = no limit (scan until the API returns an empty page, as before).
  const rankLimit = (Number.isFinite(Number(maxRank)) && Number(maxRank) > 0) ? Math.floor(Number(maxRank)) : null;
  const et = String(entityType||"").trim();
  const gm = String(gameMode||"default").trim();
  const cat = String(category||"").trim();
  if (!et || !cat) throw new Error("Missing entityType/category");

  const boardKey = leaderboardBoardKey(et, gm, cat);

  // Single active leaderboard scan at a time (keep it simple & avoid rate-limit confusion).
  if (globalThis.__idleclansLeaderboardScanController){
    throw new Error("A leaderboard scan is already running");
  }
  const controller = new AbortController();
  globalThis.__idleclansLeaderboardScanController = controller;
  const signal = controller.signal;

  // Lightweight runtime meta for UI (scheduler dashboard / watch blocking reason).
  try{
    globalThis.__idleclansLeaderboardScanMeta = {
      boardKey,
      entityType: et,
      gameMode: gm,
      category: cat,
      startedAt: nowIso(),
    };
  }catch{}

  const now = nowIso();

  if (clearCache){
    exec(`DELETE FROM leaderboard_cache WHERE boardKey=?`, [boardKey]);
  }

  // Determine starting cursor (resume uses persisted state if present).
  let start = Number(startCount||1);
  let end = Number(maxCount||100);
  const existing = getLeaderboardScanState(boardKey);
  if (resume && existing && (existing.status === "stopped" || existing.status === "running")){
    start = existing.nextStartCount;
    end = existing.nextMaxCount;
  }

  // Initialize scan state row.
  exec(
    `INSERT INTO leaderboard_scan_state(boardKey, entityType, gameMode, category, nextStartCount, nextMaxCount, status, lastUpdatedAt, lastError, lastRank, lastNameLower)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(boardKey) DO UPDATE SET
       entityType=excluded.entityType,
       gameMode=excluded.gameMode,
       category=excluded.category,
       nextStartCount=excluded.nextStartCount,
       nextMaxCount=excluded.nextMaxCount,
       status=excluded.status,
       lastUpdatedAt=excluded.lastUpdatedAt,
       lastError=NULL`,
    [boardKey, et, gm, cat, start, end, "running", now, null, null, null]
  );
  saveDb();

  let pages = 0;
  let totalFetched = 0;
  let insertedEntities = 0;
  let lastNameLower = null;
  let lastRank = null;
  let repeatGuardHits = 0;
  let prevPageStart = null;
  let prevPageLastNameLower = null;

  // Shared completion path. Runs the cheap standings sync (instant), then —
  // if requested — the slow full profile refresh (one API call per cached
  // name, rate-limited). Returns the final result object for this scan.
  // If the profile refresh is aborted partway through, the scan itself still
  // reports "completed" (the leaderboard portion finished); only the refresh
  // is marked as stopped early via refreshResult.aborted.
  async function finishCompleted(extra = {}){
    try{ syncLeaderboardStandingsToProfiles(boardKey); }catch(e){ console.error("[leaderboard] standings sync failed:", e?.message); }

    let refreshResult = null;
    if (refreshProfiles){
      try{
        refreshResult = await refreshProfilesFromLeaderboard(boardKey, { signal, progressCb });
      }catch(err){
        if (err?.name === "AbortError"){
          refreshResult = { ok:true, aborted:true };
        } else {
          console.error("[leaderboard] profile refresh failed:", err?.message);
          refreshResult = { ok:false, error: String(err?.message || err) };
        }
      }
    }

    const result = { ok:true, boardKey, status:"completed", pages, totalFetched, insertedEntities, refreshResult, ...extra };
    if (progressCb) progressCb({ ...result, running:false });
    return result;
  }

  try{
    while (true){
      if (signal.aborted) throw abortError();

      // Rank-limit check: if we've reached/passed the configured cap, stop here
      // as if the board ended naturally (status "completed").
      if (rankLimit && start > rankLimit){
        exec(
          `UPDATE leaderboard_scan_state
           SET status='completed', lastUpdatedAt=?, lastError=NULL, nextStartCount=?, nextMaxCount=?, lastRank=?, lastNameLower=?
           WHERE boardKey=?`,
          [nowIso(), start, end, lastRank, lastNameLower, boardKey]
        );
        saveDb();
        return await finishCompleted({ rankLimitReached:true });
      }

      // If the rank limit falls inside this page's range, trim maxCount so we
      // don't fetch/store rows beyond it.
      let pageEnd = end;
      if (rankLimit && rankLimit < end) pageEnd = rankLimit;

      const url = leaderboardUrl({ entityType: et, gameMode: gm, category: cat, startCount: start, maxCount: pageEnd });
      const raw = await apiGetJson(url, { signal });
      const list = Array.isArray(raw) ? raw : [];

      pages++;
      const fetched = list.length;
      totalFetched += fetched;

      if (fetched === 0){
        // done
        exec(
          `UPDATE leaderboard_scan_state
           SET status='completed', lastUpdatedAt=?, lastError=NULL, nextStartCount=?, nextMaxCount=?, lastRank=?, lastNameLower=?
           WHERE boardKey=?`,
          [nowIso(), start, end, lastRank, lastNameLower, boardKey]
        );
        saveDb();
        return await finishCompleted();
      }

      const capturedAt = nowIso();
      // Store rows
      for (let i=0; i<list.length; i++){
        const norm = normalizeLeaderboardRow(list[i]);
        if (!norm.nameLower) continue;
        const rank = start + i;
        lastRank = rank;
        lastNameLower = norm.nameLower;

        exec(
          `INSERT INTO leaderboard_cache(boardKey, rank, nameLower, name, level, score, expCapDate, capturedAt, rawJson)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(boardKey, rank) DO UPDATE SET
             nameLower=excluded.nameLower,
             name=excluded.name,
             level=excluded.level,
             score=excluded.score,
             expCapDate=excluded.expCapDate,
             capturedAt=excluded.capturedAt,
             rawJson=excluded.rawJson`,
          [boardKey, rank, norm.nameLower, norm.name, norm.level, norm.score, norm.expCapDate, capturedAt, norm.raw ? JSON.stringify(norm.raw) : null]
        );

        if (importMissing){
          if (et === "players"){
            const exists = one(`SELECT 1 AS x FROM players WHERE lowerName=? LIMIT 1`, [norm.nameLower]);
            if (!exists){
              if (upsertPlayerStubFromLeaderboard(norm.name, gm)) insertedEntities++;
            }
          } else if (et === "clans"){
            const exists = one(`SELECT 1 AS x FROM clans WHERE lowerName=? LIMIT 1`, [norm.nameLower]);
            if (!exists){
              if (upsertClanStubFromLeaderboard(norm.name, gm)) insertedEntities++;
            }
          }
        }
      }
// Loop guard: if pagination appears stuck (server ignoring range or cached response),
// retry a few times with backoff, then mark this board as "stalled" instead of crashing the whole job.
const isRepeat =
  (existing?.lastNameLower && lastNameLower && existing.lastNameLower === lastNameLower && start === existing.nextStartCount) ||
  (prevPageStart === start && prevPageLastNameLower && lastNameLower && prevPageLastNameLower === lastNameLower);

if (isRepeat){
  repeatGuardHits++;
  const msg = "Leaderboard pagination did not advance (repeat guard triggered).";
  exec(
    `UPDATE leaderboard_scan_state
     SET status='running', lastUpdatedAt=?, lastError=?
     WHERE boardKey=?`,
    [nowIso(), msg + ` Retry ${repeatGuardHits}/3`, boardKey]
  );
  saveDb();
  if (progressCb){
    progressCb({ boardKey, running:true, status:"running", warning: msg, repeatGuardHits, startCount: start, maxCount: end });
  }

  if (repeatGuardHits <= 3){
    // Wait a bit and retry the same range.
    await sleep(1500 * repeatGuardHits, signal);
    continue;
  }

  // Give up on this board for now. Caller can continue other boards in the plan.
  exec(
    `UPDATE leaderboard_scan_state
     SET status='stalled', lastUpdatedAt=?, lastError=?
     WHERE boardKey=?`,
    [nowIso(), msg + " Giving up on this board after 3 retries.", boardKey]
  );
  saveDb();
  if (progressCb){
    progressCb({ boardKey, running:false, status:"stalled", error: msg, pages, totalFetched, insertedEntities });
  }
  return { ok:true, boardKey, status:"stalled", pages, totalFetched, insertedEntities, error: msg };
}
// Advance cursor by 100-wide ranges (as described by the API usage), based on
// pageEnd (which may be trimmed below `end` if a rank limit applies).
      const nextStart = pageEnd + 1;
      const nextEnd = pageEnd + 100;

      // If this page reached the configured rank limit, stop here — treat it
      // the same as the board ending naturally.
      if (rankLimit && pageEnd >= rankLimit){
        exec(
          `UPDATE leaderboard_scan_state
           SET status='completed', lastUpdatedAt=?, lastError=NULL, nextStartCount=?, nextMaxCount=?, lastRank=?, lastNameLower=?
           WHERE boardKey=?`,
          [nowIso(), nextStart, nextEnd, lastRank, lastNameLower, boardKey]
        );
        saveDb();
        return await finishCompleted({ rankLimitReached:true });
      }

      exec(
        `UPDATE leaderboard_scan_state
         SET status='running', lastUpdatedAt=?, lastError=NULL, nextStartCount=?, nextMaxCount=?, lastRank=?, lastNameLower=?
         WHERE boardKey=?`,
        [nowIso(), nextStart, nextEnd, lastRank, lastNameLower, boardKey]
      );
      saveDb();

      // Reset repeat-guard trackers once we advance.
      repeatGuardHits = 0;
      prevPageStart = start;
      prevPageLastNameLower = lastNameLower;

      if (progressCb){
        progressCb({
          boardKey,
          running:true,
          status:"running",
          page: pages,
          startCount: start,
          maxCount: end,
          fetched,
          totalFetched,
          insertedEntities,
          lastRank,
          lastName: lastNameLower,
        });
      }

      start = nextStart;
      end = nextEnd;
    }
  } catch(err){
    const isAbort = err?.name === "AbortError";
    const status = isAbort ? "stopped" : "error";
    exec(
      `UPDATE leaderboard_scan_state
       SET status=?, lastUpdatedAt=?, lastError=?, nextStartCount=?, nextMaxCount=?, lastRank=?, lastNameLower=?
       WHERE boardKey=?`,
      [status, nowIso(), isAbort ? null : String(err?.message || err), start, end, lastRank, lastNameLower, boardKey]
    );
    saveDb();
    if (progressCb){
      progressCb({ boardKey, running:false, status, error: isAbort ? null : String(err?.message || err), pages, totalFetched, insertedEntities });
    }
    if (isAbort) return { ok:true, boardKey, status:"stopped", pages, totalFetched, insertedEntities };
    throw err;
  } finally {
    globalThis.__idleclansLeaderboardScanController = null;
    try{ globalThis.__idleclansLeaderboardScanMeta = null; }catch{}
  }
}

export function cancelLeaderboardScan(){
  const c = globalThis.__idleclansLeaderboardScanController;
  if (c){
    try{ c.abort(); }catch{}
    return { ok:true };
  }
  return { ok:false, error:"No leaderboard scan running" };
}


// insertPresenceSample, maybeAlertPlayerInactivity imported from ./shared/helpers.js

export function getPlayerLastOnlineEvents(playerName, days=7, limit=5000){
  const ln = lower(playerName);
  const d = Math.max(1, Math.min(90, Number(days||7)));
  const n = Math.max(1, Math.min(20000, Number(limit||5000)));
  const since = new Date(Date.now() - d*86400000).toISOString();
  return all(
    `SELECT lastOnlineAt, scannedAt, hoursOffline, source
     FROM presence_samples
     WHERE playerLower=? AND lastOnlineAt IS NOT NULL AND lastOnlineAt >= ?
     ORDER BY lastOnlineAt DESC
     LIMIT ?`,
    [ln, since, n]
  );
}

// Aggregate "last online" events for a clan by looking at presence samples of its members.
// Used for clan-level heatmap.
export function getClanLastOnlineEvents(clanName, days=7, limit=20000){
  const cl = lower(clanName);
  const d = Math.max(1, Math.min(90, Number(days||7)));
  const n = Math.max(1, Math.min(50000, Number(limit||20000)));
  const since = new Date(Date.now() - d*86400000).toISOString();
  return all(
    `SELECT ps.lastOnlineAt, ps.scannedAt, ps.hoursOffline, ps.source,
            ps.playerLower,
            COALESCE(p.username, ps.playerLower) AS playerName
     FROM presence_samples ps
     JOIN clan_members cm
       ON cm.memberLower = ps.playerLower
      AND cm.clanLower = ?
     LEFT JOIN players p ON p.lowerName = ps.playerLower
     WHERE ps.lastOnlineAt IS NOT NULL AND ps.lastOnlineAt >= ?
     ORDER BY ps.lastOnlineAt DESC
     LIMIT ?`,
    [cl, since, n]
  );
}

// ── Players + Clans API layer (extracted to services/players.js, services/clans.js, api/logs.js) ──
export const upsertPlayerFromApi = (...a) => _upsertPlayerFromApi(...a);
export const upsertClanFromApi   = (...a) => _upsertClanFromApi(...a);
export const lookupPlayerLive    = (...a) => _lookupPlayerLive(...a);
export const previewPlayerLive   = (...a) => _previewPlayerLive(...a);
export const previewClanLive     = (...a) => _previewClanLive(...a);
export const lookupClanLive      = (...a) => _lookupClanLive(...a);
export const insertLogs          = (...a) => _insertLogs(...a);

// markBulkScanned, wasBulkScanned imported from ./shared/helpers.js

// Bulk scan all players/clans in the database.
// Intended for Home page "Scan all" to progressively backfill profiles/logs without opening each page.
export async function scanAll({ includePlayers=true, includeClans=true, includeClanMembers=false, skipPreviouslyScanned=true } = {}, progressCb){
  // Single active bulk scan at a time.
  if (globalThis.__idleclansBulkScanController){
    throw new Error("A bulk scan is already running");
  }

  const controller = new AbortController();
  globalThis.__idleclansBulkScanController = controller;
  const signal = controller.signal;

  // IMPORTANT: Do NOT build an in-memory job list for large databases.
  // Some users have 80k+ profiles which would OOM when materialized.
  // We stream through the DB in pages and process sequentially.

  const countPlayers = () => {
    if (!includePlayers) return 0;
    if (!skipPreviouslyScanned) return one(`SELECT COUNT(1) AS n FROM players WHERE (notFoundAt IS NULL OR TRIM(notFoundAt)='') AND (dormantAt IS NULL OR TRIM(dormantAt)='')`)?.n || 0;
    return one(
      `SELECT COUNT(1) AS n
       FROM players p
       LEFT JOIN bulk_scan_marks b ON b.entityType='player' AND b.entityLower=p.lowerName
       WHERE b.entityLower IS NULL AND (p.notFoundAt IS NULL OR TRIM(p.notFoundAt)='') AND (p.dormantAt IS NULL OR TRIM(p.dormantAt)='')`
    )?.n || 0;
  };

  const countClans = () => {
    if (!includeClans) return 0;
    if (!skipPreviouslyScanned) return one(`SELECT COUNT(1) AS n FROM clans WHERE (notFoundAt IS NULL OR TRIM(notFoundAt)='')`)?.n || 0;
    return one(
      `SELECT COUNT(1) AS n
       FROM clans c
       LEFT JOIN bulk_scan_marks b ON b.entityType='clan' AND b.entityLower=c.lowerName
       WHERE b.entityLower IS NULL AND (c.notFoundAt IS NULL OR TRIM(c.notFoundAt)='')`
    )?.n || 0;
  };

  const countMembersNotInPlayers = () => {
    if (!(includePlayers && includeClanMembers)) return 0;
    // Only include members that are not already present in players table.
    // This avoids duplicate scans without needing a giant in-memory Set.
    const base =
      `SELECT COUNT(1) AS n
       FROM (
         SELECT DISTINCT cm.memberLower AS memberLower
         FROM clan_members cm
         LEFT JOIN players p ON p.lowerName = cm.memberLower
         WHERE p.lowerName IS NULL
       ) x`;
    if (!skipPreviouslyScanned) return one(base)?.n || 0;
    return one(
      `SELECT COUNT(1) AS n
       FROM (
         SELECT DISTINCT cm.memberLower AS memberLower
         FROM clan_members cm
         LEFT JOIN players p ON p.lowerName = cm.memberLower
         LEFT JOIN bulk_scan_marks b ON b.entityType='player' AND b.entityLower=cm.memberLower
         WHERE p.lowerName IS NULL AND b.entityLower IS NULL
       ) x`
    )?.n || 0;
  };

  const totalPlayers = countPlayers();
  const totalMembers = countMembersNotInPlayers();
  const totalClans = countClans();
  const total = totalPlayers + totalMembers + totalClans;

  let donePlayers = 0;
  let doneMembers = 0;
  let doneClans = 0;
  let done = 0;
  const s = getSettings();
  const callsPerMin = Math.max(1, Math.min(60, Number(s.apiCallsPerMinute ?? 15)));
  const minDelayMs = Math.ceil(60000 / callsPerMin);
  const startedAt = Date.now();

  const PAGE = 250;
  const saveEvery = 50;
  let sinceSave = 0;

  const doPlayer = async (name) => {
    await upsertPlayerFromApi(name, { signal });
    await insertLogs("player", name, { signal });
    markBulkScanned("player", name, nowIso());
  };

  const doClan = async (name) => {
    await upsertClanFromApi(name, { signal });
    await insertLogs("clan", name, { signal });
    markBulkScanned("clan", name, nowIso());
  };

  const emit = (current, extra)=> {
    progressCb?.({
      running:true,
      done,
      total,
      donePlayers, totalPlayers,
      doneMembers, totalMembers,
      doneClans, totalClans,
      current,
      ...(extra||{})
    });
  };

  // initial progress
  emit(null, { current:null, startedAt, callsPerMin, minDelayMs, estCallsPerPlayer:2, estCallsPerClan:2 });

  const tick = (kind) => {
    done += 1;
    if (kind === "player") donePlayers += 1;
    else if (kind === "member") doneMembers += 1;
    else if (kind === "clan") doneClans += 1;

    sinceSave += 1;
    if (sinceSave >= saveEvery){
      sinceSave = 0;
      try{ saveDb(); }catch{}
    }
  };

  try{
    // Phase 1: players (streamed)
    if (includePlayers){
      let offset = 0;
      while (true){
        if (signal.aborted) throw abortError();
        const rows = skipPreviouslyScanned
          ? all(
              `SELECT p.username AS username
               FROM players p
               LEFT JOIN bulk_scan_marks b ON b.entityType='player' AND b.entityLower=p.lowerName
               WHERE b.entityLower IS NULL AND (p.notFoundAt IS NULL OR TRIM(p.notFoundAt)='') AND (p.dormantAt IS NULL OR TRIM(p.dormantAt)='')
               ORDER BY p.lowerName
               LIMIT ? OFFSET ?`,
              [PAGE, offset]
            )
          : all(
              `SELECT username FROM players WHERE (notFoundAt IS NULL OR TRIM(notFoundAt)='') AND (dormantAt IS NULL OR TRIM(dormantAt)='') ORDER BY lowerName LIMIT ? OFFSET ?`,
              [PAGE, offset]
            );
        if (!rows?.length) break;
        for (const r of rows){
          if (signal.aborted) throw abortError();
          const n = r?.username;
          if (!n) { offset += 1; continue; }
          const current = { entityType:"player", name:n, contextClan:null };
          emit(current);
          try{ await doPlayer(n); }
          catch (e){
            if (e?.name === "AbortError") throw e;
            log("player", n, `Bulk scan failed: ${String(e?.message||e)}`, nowIso(), null);
          }
          tick("player");
          emit(current);
        }
        offset += rows.length;
      }
    }

    // Phase 2: clan members not already in players (streamed)
    if (includePlayers && includeClanMembers){
      let offset = 0;
      while (true){
        if (signal.aborted) throw abortError();
        const rows = skipPreviouslyScanned
          ? all(
              `SELECT cm.memberName AS memberName, MIN(c.clanName) AS clanName
               FROM clan_members cm
               LEFT JOIN players p ON p.lowerName = cm.memberLower
               LEFT JOIN clans c ON c.lowerName = cm.clanLower
               LEFT JOIN bulk_scan_marks b ON b.entityType='player' AND b.entityLower=cm.memberLower
               WHERE p.lowerName IS NULL AND b.entityLower IS NULL
               GROUP BY cm.memberLower
               ORDER BY cm.memberLower
               LIMIT ? OFFSET ?`,
              [PAGE, offset]
            )
          : all(
              `SELECT cm.memberName AS memberName, MIN(c.clanName) AS clanName
               FROM clan_members cm
               LEFT JOIN players p ON p.lowerName = cm.memberLower
               LEFT JOIN clans c ON c.lowerName = cm.clanLower
               WHERE p.lowerName IS NULL
               GROUP BY cm.memberLower
               ORDER BY cm.memberLower
               LIMIT ? OFFSET ?`,
              [PAGE, offset]
            );
        if (!rows?.length) break;
        for (const r of rows){
          if (signal.aborted) throw abortError();
          const n = r?.memberName;
          if (!n) continue;
          const current = { entityType:"player", name:n, contextClan:(r?.clanName||null) };
          emit(current);
          try{ await doPlayer(n); }
          catch (e){
            if (e?.name === "AbortError") throw e;
            log("player", n, `Bulk scan failed: ${String(e?.message||e)}`, nowIso(), null);
          }
          tick("member");
          emit(current);
        }
        offset += rows.length;
      }
    }

    // Phase 3: clans (streamed)
    if (includeClans){
      let offset = 0;
      while (true){
        if (signal.aborted) throw abortError();
        const rows = skipPreviouslyScanned
          ? all(
              `SELECT c.clanName AS clanName
               FROM clans c
               LEFT JOIN bulk_scan_marks b ON b.entityType='clan' AND b.entityLower=c.lowerName
               WHERE b.entityLower IS NULL AND (c.notFoundAt IS NULL OR TRIM(c.notFoundAt)='')
               ORDER BY c.lowerName
               LIMIT ? OFFSET ?`,
              [PAGE, offset]
            )
          : all(
              `SELECT clanName FROM clans WHERE (notFoundAt IS NULL OR TRIM(notFoundAt)='') ORDER BY lowerName LIMIT ? OFFSET ?`,
              [PAGE, offset]
            );
        if (!rows?.length) break;
        for (const r of rows){
          if (signal.aborted) throw abortError();
          const n = r?.clanName;
          if (!n) continue;
          const current = { entityType:"clan", name:n, contextClan:null };
          emit(current);
          try{ await doClan(n); }
          catch (e){
            if (e?.name === "AbortError") throw e;
            log("clan", n, `Bulk scan failed: ${String(e?.message||e)}`, nowIso(), null);
          }
          tick("clan");
          emit(current);
        }
        offset += rows.length;
      }
    }
    progressCb?.({ running:false, done, total, donePlayers, totalPlayers, doneMembers, totalMembers, doneClans, totalClans, current:null });
    saveDb();
    return { ok:true, done, total };
  } catch (e){
    if (e?.name === "AbortError"){
      progressCb?.({ running:false, done, total, donePlayers, totalPlayers, doneMembers, totalMembers, doneClans, totalClans, current:null, canceled:true });
      saveDb();
      return { ok:false, canceled:true, done, total };
    }
    progressCb?.({ running:false, done, total, donePlayers, totalPlayers, doneMembers, totalMembers, doneClans, totalClans, current:null, error:String(e?.message||e) });
    saveDb();
    throw e;
  } finally{
    globalThis.__idleclansBulkScanController = null;
  }
}

// Bulk scan only players (profiles + logs). Used by Home page "Scan players".
export async function scanPlayersOnly({ skipPreviouslyScanned=true } = {}, progressCb){
  return scanAll({ includePlayers:true, includeClans:false, includeClanMembers:false, skipPreviouslyScanned: !!skipPreviouslyScanned }, progressCb);
}

// Bulk scan clans AND their members (profiles + logs).
// This fetches the clan member list from the live API (via upsertClanFromApi) and then scans each member.
// Used by Home page "Scan clans".


// Bulk scan a specific list of players (profiles + logs).
// Used by Name Matches page to refresh last-online / offline-time signals for matched members.
export async function scanPlayersList(
  { players = [], skipPreviouslyScanned = true, onlyUnknownLastOnline = false } = {},
  progressCb
){
  // Single active bulk scan at a time.
  if (globalThis.__idleclansBulkScanController){
    throw new Error("A bulk scan is already running");
  }

  const controller = new AbortController();
  globalThis.__idleclansBulkScanController = controller;
  const signal = controller.signal;

  const uniq = [];
  const seen = new Set();
  for (const p of (players || [])){
    const name = String(p || "").trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    uniq.push(name);
  }

  const isUnknownLastOnline = (lowerName) => {
    const row = one(`SELECT profileJson, updatedAt FROM players WHERE lowerName=?`, [lowerName]);
    const pj = row?.profileJson;
    if (!pj || String(pj).trim().length === 0) return true;
    if (!row?.updatedAt) return true;
    return false;
  };

  const eligible = [];
  if (skipPreviouslyScanned){
    for (const name of uniq){
      const lower = name.toLowerCase();
      const marked = one(
        `SELECT 1 AS x FROM bulk_scan_marks WHERE entityType='player' AND entityLower=?`,
        [lower]
      )?.x;
      if (marked) continue;
      if (onlyUnknownLastOnline && !isUnknownLastOnline(lower)) continue;
      eligible.push(name);
    }
  } else {
    for (const name of uniq){
      const lower = name.toLowerCase();
      // Always skip notFoundAt players — they 404'd; use Recheck to retry
      const nf = one(`SELECT notFoundAt FROM players WHERE lowerName=?`, [lower]);
      if (nf?.notFoundAt && String(nf.notFoundAt).trim()) continue;
      if (onlyUnknownLastOnline && !isUnknownLastOnline(lower)) continue;
      eligible.push(name);
    }
  }

  const total = eligible.length;
  const saveEvery = 50;
  let done = 0;
  let failed = 0;
  let sinceSave = 0;

  const doPlayer = async (name) => {
    await upsertPlayerFromApi(name, { signal });
    await insertLogs("player", name, { signal });
    markBulkScanned("player", name, nowIso());
  };

  try{
    progressCb?.({
      running:true,
      phase:"playersList",
      done,
      failed,
      total,
      current:null,
      message:`Scanning ${total} players...`
    });

    for (const name of eligible){
      if (signal.aborted) throw abortError();
      progressCb?.({
        running:true,
        phase:"playersList",
        done,
        failed,
        total,
        current:{ entityType:"player", name },
        message:`Scanning player ${name}...`
      });

      try{
        await doPlayer(name);
        done += 1;
        sinceSave += 1;

        if (sinceSave >= saveEvery){
          sinceSave = 0;
          try{ saveDb(); }catch{}
        }

        progressCb?.({
          running:true,
          phase:"playersList",
          done,
          failed,
          total,
          current:{ entityType:"player", name },
          message:`Scanned ${name}`
        });
      }catch(e){
        if (signal.aborted) throw abortError();
        failed += 1;
        const emsg = String(e?.message || e);

        progressCb?.({
          running:true,
          phase:"playersList",
          done,
          failed,
          total,
          current:{ entityType:"player", name },
          error: emsg,
          message:`Failed ${name}: ${emsg}`
        });

        // Continue scanning other players even if one fails.
      }
    }

    try{ saveDb(); }catch{}
    progressCb?.({ running:false, phase:"playersList", done, failed, total, current:null, message:"Done" });
    return { ok:true, done, failed, total };
  }catch(e){
    const msg = String(e?.message || e);
    progressCb?.({ running:false, phase:"playersList", done, failed, total, current:null, error:msg, message:msg });
    throw e;
  }finally{
    globalThis.__idleclansBulkScanController = null;
  }
}

export async function scanClansWithMembers({ skipPreviouslyScanned=true } = {}, progressCb){
  // Single active bulk scan at a time.
  if (globalThis.__idleclansBulkScanController){
    throw new Error("A bulk scan is already running");
  }

  const controller = new AbortController();
  globalThis.__idleclansBulkScanController = controller;
  const signal = controller.signal;

  const startedAt = Date.now();
  const s = getSettings();
  const callsPerMin = Math.max(1, Math.min(60, Number(s.apiCallsPerMinute ?? 15)));
  const minDelayMs = Math.ceil(60000 / callsPerMin);

  // Totals are an estimate: member lists can grow as we fetch fresh clan data.
  const countClans = () => {
    if (!skipPreviouslyScanned) return one(`SELECT COUNT(1) AS n FROM clans`)?.n || 0;
    return one(
      `SELECT COUNT(1) AS n
       FROM clans c
       LEFT JOIN bulk_scan_marks b ON b.entityType='clan' AND b.entityLower=c.lowerName
       WHERE b.entityLower IS NULL`
    )?.n || 0;
  };

  const countMembers = () => {
    // Count distinct members currently in DB (may increase during scan).
    const base = `SELECT COUNT(1) AS n FROM (SELECT DISTINCT memberLower FROM clan_members) x`;
    if (!skipPreviouslyScanned) return one(base)?.n || 0;
    return one(
      `SELECT COUNT(1) AS n
       FROM (
         SELECT DISTINCT cm.memberLower AS memberLower
         FROM clan_members cm
         LEFT JOIN bulk_scan_marks b ON b.entityType='player' AND b.entityLower=cm.memberLower
         WHERE b.entityLower IS NULL
       ) x`
    )?.n || 0;
  };

  const total = countClans() + countMembers();
  let done = 0;
  progressCb?.({ running:true, done, total, current:null, startedAt, callsPerMin, minDelayMs, mode:"clansWithMembers" });

  const saveEvery = 50;
  let sinceSave = 0;
  const tick = () => {
    done += 1;
    sinceSave += 1;
    if (sinceSave >= saveEvery){
      sinceSave = 0;
      try{ saveDb(); }catch{}
    }
  };

  const doPlayer = async (name) => {
    await upsertPlayerFromApi(name, { signal });
    await insertLogs("player", name, { signal });
    markBulkScanned("player", name, nowIso());
  };

  const doClan = async (name) => {
    await upsertClanFromApi(name, { signal });
    await insertLogs("clan", name, { signal });
    markBulkScanned("clan", name, nowIso());
  };

  const PAGE = 200;

  try{
    let offset = 0;
    while (true){
      if (signal.aborted) throw abortError();
      const rows = skipPreviouslyScanned
        ? all(
            `SELECT c.clanName AS clanName
             FROM clans c
             LEFT JOIN bulk_scan_marks b ON b.entityType='clan' AND b.entityLower=c.lowerName
             WHERE b.entityLower IS NULL
             ORDER BY c.lowerName
             LIMIT ? OFFSET ?`,
            [PAGE, offset]
          )
        : all(
            `SELECT clanName FROM clans ORDER BY lowerName LIMIT ? OFFSET ?`,
            [PAGE, offset]
          );
      if (!rows?.length) break;

      for (const r of rows){
        if (signal.aborted) throw abortError();
        const clanName = r?.clanName;
        if (!clanName) continue;

        const currentClan = { entityType:"clan", name:clanName, contextClan:null };
        progressCb?.({ running:true, done, total, current: currentClan });
        try{ await doClan(clanName); }
        catch (e){
          if (e?.name === "AbortError") throw e;
          log("clan", clanName, `Bulk scan failed: ${String(e?.message||e)}`, nowIso(), null);
        }
        tick();
        progressCb?.({ running:true, done, total, current: currentClan });

        // After refreshing clan, scan its members (full index: profiles + logs)
        const clLower = lower(clanName);
        const members = all(
          `SELECT memberName FROM clan_members WHERE clanLower=? ORDER BY memberLower`,
          [clLower]
        ) || [];

        for (const m of members){
          if (signal.aborted) throw abortError();
          const playerName = m?.memberName;
          if (!playerName) continue;
          if (skipPreviouslyScanned && wasBulkScanned("player", playerName)) continue;

          const currentPlayer = { entityType:"player", name:playerName, contextClan:clanName };
          progressCb?.({ running:true, done, total, current: currentPlayer });
          try{ await doPlayer(playerName); }
          catch (e){
            if (e?.name === "AbortError") throw e;
            log("player", playerName, `Bulk scan failed: ${String(e?.message||e)}`, nowIso(), null);
          }
          tick();
          progressCb?.({ running:true, done, total, current: currentPlayer });
        }
      }
      offset += rows.length;
    }

    progressCb?.({ running:false, done, total, current:null });
    saveDb();
    return { ok:true, done, total };
  } catch (e){
    if (e?.name === "AbortError"){
      progressCb?.({ running:false, done, total, current:null, canceled:true });
      saveDb();
      return { ok:false, canceled:true, done, total };
    }
    progressCb?.({ running:false, done, total, current:null, error:String(e?.message||e) });
    saveDb();
    throw e;
  } finally{
    globalThis.__idleclansBulkScanController = null;
  }
}

// Estimate active players: unique players with lastOnlineAt within the last N days.
export function getActivePlayersEstimate(days=7){
  const d = Math.max(1, Math.min(90, Number(days||7)));
  const since = new Date(Date.now() - d*86400000).toISOString();
  return one(
    `SELECT COUNT(1) AS n FROM (
       SELECT DISTINCT playerLower
       FROM presence_samples
       WHERE lastOnlineAt IS NOT NULL AND lastOnlineAt >= ?
     ) x`,
    [since]
  )?.n || 0;
}

export function cancelScanAll(){
  const c = globalThis.__idleclansBulkScanController;
  if (c){
    try{ c.abort(); }catch{}
    return { ok:true };
  }
  return { ok:false, error:"No bulk scan is running" };
}

export function cancelScanClanMembers(){
  const c = globalThis.__idleclansClanMembersScanController;
  if (c){
    try{ c.abort(); }catch{}
    return { ok:true };
  }
  return { ok:false, error:"No clan member scan is running" };
}

// Full refresh for every member of a clan — replaces the old "Scan Members"
// (which only pulled hoursOffline via a lightweight profile call) with a
// complete per-member refresh: full profile (upsertPlayerFromApi, same as
// the player page's "Refresh from API"), activity logs, and leaderboard PvM
// ranks (fetchPlayerPvmProfileAuto). This is 3 API calls per member, so for
// a large clan it can take a while — all calls go through the shared
// apiCallsPerMinute rate limiter via apiGetJson/apiGetJsonAllow404.
//
// Shares the same cancel mechanism (cancelScanClanMembers /
// __idleclansClanMembersScanController) as the old hours-offline scan, since
// only one clan-members scan can run at a time and the UI's existing
// cancel button should keep working unchanged.
export async function refreshClanMembersFull(clanName, progressCb){
  const controller = new AbortController();
  const signal = controller.signal;
  globalThis.__idleclansClanMembersScanController = controller;

  const clanLower = lower(clanName);
  const members = all("SELECT memberName FROM clan_members WHERE clanLower=? ORDER BY memberLower", [clanLower]);
  const total = members.length;
  let done = 0;
  let failed = 0;

  try{
    progressCb?.({ clanName, running:true, done, total, failed });

    for (const m of members){
      if (signal.aborted) throw abortError();

      const name = m?.memberName;
      if (!name){
        done += 1;
        progressCb?.({ clanName, running:true, done, total, failed });
        continue;
      }

      try{
        // Full profile (skills, equipment, hoursOffline, pvmStats, etc.) —
        // same call the player page's "Refresh from API" makes.
        await _upsertPlayerFromApi(name, { signal });

        // Activity logs for this player.
        try{ await _insertLogs("player", name, { signal }); }
        catch(e){ if (e?.name === "AbortError") throw e; }

        // Leaderboard PvM ranks — auto-falls-back across game modes.
        try{
          const fresh = _getPlayer(name);
          const gm = (fresh?.gameMode === "ironman" || fresh?.gameMode === "groupironman") ? fresh.gameMode : "default";
          await _fetchPlayerPvmProfileAuto({ playerName: name, preferredGameMode: gm, signal });
        }catch(e){ if (e?.name === "AbortError") throw e; }

        // Presence sample + inactivity alert, same as the old hours-offline scan.
        const fresh2 = _getPlayer(name);
        const ts = nowIso();
        insertPresenceSample({
          playerName: fresh2?.username || name,
          scannedAt: ts,
          hoursOffline: fresh2?.hoursOffline,
          source: "memberRefresh",
        });
        maybeAlertPlayerInactivity({
          playerName: fresh2?.username || name,
          scannedAt: ts,
          hoursOffline: fresh2?.hoursOffline,
        });
      } catch (e){
        if (e?.name === "AbortError") throw e;
        failed += 1;
        log("clan", clanName, `Member refresh failed for ${name}: ${String(e?.message||e)}`, nowIso(), null);
      }

      done += 1;
      progressCb?.({ clanName, running:true, done, total, failed });
    }

    progressCb?.({ clanName, running:false, done, total, failed });
    saveDb();
    return { ok:true, done, total, failed };
  } catch (e){
    if (e?.name === "AbortError"){
      progressCb?.({ clanName, running:false, done, total, failed, canceled:true });
      saveDb();
      return { ok:false, canceled:true, done, total, failed };
    }
    progressCb?.({ clanName, running:false, done, total, failed, error:String(e?.message||e) });
    saveDb();
    throw e;
  } finally {
    globalThis.__idleclansClanMembersScanController = null;
  }
}

export async function scanClanMembersHoursOffline(clanName, progressCb){
  const controller = new AbortController();
  const signal = controller.signal;
  globalThis.__idleclansClanMembersScanController = controller;

  const clanLower = lower(clanName);
  const members = all("SELECT memberName FROM clan_members WHERE clanLower=? ORDER BY memberLower", [clanLower]);
  const total = members.length;
  let done = 0;

  try{
    progressCb?.({ clanName, running:true, done, total });

    for (const m of members){
      if (signal.aborted) throw abortError();

      const name = m?.memberName;
      if (!name){
        done += 1;
        progressCb?.({ clanName, running:true, done, total });
        continue;
      }

      try{
        const url = `${API_BASE}/Player/profile/${encodeURIComponent(name)}`;
        const data = await apiGetJson(url, { signal });
        const ts = nowIso();
        const hours = (typeof data?.hoursOffline === "number") ? data.hoursOffline : null;
        exec("UPDATE clan_members SET hoursOffline=?, lastScannedAt=? WHERE clanLower=? AND memberLower=?",
          [hours, ts, clanLower, lower(name)]
        );
        // also store player profile for convenience
        upsertPlayerBasic(data?.username || name, data?.guildName || null, data, ts);
        insertPresenceSample({
          playerName: data?.username || name,
          scannedAt: ts,
          hoursOffline: data?.hoursOffline,
          source: "memberScan",
        });
        maybeAlertPlayerInactivity({
          playerName: data?.username || name,
          scannedAt: ts,
          hoursOffline: data?.hoursOffline,
        });
      } catch (e){
        if (e?.name === "AbortError") throw e;
        // log error but continue
        log("clan", clanName, `Member scan failed for ${name}: ${String(e?.message||e)}`, nowIso(), null);
      }

      done += 1;
      progressCb?.({ clanName, running:true, done, total });
    }

    progressCb?.({ clanName, running:false, done, total });
    saveDb();
    return { ok:true, done, total };
  } catch (e){
    if (e?.name === "AbortError"){
      progressCb?.({ clanName, running:false, done, total, canceled:true });
      saveDb();
      return { ok:false, canceled:true, done, total };
    }
    progressCb?.({ clanName, running:false, done, total, error:String(e?.message||e) });
    saveDb();
    throw e;
  } finally {
    globalThis.__idleclansClanMembersScanController = null;
  }
}

// =========================
// Similar-name clan report
// =========================

// ── Clan name matching + cross-clan (extracted to services/clans.js) ────────────
export const getClansWithNameClusters = (...a) => _getClansWithNameClusters(...a);
export const getCrossClanMatches      = (...a) => _getCrossClanMatches(...a);

// ------------------------------------------------------------------
// Cases / dossiers
// ------------------------------------------------------------------

// ── Cases (extracted to services/cases.js) ───────────────────────────────────
export const createCase                  = (...a) => _createCase(...a);
export const listCases                   = (...a) => _listCases(...a);
export const getCase                     = (...a) => _getCase(...a);
export const updateCase                  = (...a) => _updateCase(...a);
export const deleteCase                  = (...a) => _deleteCase(...a);
export const addCaseNote                 = (...a) => _addCaseNote(...a);
export const attachCaseEntity            = (...a) => _attachCaseEntity(...a);
export const detachCaseEntity            = (...a) => _detachCaseEntity(...a);
export const addCaseSnapshot             = (...a) => _addCaseSnapshot(...a);
export const getCaseSnapshot             = (...a) => _getCaseSnapshot(...a);
export const migrateCaseAutoSnapshotColumns = (...a) => _migrateCaseAutoSnapshotColumns(...a);
export const updateCaseAutoSnapshot      = (...a) => _updateCaseAutoSnapshot(...a);
export const getCasesDueForAutoSnapshot  = (...a) => _getCasesDueForAutoSnapshot(...a);
export const markCaseAutoSnapshotTaken   = (...a) => _markCaseAutoSnapshotTaken(...a);

// runCaseAutoSnapshots stays here (depends on lookupPlayerLive + getPlayer — Phase 3)

// Runs auto-snapshots for all due open cases.
// For each due case, does a live API refresh of each attached player entity
// (respects the apiCallsPerMinute rate-limit setting via the shared rateLimit chain),
// then stores the fresh data as an "auto" kind snapshot.
export async function runCaseAutoSnapshots(){
  const due = getCasesDueForAutoSnapshot();
  if (!due.length) return { ran: 0 };

  let ran = 0;
  for (const caseRow of due){
    try{
      const id = caseRow.id;
      const full = getCase(id);
      if (!full) continue;

      const playerEntities = (full.entities || []).filter(e => e.entityType === "player");
      if (!playerEntities.length) continue;

      // Refresh each player via API (honours the global rate-limit chain)
      const playerSnapshots = [];
      for (const e of playerEntities){
        try{
          // lookupPlayerLive calls upsertPlayerFromApi + insertLogs, both of which
          // go through rateLimit(), so we automatically respect apiCallsPerMinute.
          const p = await lookupPlayerLive(e.entityName);
          if (p) playerSnapshots.push({
            name: e.entityName,
            gameMode: p.gameMode || null,
            clan: p.guildName || null,
            hoursOffline: p.hoursOffline ?? null,
            skillExperiences: p.skillExperiences || null,
            equipment: p.equipment || null,
            bannedAt: p.bannedAt || null,
          });
        }catch(playerErr){
          console.warn(`[caseAutoSnapshot] failed to refresh player ${e.entityName}:`, playerErr);
          // Fall back to cached data rather than skipping this player entirely
          try{
            const cached = getPlayer(e.entityName);
            if (cached) playerSnapshots.push({
              name: e.entityName,
              gameMode: cached.gameMode || null,
              clan: cached.guildName || null,
              hoursOffline: cached.hoursOffline ?? null,
              skillExperiences: cached.skillExperiences || null,
              equipment: cached.equipment || null,
              bannedAt: cached.bannedAt || null,
              fromCache: true,
            });
          }catch{}
        }
      }

      if (!playerSnapshots.length) continue;

      const snapshotData = {
        autoSnapshot: true,
        capturedAt: nowIso(),
        intervalHours: caseRow.autoSnapshotIntervalHours,
        players: playerSnapshots,
        refreshedCount: playerSnapshots.filter(p => !p.fromCache).length,
        cachedCount: playerSnapshots.filter(p => p.fromCache).length,
      };

      addCaseSnapshot({
        caseId: id,
        kind: "auto",
        title: `Auto-snapshot (${playerSnapshots.length} player${playerSnapshots.length !== 1 ? "s" : ""})`,
        data: snapshotData,
      });
      markCaseAutoSnapshotTaken(id);
      ran++;
    }catch(err){
      console.error(`[caseAutoSnapshot] failed for case ${caseRow.id}:`, err);
    }
  }
  return { ran };
}

// --- Chat (Live) ---
// Fetches recent chat messages, and (optionally) upserts sender profiles into local storage.
// ── Chat (extracted to services/chat.js) ─────────────────────────────────────
export const getRecentChat          = (...a) => _getRecentChat(...a);
export const getChatMessages        = (...a) => _getChatMessages(...a);
export const getChatMessagesAroundId = (...a) => _getChatMessagesAroundId(...a);
export const getChatMessagesForPlayer = (...a) => _getChatMessagesForPlayer(...a);
export const searchChatMessages     = (...a) => _searchChatMessages(...a);
export const getChatMessagesGlobal  = (...a) => _getChatMessagesGlobal(...a);
export const getChatCategories      = (...a) => _getChatCategories(...a);
export const getChatMessageCounts   = (...a) => _getChatMessageCounts(...a);
export const setChatMentionCallback = (...a) => _setChatMentionCallback(...a);
export const setChatKeywords        = (...a) => _setChatKeywords(...a);
export const setChatIgnoredChannels = (...a) => _setChatIgnoredChannels(...a);
export const getChatScanStatus      = (...a) => _getChatScanStatus(...a);
export const startChatScan          = (...a) => _startChatScan(...a);
export const stopChatScan           = (...a) => _stopChatScan(...a);

// ── Clan PvM profile (extracted to services/pvm.js) ───────────────────────────
export const fetchClanPvmProfile    = (...a) => _fetchClanPvmProfile(...a);
export const getClanPvmSnapshot     = (...a) => _getClanPvmSnapshot(...a);
export const fetchPlayerPvmProfile  = (...a) => _fetchPlayerPvmProfile(...a);
export const fetchPlayerPvmProfileAuto = (...a) => _fetchPlayerPvmProfileAuto(...a);
export const getPlayerPvmLeaderboardSnapshot = (...a) => _getPlayerPvmLeaderboardSnapshot(...a);

// ── Hard delete players ───────────────────────────────────────────────────────
// Removes all traces of the given player names from the DB. They will be
// re-added automatically if they appear in a future scan.
export function deletePlayersHard({ names = [] } = {}){
  if (!Array.isArray(names) || names.length === 0) return { ok:true, deleted:0 };
  const lowers = names.map(n => String(n).trim().toLowerCase()).filter(Boolean);
  if (lowers.length === 0) return { ok:true, deleted:0 };
  const placeholders = lowers.map(()=>"?").join(",");
  const deleted = db.transaction(()=>{
    exec(`DELETE FROM pvm_snapshots        WHERE playerLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM pvm_samples          WHERE playerLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM player_clan_history  WHERE playerLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM tracked              WHERE entityType='player' AND entityLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM logs                 WHERE entityType='player' AND entityLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM account_skill_snapshots WHERE lowerName IN (${placeholders})`, lowers);
    exec(`DELETE FROM verified_accounts    WHERE lowerName IN (${placeholders})`, lowers);
    const res = db.prepare(`DELETE FROM players WHERE lowerName IN (${placeholders})`).run(lowers);
    return res.changes;
  })();
  saveDb();
  return { ok:true, deleted };
}

// ── Hard delete clans ─────────────────────────────────────────────────────────
export function deleteClansHard({ names = [] } = {}){
  if (!Array.isArray(names) || names.length === 0) return { ok:true, deleted:0 };
  const lowers = names.map(n => String(n).trim().toLowerCase()).filter(Boolean);
  if (lowers.length === 0) return { ok:true, deleted:0 };
  const placeholders = lowers.map(()=>"?").join(",");
  const deleted = db.transaction(()=>{
    exec(`DELETE FROM clan_members         WHERE clanLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM clan_pvm_snapshots   WHERE clanLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM tracked              WHERE entityType='clan' AND entityLower IN (${placeholders})`, lowers);
    exec(`DELETE FROM logs                 WHERE entityType='clan' AND entityLower IN (${placeholders})`, lowers);
    const res = db.prepare(`DELETE FROM clans WHERE lowerName IN (${placeholders})`).run(lowers);
    return res.changes;
  })();
  saveDb();
  return { ok:true, deleted };
}
