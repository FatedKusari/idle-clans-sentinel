export const api = {
  // App / auto-update
  appCheckForUpdate: () => requireIdleclans().appCheckForUpdate?.(),
  appGetVersion: () => requireIdleclans().appGetVersion?.(),
  shellOpenExternal: (url) => requireIdleclans().shellOpenExternal?.(url),

  pickImportFile: () => requireIdleclans().pickImportFile?.(),

  getCounts:     () => requireIdleclans().getCounts(),
  getCountsFast: () => requireIdleclans().getCountsFast?.(),
  getDbInfo: () => requireIdleclans().getDbInfo(),
  getApiRateStats: () => requireIdleclans().getApiRateStats?.(),
  pruneBackups: (opts) => requireIdleclans().pruneBackups(opts),
  pickBackupFolder: () => requireIdleclans().pickBackupFolder(),
  getStorageBreakdown: () => requireIdleclans().getStorageBreakdown(),
  deleteAllData: () => requireIdleclans().deleteAllData(),
  importData: (payload) => requireIdleclans().importData(payload),
  cancelImport: (importId) => requireIdleclans().cancelImport?.(importId),

  listPlayers: (q, opts) => requireIdleclans().listPlayers(q, opts||{}),
  listPlayersWithEquipment: (opts) => requireIdleclans().listPlayersWithEquipment(opts||{}),
  getAllPlayerNames: (q, opts) => requireIdleclans().getAllPlayerNames(q||"", opts||{}),
  getPlayersWithItem: (itemId, opts) => requireIdleclans().getPlayersWithItem(itemId, opts||{}),
  getTaskActivitySummary: (opts) => requireIdleclans().getTaskActivitySummary?.(opts||{}),
  getPlayersByTask: (task, opts) => requireIdleclans().getPlayersByTask?.(task, opts||{}),
  listClans: (q, opts) => requireIdleclans().listClans(q, opts||{}),
  getAllClanNames: (q, opts) => requireIdleclans().getAllClanNames(q||"", opts||{}),
  listPotentialClans: (opts) => requireIdleclans().listPotentialClans?.(opts || {}),
  listClanSkillSignals: (opts) => requireIdleclans().listClanSkillSignals(opts),
  getPlayer: (name) => requireIdleclans().getPlayer(name),
  getClan: (name) => requireIdleclans().getClan(name),

  // Live API lookup (exact name)
  previewPlayerLive: (name) => requireIdleclans().previewPlayerLive(name),
  previewClanLive: (name) => requireIdleclans().previewClanLive(name),
  lookupPlayerLive: (name) => requireIdleclans().lookupPlayerLive(name),
  lookupClanLive: (name, opts={}) => requireIdleclans().lookupClanLive(name, opts),

  refreshPlayer: (name) => requireIdleclans().refreshPlayer(name),
  refreshClan: (name) => requireIdleclans().refreshClan(name),

  fetchPlayerLogs: (name) => requireIdleclans().fetchPlayerLogs(name),
  fetchClanLogs: (name) => requireIdleclans().fetchClanLogs(name),
  fetchClanPvmProfile: (p) => requireIdleclans().fetchClanPvmProfile?.(p || {}),
  fetchPlayerPvmProfile: (p) => requireIdleclans().fetchPlayerPvmProfile?.(p || {}),
  fetchPlayerPvmProfileAuto: (p) => requireIdleclans().fetchPlayerPvmProfileAuto?.(p || {}),
  getPlayerPvmLeaderboardSnapshot: (p) => requireIdleclans().getPlayerPvmLeaderboardSnapshot?.(p || {}),
  getClanPvmSnapshot:  (p) => requireIdleclans().getClanPvmSnapshot?.(p || {}),
  deletePlayersHard:   (p) => requireIdleclans().deletePlayersHard?.(p || {}),
  deleteClansHard:     (p) => requireIdleclans().deleteClansHard?.(p || {}),

  scanClanMembers: (clanName) => requireIdleclans().scanClanMembers(clanName),
  cancelScanClanMembers: () => requireIdleclans().cancelScanClanMembers?.(),


  scanAll: (opts) => requireIdleclans().scanAll?.(opts),
  cancelScanAll: () => requireIdleclans().cancelScanAll?.(),

  scanPlayersOnly: (opts) => requireIdleclans().scanPlayersOnly?.(opts || {}),
  scanClansWithMembers: (opts) => requireIdleclans().scanClansWithMembers?.(opts || {}),
  scanStale: (opts) => requireIdleclans().scanStale?.(opts || {}),
  getActivePlayersEstimate: (days=7) => requireIdleclans().getActivePlayersEstimate?.(days),

  // Server status
  getServerInfo: () => requireIdleclans().getServerInfo?.(),
  getServerPopulationStats: (opts={}) => requireIdleclans().getServerPopulationStats?.(opts),


// Leaderboards
listLeaderboardBoards: () => requireIdleclans().listLeaderboardBoards?.(),
getLeaderboardCache: (params) => requireIdleclans().getLeaderboardCache?.(params || {}),
getEntityLeaderboardStandings: (params) => requireIdleclans().getEntityLeaderboardStandings?.(params || {}),
getLeaderboardScanState: (boardKey) => requireIdleclans().getLeaderboardScanState?.(boardKey),
listLeaderboardImportedStubs: (opts) => requireIdleclans().listLeaderboardImportedStubs?.(opts || {}),
clearLeaderboardCache: (boardKey) => requireIdleclans().clearLeaderboardCache?.(boardKey),
scanLeaderboardBoard: (opts) => requireIdleclans().scanLeaderboardBoard?.(opts || {}),
scanAllLeaderboards: (opts) => requireIdleclans().scanAllLeaderboards?.(opts || {}),
cancelLeaderboardScan: () => requireIdleclans().cancelLeaderboardScan?.(),

// Leaderboard snapshots
listLeaderboardSnapshots: (params) => requireIdleclans().listLeaderboardSnapshots?.(params || {}),
countLeaderboardSnapshots: (params) => requireIdleclans().countLeaderboardSnapshots?.(params || {}),
getLeaderboardSnapshot: (snapshotId) => requireIdleclans().getLeaderboardSnapshot?.(snapshotId),
getLeaderboardSnapshotRows: (params) => requireIdleclans().getLeaderboardSnapshotRows?.(params || {}),
createLeaderboardSnapshotFromCache: (params) => requireIdleclans().createLeaderboardSnapshotFromCache?.(params || {}),
createLeaderboardSnapshotFromRows: (params) => requireIdleclans().createLeaderboardSnapshotFromRows?.(params || {}),
deleteLeaderboardSnapshot: (snapshotId) => requireIdleclans().deleteLeaderboardSnapshot?.(snapshotId),

// Leaderboard watches
listLeaderboardWatches: (params) => requireIdleclans().listLeaderboardWatches?.(params || {}),
upsertLeaderboardWatch: (params) => requireIdleclans().upsertLeaderboardWatch?.(params || {}),
deleteLeaderboardWatch: (id) => requireIdleclans().deleteLeaderboardWatch?.(id),
runLeaderboardWatchNow: (id) => requireIdleclans().runLeaderboardWatchNow?.(id),

// Scheduler / automation dashboard
getSchedulerStatus: () => requireIdleclans().getSchedulerStatus?.(),

// Leaderboard scan jobs (persisted)
listLeaderboardJobs: (opts) => requireIdleclans().listLeaderboardJobs?.(opts || {}),
getLeaderboardJob: (jobId) => requireIdleclans().getLeaderboardJob?.(jobId),
startLeaderboardScanAllJob: (opts) => requireIdleclans().startLeaderboardScanAllJob?.(opts || {}),
startLeaderboardCustomJob: (payload) => requireIdleclans().startLeaderboardCustomJob?.(payload || {}),
pauseLeaderboardJob: (jobId) => requireIdleclans().pauseLeaderboardJob?.(jobId),
resumeLeaderboardJob: (jobId) => requireIdleclans().resumeLeaderboardJob?.(jobId),
cancelLeaderboardJob: (jobId) => requireIdleclans().cancelLeaderboardJob?.(jobId),


  getLogs: (entityType, entityName) => requireIdleclans().getLogs(entityType, entityName),

  getLogsDetailed: (entityType, entityName, opts) =>
    requireIdleclans().getLogsDetailed?.(entityType, entityName, opts || {}),
  getVaultTimeline: (params) =>
    requireIdleclans().getVaultTimeline?.(params || {}),
  getVaultContents: (params) =>
    requireIdleclans().getVaultContents?.(params || {}),
  getVaultLeaderboard: (params) =>
    requireIdleclans().getVaultLeaderboard?.(params || {}),

  getPlayerClanHistory: (playerName, limit) => requireIdleclans().getPlayerClanHistory(playerName, limit),
  getClanMemberChanges: (clanName, limit) => requireIdleclans().getClanMemberChanges(clanName, limit),

  getPlayerLastOnlineEvents: (playerName, days, limit) =>
    requireIdleclans().getPlayerLastOnlineEvents(playerName, days, limit),

  getClanLastOnlineEvents: (clanName, days, limit) =>
    requireIdleclans().getClanLastOnlineEvents(clanName, days, limit),

  getSettings: () => requireIdleclans().getSettings(),
  setSetting: (key, value) => requireIdleclans().setSetting(key, value),
  getStaleEntities: (p) => requireIdleclans().getStaleEntities?.(p || {}),
  getStaleRefreshStatus: () => requireIdleclans().getStaleRefreshStatus?.(),

  setTracked: (entityType, name, enabled) => requireIdleclans().setTracked(entityType, name, enabled),
  getTracked: (entityType, name) => requireIdleclans().getTracked(entityType, name),

  setPlayerBanned: (name, banned) => requireIdleclans().setPlayerBanned?.(name, banned),
  banClanMembers: (clanName, banned=true) => requireIdleclans().banClanMembers?.(clanName, banned),
  flagClanMembers: (clanName, enabled=true) => requireIdleclans().flagClanMembers?.(clanName, enabled),
  listBannedPlayers: (limit=500) => requireIdleclans().listBannedPlayers(limit),
  listNotFoundEntities: (opts) => requireIdleclans().listNotFoundEntities?.(opts || {}),
  clearNotFoundEntity: (opts) => requireIdleclans().clearNotFoundEntity?.(opts || {}),
  recheckNotFoundEntity: (opts) => requireIdleclans().recheckNotFoundEntity?.(opts || {}),
  listDormantPlayers:   (opts) => requireIdleclans().listDormantPlayers?.(opts || {}),
  clearDormantPlayer:   (username) => requireIdleclans().clearDormantPlayer?.(username),
  recheckDormantPlayer: (username) => requireIdleclans().recheckDormantPlayer?.(username),
  marketFetchPrices:    (opts) => requireIdleclans().marketFetchPrices?.(opts),
  marketGetSnapshot:    () => requireIdleclans().marketGetSnapshot?.(),
  marketGetPriceChanges:(opts) => requireIdleclans().marketGetPriceChanges?.(opts),
  marketGetTopVolume:   (opts) => requireIdleclans().marketGetTopVolume?.(opts),
  marketGetHistory:     (opts) => requireIdleclans().marketGetHistory?.(opts),
  marketRestartPoll:    () => requireIdleclans().marketRestartPoll?.(),
  marketGetNextFetch:   () => requireIdleclans().marketGetNextFetch?.(),
  onMarketUpdated: (cb) => requireIdleclans().onMarketUpdated?.(cb),
  onMarketAlert:   (cb) => requireIdleclans().onMarketAlert?.(cb),
  accountsVerify:  (token) => requireIdleclans().accountsVerify?.(token),
  accountsList:    () => requireIdleclans().accountsList?.(),
  accountsRemove:  (u) => requireIdleclans().accountsRemove?.(u),
  accountsSnapshotSkills:(u) => requireIdleclans().accountsSnapshotSkills?.(u),
  accountsSkillHistory:  (u,o) => requireIdleclans().accountsSkillHistory?.(u,o),
  accountsSkillLatest:   (u)   => requireIdleclans().accountsSkillLatest?.(u),
  newsFetchLatest: () => requireIdleclans().newsFetchLatest?.(),
  newsList: (limit, offset) => requireIdleclans().newsList?.(limit, offset),
  listFlaggedPlayers: (limit=500) => requireIdleclans().listFlaggedPlayers(limit),
  listFlaggedClans:   (limit=500) => requireIdleclans().listFlaggedClans(limit),
  getPlayersClanMap: (names=[]) => requireIdleclans().getPlayersClanMap({ names }),
  getPvmDelta24h: (name) => requireIdleclans().getPvmDelta24h(name),
  getPvmSnapshotStatus: (name) => requireIdleclans().getPvmSnapshotStatus?.(name),
  takePvmSnapshotNow: (name) => requireIdleclans().takePvmSnapshotNow?.(name),
  getPvmRollingDelta: (params) => requireIdleclans().getPvmRollingDelta?.(params),
  getPvmSampleStats: () => requireIdleclans().getPvmSampleStats?.(),
  getPvmCorrelationRolling: (params) => requireIdleclans().getPvmCorrelationRolling?.(params),
  getPvmCorrelation: (params) => requireIdleclans().getPvmCorrelation(params),
  verifyPvmGroupLeaderboard: (params) => requireIdleclans().verifyPvmGroupLeaderboard?.(params || {}),

  // Reports / alerts / export
  getAlerts: (params) => requireIdleclans().getAlerts(params),
  markAlertRead: (id) => requireIdleclans().markAlertRead(id),
  clearAlerts: (params) => requireIdleclans().clearAlerts(params),
  getAnalyticsSummary: () => requireIdleclans().getAnalyticsSummary?.(),
  getInactiveReport: (params) => requireIdleclans().getInactiveReport(params),
  runIntegrityCheck: () => requireIdleclans().runIntegrityCheck(),
  exportShareableJson: (opts) => requireIdleclans().exportShareableJson?.(opts),
  exportCsv: (params) => requireIdleclans().exportCsv(params),
  exportFullBackup: () => requireIdleclans().exportFullBackup?.(),
  importFullBackup: (json) => requireIdleclans().importFullBackup?.({ json }),
  importFullBackupFromPath: (opts) => requireIdleclans().importFullBackupFromPath?.(opts),

  // Report export (HTML -> PNG/PDF)
  exportHtml: (defaultName, html, format) => requireIdleclans().exportHtml?.(defaultName, html, format),

  // Cross-clan name clusters
  getCrossClanMatches: (params) => requireIdleclans().getCrossClanMatches?.(params || {}),
  saveTextFile: (defaultName, content) => requireIdleclans().saveTextFile(defaultName, content),

  // Game data (item/equipment definitions)
  getGameDataLookup: () => requireIdleclans().getGameDataLookup?.(),
  updateGameData: (opts) => requireIdleclans().updateGameData?.(opts || {}),

  // Chat
  getRecentChat: (params) => requireIdleclans().getRecentChat?.(params || {}),
  getChatMessagesGlobal: (p) => requireIdleclans().getChatMessagesGlobal?.(p||{}),
  getChatMessages: (params) => requireIdleclans().getChatMessages?.(params || {}),
  getChatMessagesAroundId: (params) => requireIdleclans().getChatMessagesAroundId?.(params || {}),
  getChatMessagesForPlayer: (params) => requireIdleclans().getChatMessagesForPlayer?.(params || {}),
  getChatCategories: () => requireIdleclans().getChatCategories?.(),
  getChatMessageCounts: () => requireIdleclans().getChatMessageCounts?.(),

  // Chat background scan (global)
  startChatScan: () => requireIdleclans().startChatScan?.(),
  stopChatScan: () => requireIdleclans().stopChatScan?.(),
  setChatKeywords: (keywords) => requireIdleclans().setChatKeywords?.(keywords),
  setChatIgnoredChannels: (channels) => requireIdleclans().setChatIgnoredChannels?.(channels),
  getChatScanStatus: () => requireIdleclans().getChatScanStatus?.(),
};

