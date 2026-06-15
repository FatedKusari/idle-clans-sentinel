// electron/preload.cjs
// This file must be CommonJS because the project is "type: module".
// Electron will silently fail to execute an ESM preload in many setups,
// which means window.idleclans never gets created.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("idleclans", {
  // App / auto-update
  appCheckForUpdate: () => ipcRenderer.invoke("app:checkForUpdate"),
  appGetVersion: () => ipcRenderer.invoke("app:getVersion"),
  shellOpenExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  pickImportFile: () => ipcRenderer.invoke("ui:pickImportFile"),

  // core
  getCounts:     () => ipcRenderer.invoke("db:getCounts"),
  getCountsFast: () => ipcRenderer.invoke("db:getCountsFast"),
  getDbInfo: () => ipcRenderer.invoke("db:getDbInfo"),
  getApiRateStats: () => ipcRenderer.invoke("api:getRateStats"),
  pruneBackups: (opts) => ipcRenderer.invoke("db:pruneBackups", opts),
  pickBackupFolder: () => ipcRenderer.invoke("db:pickBackupFolder"),
  getStorageBreakdown: () => ipcRenderer.invoke("db:getStorageBreakdown"),
  deleteAllData: () => ipcRenderer.invoke("db:deleteAllData"),
  importData: (payload) => ipcRenderer.invoke("db:importData", payload),
  cancelImport: (importId) => ipcRenderer.invoke("db:cancelImport", { importId }),

  listPlayers: (q, opts) => ipcRenderer.invoke("db:listPlayers", q || "", opts||{}),
  listPlayersWithEquipment: (opts) => ipcRenderer.invoke("db:listPlayersWithEquipment", opts||{}),
  getAllPlayerNames: (q, opts) => ipcRenderer.invoke("db:getAllPlayerNames", q || "", opts||{}),
  getPlayersWithItem: (itemId) => ipcRenderer.invoke("db:getPlayersWithItem", { itemId }),
  getTaskActivitySummary: (opts) => ipcRenderer.invoke("db:getTaskActivitySummary", opts||{}),
  getPlayersByTask: (task, opts) => ipcRenderer.invoke("db:getPlayersByTask", { task, ...(opts||{}) }),
  listClans: (q, opts) => ipcRenderer.invoke("db:listClans", q || "", opts||{}),
  getAllClanNames: (q, opts) => ipcRenderer.invoke("db:getAllClanNames", q || "", opts||{}),
  listPotentialClans: (opts) => ipcRenderer.invoke("db:listPotentialClans", opts || {}),
  listClanSkillSignals: (opts) => ipcRenderer.invoke("db:listClanSkillSignals", opts || {}),
  getPlayer: (name) => ipcRenderer.invoke("db:getPlayer", name),
  getClan: (name) => ipcRenderer.invoke("db:getClan", name),

  // Discover / Live API preview (no DB writes)
  previewPlayerLive: (name) => ipcRenderer.invoke("db:previewPlayerLive", { name }),
  previewClanLive: (name) => ipcRenderer.invoke("db:previewClanLive", { name }),

  // Discover / Live API save to DB (exact name)
  lookupPlayerLive: (name) => ipcRenderer.invoke("db:lookupPlayerLive", { name }),
  lookupClanLive: (name, opts={}) => ipcRenderer.invoke("db:lookupClanLive", { name, includeMemberProfiles: !!opts.includeMemberProfiles }),

  // Timelines (read-only, evidence-focused)
  getVaultTimeline: (params) => ipcRenderer.invoke("timeline:getVault", params || {}),
  getVaultContents: (params) => ipcRenderer.invoke("timeline:getVaultContents", params || {}),
  getVaultLeaderboard: (params) => ipcRenderer.invoke("timeline:getVaultLeaderboard", params || {}),
  getMovementTimeline: (params) => ipcRenderer.invoke("timeline:getMovement", params || {}),
  getRecentChat: (params) => ipcRenderer.invoke("chat:getRecent", params),
  getChatMessagesGlobal: (p) => ipcRenderer.invoke("chat:getMessagesGlobal", p),
  getChatMessages: (params) => ipcRenderer.invoke("chat:getMessages", params),
  getChatMessagesAroundId: (params) => ipcRenderer.invoke("chat:getMessagesAroundId", params),
  getChatMessagesForPlayer: (params) => ipcRenderer.invoke("chat:getMessagesForPlayer", params),
  searchChatMessages: (params) => ipcRenderer.invoke("chat:search", params),
  getChatCategories: () => ipcRenderer.invoke("chat:getCategories"),
  getChatMessageCounts: () => ipcRenderer.invoke("chat:getMessageCounts"),

  // Global chat scanning (persists across navigation)
  startChatScan: () => ipcRenderer.invoke("chatScan:start"),
  stopChatScan: () => ipcRenderer.invoke("chatScan:stop"),
  getChatScanStatus: () => ipcRenderer.invoke("chatScan:status"),
  onChatScanStatus: (cb) => {
    const handler = (_e, payload) => cb && cb(payload);
    ipcRenderer.on("chatScan:status", handler);
    return () => ipcRenderer.removeListener("chatScan:status", handler);
  },
  onChatMention: (cb) => {
    const handler = (_e, payload) => cb && cb(payload);
    ipcRenderer.on("chat:mention", handler);
    return () => ipcRenderer.removeListener("chat:mention", handler);
  },
  setChatKeywords: (keywords) => ipcRenderer.invoke("chat:setKeywords", keywords),
  setChatIgnoredChannels: (channels) => ipcRenderer.invoke("chat:setIgnoredChannels", channels),

  refreshPlayer: (name) => ipcRenderer.invoke("api:refreshPlayer", name),
  refreshClan: (name) => ipcRenderer.invoke("api:refreshClan", name),

  fetchPlayerLogs: (name) => ipcRenderer.invoke("api:fetchPlayerLogs", name),
  fetchClanLogs: (name) => ipcRenderer.invoke("api:fetchClanLogs", name),
  fetchClanPvmProfile: (p) => ipcRenderer.invoke("api:fetchClanPvmProfile", p || {}),
  fetchPlayerPvmProfile: (p) => ipcRenderer.invoke("api:fetchPlayerPvmProfile", p || {}),
  fetchPlayerPvmProfileAuto: (p) => ipcRenderer.invoke("api:fetchPlayerPvmProfileAuto", p || {}),
  getPlayerPvmLeaderboardSnapshot: (p) => ipcRenderer.invoke("api:getPlayerPvmLeaderboardSnapshot", p || {}),
  getClanPvmSnapshot:  (p) => ipcRenderer.invoke("db:getClanPvmSnapshot", p || {}),
  deletePlayersHard:   (p) => ipcRenderer.invoke("db:deletePlayersHard", p || {}),
  deleteClansHard:     (p) => ipcRenderer.invoke("db:deleteClansHard", p || {}),

  scanClanMembers: (clanName) => ipcRenderer.invoke("api:scanClanMembers", clanName),
  cancelScanClanMembers: () => ipcRenderer.invoke("api:cancelScanClanMembers"),


  scanAll: (opts) => ipcRenderer.invoke("api:scanAll", opts || {}),
  cancelScanAll: () => ipcRenderer.invoke("api:cancelScanAll"),

  // Home bulk scan variants
  scanPlayersOnly: (opts) => ipcRenderer.invoke("api:scanPlayersOnly", opts || {}),
  scanPlayersList: (opts) => ipcRenderer.invoke("api:scanPlayersList", opts || {}),
  scanClansWithMembers: (opts) => ipcRenderer.invoke("api:scanClansWithMembers", opts || {}),
  scanStale: (opts) => ipcRenderer.invoke("api:scanStale", opts || {}),
  getActivePlayersEstimate: (days) => ipcRenderer.invoke("api:getActivePlayersEstimate", days),

  // Server info (homepage status)
  getServerInfo: () => ipcRenderer.invoke("api:getServerInfo"),
  getServerPopulationStats: (opts={}) => ipcRenderer.invoke("api:getServerPopulationStats", opts),

  getLogs: (entityType, entityName) =>
    ipcRenderer.invoke("db:getLogs", { entityType, entityName }),

  getLogsDetailed: (entityType, entityName, opts) =>
    ipcRenderer.invoke("db:getLogsDetailed", { entityType, entityName, ...(opts||{}) }),

  getPlayerClanHistory: (playerName, limit) =>
    ipcRenderer.invoke("db:getPlayerClanHistory", { playerName, limit }),

  getClanMemberChanges: (clanName, limit) =>
    ipcRenderer.invoke("db:getClanMemberChanges", { clanName, limit }),

  getPlayerLastOnlineEvents: (playerName, days, limit) =>
    ipcRenderer.invoke("db:getPlayerLastOnlineEvents", { playerName, days, limit }),

  getClanLastOnlineEvents: (clanName, days, limit) =>
    ipcRenderer.invoke("db:getClanLastOnlineEvents", { clanName, days, limit }),

  getSettings: () => ipcRenderer.invoke("db:getSettings"),
  setSetting: (key, value) => ipcRenderer.invoke("db:setSetting", { key, value }),
  getStaleEntities: (p) => ipcRenderer.invoke("db:getStaleEntities", p || {}),
  getStaleRefreshStatus: () => ipcRenderer.invoke("db:getStaleRefreshStatus"),

  setTracked: (entityType, name, enabled) =>
    ipcRenderer.invoke("db:setTracked", { entityType, name, enabled }),
  getTracked: (entityType, name) =>
    ipcRenderer.invoke("db:getTracked", { entityType, name }),

  setPlayerBanned: (name, banned) => ipcRenderer.invoke("db:setPlayerBanned", { name, banned }),
  banClanMembers: (clanName, banned=true) => ipcRenderer.invoke("db:banClanMembers", { clanName, banned }),
  flagClanMembers: (clanName, enabled=true) => ipcRenderer.invoke("db:flagClanMembers", { clanName, enabled }),
  listBannedPlayers: (limit) => ipcRenderer.invoke("db:listBannedPlayers", { limit }),
  listNotFoundEntities: (opts) => ipcRenderer.invoke("db:listNotFoundEntities", opts || {}),
  clearNotFoundEntity: (opts) => ipcRenderer.invoke("db:clearNotFoundEntity", opts || {}),
  recheckNotFoundEntity: (opts) => ipcRenderer.invoke("db:recheckNotFoundEntity", opts || {}),
  listDormantPlayers:   (opts) => ipcRenderer.invoke("db:listDormantPlayers",    opts || {}),
  clearDormantPlayer:   (username) => ipcRenderer.invoke("db:clearDormantPlayer",   { username }),
  recheckDormantPlayer: (username) => ipcRenderer.invoke("db:recheckDormantPlayer", { username }),
  marketFetchPrices:    (opts) => ipcRenderer.invoke("market:fetchPrices", opts),
  marketGetSnapshot:    () => ipcRenderer.invoke("market:getSnapshot"),
  marketGetPriceChanges:(opts) => ipcRenderer.invoke("market:getPriceChanges", opts),
  marketGetTopVolume:   (opts) => ipcRenderer.invoke("market:getTopVolume", opts),
  marketGetHistory:     (opts) => ipcRenderer.invoke("market:getHistory", opts),
  marketRestartPoll:    () => ipcRenderer.invoke("market:restartPoll"),
  marketGetNextFetch:   () => ipcRenderer.invoke("market:getNextFetch"),
  onMarketUpdated: (cb) => { ipcRenderer.on("market:updated", (_e,d)=>cb(d)); return ()=>ipcRenderer.removeAllListeners("market:updated"); },
  onMarketAlert:   (cb) => { ipcRenderer.on("market:alert",   (_e,d)=>cb(d)); return ()=>ipcRenderer.removeAllListeners("market:alert");   },
  accountsVerify:  (token) => ipcRenderer.invoke("accounts:verify", token),
  accountsList:    () => ipcRenderer.invoke("accounts:list"),
  accountsRemove:  (u) => ipcRenderer.invoke("accounts:remove", u),
  accountsSnapshotSkills:(u) => ipcRenderer.invoke("accounts:snapshotSkills", u),
  accountsSkillHistory:  (u,o) => ipcRenderer.invoke("accounts:skillHistory", u, o),
  accountsSkillLatest:   (u)   => ipcRenderer.invoke("accounts:skillLatest", u),
  accountsSkillLatest:   (u) => ipcRenderer.invoke("accounts:skillLatest", u),
  newsFetchLatest: () => ipcRenderer.invoke("news:fetchLatest"),
  newsList: (limit, offset) => ipcRenderer.invoke("news:list", limit, offset),
  listFlaggedPlayers: (limit) => ipcRenderer.invoke("db:listFlaggedPlayers", { limit }),
  listFlaggedClans:   (limit) => ipcRenderer.invoke("db:listFlaggedClans",   { limit }),
  getPlayersClanMap: (names) => ipcRenderer.invoke("db:getPlayersClanMap", { names }),

  // PvM tracking
  getPvmDelta24h: (name) => ipcRenderer.invoke("db:getPvmDelta24h", { name }),
  getPvmSnapshotStatus: (name) => ipcRenderer.invoke("db:getPvmSnapshotStatus", { name }),
  takePvmSnapshotNow: (name) => ipcRenderer.invoke("db:takePvmSnapshotNow", { name }),
  getPvmRollingDelta: (params) => ipcRenderer.invoke("db:getPvmRollingDelta", params || {}),
  getPvmSampleStats: () => ipcRenderer.invoke("db:getPvmSampleStats"),
  getPvmCorrelationRolling: (params) => ipcRenderer.invoke("db:getPvmCorrelationRolling", params || {}),
  getPvmCorrelation: (params) => ipcRenderer.invoke("db:getPvmCorrelation", params || {}),
  verifyPvmGroupLeaderboard: (params) => ipcRenderer.invoke("db:verifyPvmGroupLeaderboard", params || {}),

  // Reports / alerts / export
  getAlerts: (params) => ipcRenderer.invoke("db:getAlerts", params || {}),
  markAlertRead: (id) => ipcRenderer.invoke("db:markAlertRead", { id }),
  clearAlerts: (params) => ipcRenderer.invoke("db:clearAlerts", params || {}),
  getAnalyticsSummary: () => ipcRenderer.invoke("db:getAnalyticsSummary"),
  getInactiveReport: (params) => ipcRenderer.invoke("db:getInactiveReport", params || {}),
  runIntegrityCheck: () => ipcRenderer.invoke("db:runIntegrityCheck"),
  exportShareableJson: (opts) => ipcRenderer.invoke("db:exportShareableJson", opts),
  exportCsv: (params) => ipcRenderer.invoke("db:exportCsv", params || {}),
  exportFullBackup: () => ipcRenderer.invoke("db:exportFullBackup"),
  importFullBackupFromPath: (opts) => ipcRenderer.invoke("db:importFullBackupFromPath", opts),
  getClansWithNameClusters: (params) => ipcRenderer.invoke("db:getClansWithNameClusters", params || {}),
  getCrossClanMatches: (params) => ipcRenderer.invoke("db:getCrossClanMatches", params || {}),
  saveTextFile: (defaultName, content) => ipcRenderer.invoke("ui:saveTextFile", { defaultName, content }),
  exportHtml: (defaultName, html, format) => ipcRenderer.invoke("ui:exportHtml", { defaultName, html, format }),

  // Timeline
  getVaultTimeline: (params) => ipcRenderer.invoke("timeline:getVault", params || {}),
  getVaultContents: (params) => ipcRenderer.invoke("timeline:getVaultContents", params || {}),
  getVaultLeaderboard: (params) => ipcRenderer.invoke("timeline:getVaultLeaderboard", params || {}),
  getMovementTimeline: (params) => ipcRenderer.invoke("timeline:getMovement", params || {}),

  // Cases / dossiers
  createCase: (title, summary) => ipcRenderer.invoke("cases:create", { title, summary }),
  listCases: () => ipcRenderer.invoke("cases:list"),
  getCase: (caseId) => ipcRenderer.invoke("cases:get", { caseId }),
  updateCase: (payload) => ipcRenderer.invoke("cases:update", payload),
  deleteCase: (caseId) => ipcRenderer.invoke("cases:delete", { caseId }),
  addCaseNote: (caseId, note) => ipcRenderer.invoke("cases:addNote", { caseId, note }),
  attachCaseEntity: (caseId, entityType, entityName) => ipcRenderer.invoke("cases:attachEntity", { caseId, entityType, entityName }),
  detachCaseEntity: (caseId, entityType, entityName) => ipcRenderer.invoke("cases:detachEntity", { caseId, entityType, entityName }),
  addCaseSnapshot: (caseId, kind, title, data) => ipcRenderer.invoke("cases:addSnapshot", { caseId, kind, title, data }),
  getCaseSnapshot: (snapshotId) => ipcRenderer.invoke("cases:getSnapshot", { snapshotId }),
  updateCaseAutoSnapshot: (payload) => ipcRenderer.invoke("cases:updateAutoSnapshot", payload || {}),
  runCaseAutoSnapshots: () => ipcRenderer.invoke("cases:runAutoSnapshots"),

  // Game data (item/equipment definitions)
  getGameDataLookup: () => ipcRenderer.invoke("gameData:getLookup"),
  getGameDataEvents: () => ipcRenderer.invoke("gameData:getEvents"),
  updateGameData: (opts) => ipcRenderer.invoke("gameData:update", opts || {}),


