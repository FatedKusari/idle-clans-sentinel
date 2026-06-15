import { contextBridge, ipcRenderer } from "electron";

// NOTE: This ESM preload is kept for reference, but the app uses preload.cjs by default.
// (Electron can silently fail to execute ESM preload in some setups.)
contextBridge.exposeInMainWorld("idleclans", {
  pickImportFile: () => ipcRenderer.invoke("ui:pickImportFile"),

  getCounts: () => ipcRenderer.invoke("db:getCounts"),
  getDbInfo: () => ipcRenderer.invoke("db:getDbInfo"),
  deleteAllData: () => ipcRenderer.invoke("db:deleteAllData"),
  importData: (payload) => ipcRenderer.invoke("db:importData", payload),
  cancelImport: (importId) => ipcRenderer.invoke("db:cancelImport", { importId }),

  listPlayers: (q) => ipcRenderer.invoke("db:listPlayers", q || ""),
  listClans: (q) => ipcRenderer.invoke("db:listClans", q || ""),
  listPotentialClans: (opts) => ipcRenderer.invoke("db:listPotentialClans", opts || {}),
  getPlayer: (name) => ipcRenderer.invoke("db:getPlayer", name),
  getClan: (name) => ipcRenderer.invoke("db:getClan", name),

  // Live API lookup
  lookupPlayerLive: (name) => ipcRenderer.invoke("db:lookupPlayerLive", { name }),
  lookupClanLive: (name, opts={}) => ipcRenderer.invoke("db:lookupClanLive", { name, includeMemberProfiles: !!opts.includeMemberProfiles }),

  // Timelines
  getVaultTimeline: (params) => ipcRenderer.invoke("timeline:getVault", params || {}),
  getMovementTimeline: (params) => ipcRenderer.invoke("timeline:getMovement", params || {}),

  refreshPlayer: (name) => ipcRenderer.invoke("api:refreshPlayer", name),
  refreshClan: (name) => ipcRenderer.invoke("api:refreshClan", name),

  fetchPlayerLogs: (name) => ipcRenderer.invoke("api:fetchPlayerLogs", name),
  fetchClanLogs: (name) => ipcRenderer.invoke("api:fetchClanLogs", name),

  scanClanMembers: (clanName) => ipcRenderer.invoke("api:scanClanMembers", clanName),

  scanAll: (opts) => ipcRenderer.invoke("api:scanAll", opts || {}),
  cancelScanAll: () => ipcRenderer.invoke("api:cancelScanAll"),

  // Server info (homepage status)
  getServerInfo: () => ipcRenderer.invoke("api:getServerInfo"),
  getServerPopulationStats: (opts={}) => ipcRenderer.invoke("api:getServerPopulationStats", opts),

  getLogs: (entityType, entityName) => ipcRenderer.invoke("db:getLogs", { entityType, entityName }),
  getLogsDetailed: (entityType, entityName, opts) => ipcRenderer.invoke("db:getLogsDetailed", { entityType, entityName, ...(opts||{}) }),

  getSettings: () => ipcRenderer.invoke("db:getSettings"),
  setSetting: (key, value) => ipcRenderer.invoke("db:setSetting", { key, value }),

  setTracked: (entityType, name, enabled) => ipcRenderer.invoke("db:setTracked", { entityType, name, enabled }),
  getTracked: (entityType, name) => ipcRenderer.invoke("db:getTracked", { entityType, name }),

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
});