export function onScanProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onScanProgress) return () => {};
  return idleclans.onScanProgress(handler);
}

export function onImportProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onImportProgress) return () => {};
  return idleclans.onImportProgress(handler);
}

export function onBulkScanProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onBulkScanProgress) return () => {};
  return idleclans.onBulkScanProgress(handler);
}

export function onStaleRefreshProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onStaleRefreshProgress) return () => {};
  return idleclans.onStaleRefreshProgress(handler);
}

export function onChatScanStatus(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onChatScanStatus) return () => {};
  return idleclans.onChatScanStatus(handler);
}

export function onChatMention(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onChatMention) return () => {};
  return idleclans.onChatMention(handler);
}

export function setChatKeywords(keywords){
  const idleclans = requireIdleclans();
  return idleclans?.setChatKeywords?.(keywords) ?? Promise.resolve({ ok:false });
}

export function setChatIgnoredChannels(channels){
  const idleclans = requireIdleclans();
  return idleclans?.setChatIgnoredChannels?.(channels) ?? Promise.resolve({ ok:false });
}

function requireIdleclans(){
  return window?.idleclans || null;
}


export function onLeaderboardScanProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onLeaderboardScanProgress) return () => {};
  return idleclans.onLeaderboardScanProgress(handler);
}

export function onLeaderboardWatchStatus(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onLeaderboardWatchStatus) return () => {};
  return idleclans.onLeaderboardWatchStatus(handler);
}

export function onLeaderboardWatchTick(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onLeaderboardWatchTick) return () => {};
  return idleclans.onLeaderboardWatchTick(handler);
}

// Helpful for UI health checks
export function isBridgeReady(){
  return !!window?.idleclans;
}

export function onBackupExportProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onBackupExportProgress) return () => {};
  return idleclans.onBackupExportProgress(handler);
}

export function onBackupImportProgress(handler){
  const idleclans = requireIdleclans();
  if (!idleclans?.onBackupImportProgress) return () => {};
  return idleclans.onBackupImportProgress(handler);
}