// Leaderboards
listLeaderboardBoards: () => ipcRenderer.invoke("leaderboards:listBoards"),
getLeaderboardCache: (params) => ipcRenderer.invoke("leaderboards:getCache", params || {}),
getEntityLeaderboardStandings: (params) => ipcRenderer.invoke("leaderboards:getEntityStandings", params || {}),
getLeaderboardScanState: (boardKey) => ipcRenderer.invoke("leaderboards:getState", { boardKey }),
listLeaderboardImportedStubs: (opts) => ipcRenderer.invoke("leaderboards:listImportedStubs", opts || {}),
clearLeaderboardCache: (boardKey) => ipcRenderer.invoke("leaderboards:clearCache", { boardKey }),
scanLeaderboardBoard: (opts) => ipcRenderer.invoke("leaderboards:scanBoard", opts || {}),
scanAllLeaderboards: (opts) => ipcRenderer.invoke("leaderboards:scanAll", opts || {}),
cancelLeaderboardScan: () => ipcRenderer.invoke("leaderboards:cancelScan"),

// Leaderboard snapshots
listLeaderboardSnapshots: (params) => ipcRenderer.invoke("leaderboards:snapshots:list", params || {}),
countLeaderboardSnapshots: (params) => ipcRenderer.invoke("leaderboards:snapshots:count", params || {}),
getLeaderboardSnapshot: (snapshotId) => ipcRenderer.invoke("leaderboards:snapshots:get", { snapshotId }),
getLeaderboardSnapshotRows: (params) => ipcRenderer.invoke("leaderboards:snapshots:getRows", params || {}),
createLeaderboardSnapshotFromCache: (params) => ipcRenderer.invoke("leaderboards:snapshots:createFromCache", params || {}),
    createLeaderboardSnapshotFromRows: (params) => ipcRenderer.invoke("leaderboards:snapshots:createFromRows", params || {}),
deleteLeaderboardSnapshot: (snapshotId) => ipcRenderer.invoke("leaderboards:snapshots:delete", { snapshotId }),

// Leaderboard watches
listLeaderboardWatches: (params) => ipcRenderer.invoke("leaderboards:watches:list", params || {}),
upsertLeaderboardWatch: (params) => ipcRenderer.invoke("leaderboards:watches:upsert", params || {}),
deleteLeaderboardWatch: (id) => ipcRenderer.invoke("leaderboards:watches:delete", { id }),
runLeaderboardWatchNow: (id) => ipcRenderer.invoke("leaderboards:watches:runNow", { id }),
onLeaderboardWatchStatus: (handler) => {
  const listener = (_evt, payload) => handler && handler(payload);
  ipcRenderer.on("leaderboardWatch:status", listener);
  return () => ipcRenderer.removeListener("leaderboardWatch:status", listener);
},
	onLeaderboardWatchTick: (handler) => {
	  const listener = (_evt, payload) => handler && handler(payload);
	  ipcRenderer.on("leaderboardWatch:tick", listener);
	  return () => ipcRenderer.removeListener("leaderboardWatch:tick", listener);
	},

// Scheduler / automation dashboard
getSchedulerStatus: () => ipcRenderer.invoke("scheduler:getStatus"),

// Leaderboard scan jobs (persisted)
listLeaderboardJobs: (opts) => ipcRenderer.invoke("leaderboards:jobs:list", opts || {}),
getLeaderboardJob: (jobId) => ipcRenderer.invoke("leaderboards:jobs:get", { jobId }),
startLeaderboardScanAllJob: (opts) => ipcRenderer.invoke("leaderboards:jobs:startScanAll", opts || {}),
startLeaderboardCustomJob: (payload) => ipcRenderer.invoke("leaderboards:jobs:startCustom", payload || {}),
pauseLeaderboardJob: (jobId) => ipcRenderer.invoke("leaderboards:jobs:pause", { jobId }),
resumeLeaderboardJob: (jobId) => ipcRenderer.invoke("leaderboards:jobs:resume", { jobId }),
cancelLeaderboardJob: (jobId) => ipcRenderer.invoke("leaderboards:jobs:cancel", { jobId }),
onLeaderboardScanProgress: (handler) => {
  const listener = (_evt, payload) => handler(payload);
  ipcRenderer.on("leaderboardScan:progress", listener);
  return () => ipcRenderer.removeListener("leaderboardScan:progress", listener);
},

  onScanProgress: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on("scan:progress", listener);
    return () => ipcRenderer.removeListener("scan:progress", listener);
  },

  onImportProgress: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on("import:progress", listener);
    return () => ipcRenderer.removeListener("import:progress", listener);
  },

  onBulkScanProgress: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on("bulkScan:progress", listener);
    return () => ipcRenderer.removeListener("bulkScan:progress", listener);
  },
  onStaleRefreshProgress: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on("staleRefresh:progress", listener);
    return () => ipcRenderer.removeListener("staleRefresh:progress", listener);
  },
  onBackupExportProgress: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on("backup:exportProgress", listener);
    return () => ipcRenderer.removeListener("backup:exportProgress", listener);
  },
  onBackupImportProgress: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on("backup:importProgress", listener);
    return () => ipcRenderer.removeListener("backup:importProgress", listener);
  },
  setTheme: (theme) => ipcRenderer.send("app:setTheme", theme),
  resetCloseBehaviour: () => ipcRenderer.send("app:resetCloseBehaviour"),
  getCloseBehaviour: () => ipcRenderer.invoke("app:getCloseBehaviour"),
  setCloseBehaviour: (val) => ipcRenderer.send("app:setCloseBehaviour", val),
});
