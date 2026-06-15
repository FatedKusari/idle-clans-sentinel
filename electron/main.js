import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, globalShortcut, screen, protocol, net } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import {
  initDb,
  getCounts,
  getCountsFast,
  getDbInfo,
  getApiRateStats,
  pruneBackups,
  pickBackupFolder,
  getStorageBreakdown,
  deleteAllData,
  importData,
  listPlayers,
  listPlayersWithEquipment,
  getPlayersWithItem,
  getTaskActivitySummary,
  getPlayersByTask,
  listClans,
  listClanSkillSignals,
  getPlayer,
  getClan,
  getLogs,
  getLogsDetailed,
  listPotentialClans,
  setPlayerBanned,
  banClanMembers,
  flagClanMembers,
  listBannedPlayers,
  listFlaggedPlayers,
  listFlaggedClans,
  listNotFoundEntities,
  clearNotFoundEntity,
  recheckNotFoundEntity,
  listDormantPlayers,
  clearDormantPlayer,
  recheckDormantPlayer,
  fetchLatestNews,
  verifyAccountToken,
  snapshotAccountSkills,
  getAccountSkillHistory,
  getAccountSkillLatest,
  listVerifiedAccounts,
  getFirstLinkedAccount,
  removeVerifiedAccount,
  fetchMarketPrices,
  getMarketSnapshot,
  getMarketPriceChanges,
  getMarketTopVolume,
  getMarketHistory,
  listNews,
  getPlayersClanMap,
  getPvmDelta24h,
  getPvmSnapshotStatus,
  takePvmSnapshotNow,
  getPvmCorrelation,
  getPvmRollingDelta,
  getPvmSampleStats,
  getPvmCorrelationRolling,
  verifyPvmGroupLeaderboard,
  getSettings,
  setSetting,
  getStaleEntities,
  setTracked,
  getTracked,
  upsertPlayerFromApi,
  upsertClanFromApi,
  insertLogs,
  lookupPlayerLive,
  lookupClanLive,
  previewPlayerLive,
  previewClanLive,
  refreshClanMembersFull,
  getPlayerClanHistory,
  getClanMemberChanges,
  getPlayerLastOnlineEvents,
  getClanLastOnlineEvents,
  // reports / alerts / export
  getAlerts,
  markAlertRead,
  clearAlerts,
  getInactiveReport,
  getAnalyticsSummary,
  runIntegrityCheck,
  exportCsv,
  exportShareableJson,
  exportFullBackup,
  importFullBackup,
  getClansWithNameClusters,
  getCrossClanMatches,
  scanAll,
  scanPlayersOnly,
  scanPlayersList,
  scanClansWithMembers,
  getActivePlayersEstimate,
  cancelScanAll,
  cancelScanClanMembers,
  getServerInfo,
  getServerPopulationStats,
  getGameDataLookup,
  updateGameData,
  // cases
  createCase,
  listCases,
  getCase,
  updateCase,
  deleteCase,
  addCaseNote,
  attachCaseEntity,
  detachCaseEntity,
  addCaseSnapshot,
  getCaseSnapshot,
  updateCaseAutoSnapshot,
  runCaseAutoSnapshots,
  getVaultTimeline,
  getVaultContents,
  getVaultLeaderboard,
  getMovementTimeline,
  getRecentChat,
  getChatMessages,
  getChatMessagesAroundId,
  getChatCategories,
  getChatMessagesGlobal,
  getChatMessageCounts,
  startChatScan,
  stopChatScan,
  setChatMentionCallback,
  setChatKeywords,
  setChatIgnoredChannels,
  getChatScanStatus,  getChatMessagesForPlayer,
  searchChatMessages,
  // leaderboards
  scanLeaderboardBoard,
  cancelLeaderboardScan,
  getLeaderboardCache,
  getEntityLeaderboardStandings,
  listLeaderboardBoards,
  getLeaderboardScanState,
  clearLeaderboardCache,
  listLeaderboardImportedStubs,
  // leaderboard snapshots
  listLeaderboardSnapshots,
  countLeaderboardSnapshots,
  getLeaderboardSnapshot,
  getLeaderboardSnapshotRows,
  createLeaderboardSnapshotFromCache,
  createLeaderboardSnapshotFromRows,
  deleteLeaderboardSnapshot,
  // leaderboard watches
  listLeaderboardWatches,
  upsertLeaderboardWatch,
  deleteLeaderboardWatch,
  runLeaderboardWatchNow,
  getSchedulerStatus,
  runOneDueLeaderboardWatch,
  // leaderboard jobs
  createLeaderboardJob,
  getLeaderboardJob,
  listLeaderboardJobs,
  updateLeaderboardJob,
  setLeaderboardJobPlan,
  fetchClanPvmProfile,
  fetchPlayerPvmProfile,
  fetchPlayerPvmProfileAuto,
  getPlayerPvmLeaderboardSnapshot,
  getClanPvmSnapshot,
  deletePlayersHard,
  deleteClansHard,
  setDbPathOverride,
} from "./services.js";

// Register asset:// protocol for serving bundled assets (game images etc.)
protocol.registerSchemesAsPrivileged([
  { scheme: "asset", privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);

// Reduce Chromium GPU-process crashes on some systems.
// Sentinel does not rely on GPU acceleration.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let appTray    = null;
let currentTheme = "forest";
const importControllers = new Map(); // importId -> AbortController

// -------------------------------
// DevTools helper (reliable open)
// -------------------------------
// Opens DevTools reliably in dev builds, and optionally in packaged builds if SENTINEL_DEVTOOLS=1.
function attachAutoDevTools(win){
  const force = (!app.isPackaged) || process.env.SENTINEL_DEVTOOLS === "1" || !!process.env.VITE_DEV_SERVER_URL;
  if (!force) return;

  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    try{ win.webContents.openDevTools({ mode: "detach" }); }catch(err){
      try{ console.warn("[devtools] openDevTools failed:", err); }catch{}
    }
  };

  // Try multiple lifecycle hooks for reliability across platforms and load failures.
  win.webContents.once("dom-ready", open);
  win.webContents.once("did-finish-load", open);
  win.once("ready-to-show", open);

  // Absolute fallback for odd timing issues.
  setTimeout(open, 250);
}

// Leaderboard scan job runner (persisted; survives restarts via DB)
let activeLeaderboardJob = null; // { jobId:number, pauseRequested:boolean }

function buildScanAllPlan(maxRank=null){
  const SKILLS = [
    "total_level","attack","strength","defence","archery","magic","health","crafting","woodcutting","carpentry","fishing","cooking","mining","smithing","thieving","farming","alchemy","enhancing","sailing","foraging","husbandry"
  ];
  const BOSSES = ["zeus","medusa","griffin","hades","chimera","wyvern","kraken","manticore","fenrir"];
  const RAIDS = ["guardians_of_the_citadel","reckoning_of_the_gods","bloodmoon_massacre"];
  const GAME_MODES = ["default","ironman","groupironman"];

  const rankLimit = (Number.isFinite(Number(maxRank)) && Number(maxRank) > 0) ? Math.floor(Number(maxRank)) : null;
  const withLimit = (item) => rankLimit ? { ...item, maxRank: rankLimit } : item;

  const plan = [];
  for (const gm of GAME_MODES){
    for (const cat of [...SKILLS, ...BOSSES, ...RAIDS]) plan.push(withLimit({ entityType:"players", gameMode:gm, category:cat }));
  }
  for (const gm of GAME_MODES){
    for (const cat of SKILLS) plan.push(withLimit({ entityType:"clans", gameMode:gm, category:cat }));
    for (const cat of SKILLS) plan.push(withLimit({ entityType:"pets", gameMode:gm, category:cat }));
  }
  return plan;
}

function labelForPlanItem(item){
  const et = String(item?.entityType||"").toLowerCase();
  const gm = String(item?.gameMode||"");
  const cat = String(item?.category||"");
  const etNice = et ? (et[0].toUpperCase()+et.slice(1)) : "";
  const gmNice = gm ? (gm[0].toUpperCase()+gm.slice(1)) : "";
  const catNice = cat.replaceAll("_"," ");
  return `${etNice} · ${gmNice} · ${catNice}`.trim();
}

async function runLeaderboardJob(jobId){
  const id = Number(jobId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid jobId");

  // Prevent two jobs running at once.
  if (activeLeaderboardJob && activeLeaderboardJob.jobId !== id){
    throw new Error("Another leaderboard job is already running");
  }

  const job = getLeaderboardJob(id);
  if (!job) throw new Error("Job not found");
  if (job.status === "done" || job.status === "cancelled") return job;

  activeLeaderboardJob = { jobId: id, pauseRequested: false };
  updateLeaderboardJob(id, { status: "running", lastError: null });

  const plan = Array.isArray(job.plan) ? job.plan : [];
  const options = job.options || {};
  const importMissing = !!options.importMissing;
  const clearCache = ("clearCache" in options) ? !!options.clearCache : false;
  const refreshProfiles = !!options.refreshProfiles;

  let idx = Number(job.currentIndex || 0);
  if (!Number.isFinite(idx) || idx < 0) idx = 0;

  for (; idx < plan.length; idx++){
    const item = plan[idx];
    const boardKey = `${item.entityType}:${item.gameMode}|${item.category}`;
    const label = labelForPlanItem(item);

    // Persist current board marker.
    updateLeaderboardJob(id, { currentIndex: idx, currentBoardKey: boardKey, currentLabel: label, status: "running" });

    const overall = {
      jobId: id,
      jobStatus: "running",
      overallDone: idx,
      overallTotal: plan.length,
      overallPct: plan.length ? Math.round((idx/plan.length)*100) : 0,
      currentLabel: label,
      currentBoardKey: boardKey,
    };

    try{
      const res = await scanLeaderboardBoard({
        ...item,
        resume: true, // always resume within a board using leaderboard_scan_state
        importMissing,
        clearCache,
        refreshProfiles,
      }, (p)=>{
        try{ mainWindow?.webContents?.send("leaderboardScan:progress", { ...p, ...overall }); }catch{}
      });

      // If paused mid-board, scanLeaderboardBoard returns status "stopped".
      if (res?.status === "stopped"){
        updateLeaderboardJob(id, { status: "paused", currentIndex: idx, currentBoardKey: boardKey, currentLabel: label });
        try{ mainWindow?.webContents?.send("leaderboardScan:progress", { jobId:id, jobStatus:"paused", status:"paused", ...overall }); }catch{}
        activeLeaderboardJob = null;
        return getLeaderboardJob(id);
      }

      // If board errored, pause job and keep cursor.
      if (res?.status === "error"){
        updateLeaderboardJob(id, { status: "paused", currentIndex: idx, currentBoardKey: boardKey, currentLabel: label, lastError: res?.error || "error" });
        try{ mainWindow?.webContents?.send("leaderboardScan:progress", { jobId:id, jobStatus:"paused", status:"paused", error: res?.error || "error", ...overall }); }catch{}
        activeLeaderboardJob = null;
        return getLeaderboardJob(id);
      }

      // Completed this board.
      const after = {
        jobId: id,
        jobStatus: "running",
        overallDone: idx+1,
        overallTotal: plan.length,
        overallPct: plan.length ? Math.round(((idx+1)/plan.length)*100) : 0,
        currentLabel: label,
        currentBoardKey: boardKey,
      };
      try{ mainWindow?.webContents?.send("leaderboardScan:progress", { ...res, running:false, status: res.status || "done", ...after }); }catch{}

    }catch(err){
      updateLeaderboardJob(id, { status: "paused", currentIndex: idx, currentBoardKey: boardKey, currentLabel: label, lastError: String(err?.message||err) });
      try{ mainWindow?.webContents?.send("leaderboardScan:progress", { jobId:id, jobStatus:"paused", status:"paused", error:String(err?.message||err), ...overall }); }catch{}
      activeLeaderboardJob = null;
      return getLeaderboardJob(id);
    }
  }

  updateLeaderboardJob(id, { status: "done", currentIndex: plan.length, currentBoardKey: null, currentLabel: null, lastError: null });
  try{ mainWindow?.webContents?.send("leaderboardScan:progress", { jobId:id, jobStatus:"done", status:"allCompleted", overallDone: plan.length, overallTotal: plan.length, overallPct: 100 }); }catch{}
  activeLeaderboardJob = null;
  return getLeaderboardJob(id);
}


/**
 * Execute JS in the export window with retries.
 * Electron/Chromium occasionally throws "Script failed to execute" during early lifecycle / heavy layout.
 */
async function safeExecute(webContents, js, { retries = 6, delayMs = 80 } = {}){
  let lastErr = null;
  for (let i = 0; i < retries; i++){
    try{
      return await webContents.executeJavaScript(js, true);
    }catch(e){
      lastErr = e;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  throw lastErr;
}

async function waitForDomReady(webContents, { timeoutMs = 5000 } = {}){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    try{
      const ready = await safeExecute(webContents, "document && document.readyState", { retries: 1 });
      if (ready === "complete" || ready === "interactive") return true;
    }catch{}
    await new Promise(res => setTimeout(res, 60));
  }
  return false;
}

async function exportHtmlToFile({ html, format, defaultName }){
  const fmt = String(format || "pdf").toLowerCase();
  const isPng = fmt === "png";

  const filters = isPng
    ? [{ name: "PNG Image", extensions: ["png"] }]
    : [{ name: "PDF", extensions: ["pdf"] }];

  const suggested = defaultName || (isPng ? "report.png" : "report.pdf");
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: suggested, filters });
  if (r.canceled || !r.filePath) return { ok:false, canceled:true };

  // Use a wide hidden window — height will be adjusted for PNG after load.
  const exportWin = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let tmpDir = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-export-"));
    const tmpHtmlPath = path.join(tmpDir, "report.html");

    let finalHtml = String(html || "");

    // Inject logo if placeholder present
    let logoDataUrl = "";
    try{
      const candidates = [
        path.join(__dirname, "assets", "icon.png"),
        path.join(__dirname, "..", "public", "sentinel-logo.png"),
        path.join(__dirname, "..", "src", "assets", "sentinel-logo.png"),
      ];
      const logoPath = candidates.find(p=>fs.existsSync(p));
      if (logoPath){
        const b64 = fs.readFileSync(logoPath).toString("base64");
        const ext = path.extname(logoPath).toLowerCase() === ".svg" ? "svg+xml" : "png";
        logoDataUrl = `data:image/${ext};base64,${b64}`;
      }
    }catch{}
    if (logoDataUrl && finalHtml.includes("<!--LOGO-->")){
      finalHtml = finalHtml.replace("<!--LOGO-->", `<img alt="IdleClans" src="${logoDataUrl}" />`);
    }

    fs.writeFileSync(tmpHtmlPath, finalHtml, "utf8");
    await exportWin.loadFile(tmpHtmlPath);

    // Wait for layout to settle
    await new Promise(res => setTimeout(res, 350));

    if (isPng){
      // Measure the full document height so we capture the entire report
      const pageHeight = await exportWin.webContents.executeJavaScript(
        "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)"
      );
      const targetW = 1200;
      const targetH = Math.max(400, Math.min(Number(pageHeight) || 900, 32000));

      // Resize to match full content — no scrollbars, no clipping
      exportWin.setSize(targetW, targetH);
      try { exportWin.setContentSize(targetW, targetH); } catch {}
      await new Promise(res => setTimeout(res, 200));

      const rect = { x: 0, y: 0, width: targetW, height: targetH };
      const img = await exportWin.webContents.capturePage(rect);
      fs.writeFileSync(r.filePath, img.toPNG());
      return { ok:true, path:r.filePath };
    }

    // PDF: use printToPDF with proper settings for a readable document
    const pdfBuf = await exportWin.webContents.printToPDF({
      printBackground: false,   // white bg — no dark theme bleed
      margins: { marginType: "printableArea" },
      pageSize: "A4",
      landscape: false,
    });
    fs.writeFileSync(r.filePath, pdfBuf);
    return { ok:true, path:r.filePath };
  } finally {
    try{ exportWin.destroy(); }catch{}
    try{ if (tmpDir) fs.rmSync(tmpDir, { recursive:true, force:true }); }catch{}
  }
}



// ── System tray ───────────────────────────────────────────────────────────────
function showMainWindow(){
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setupTray(){
  const iconPath = path.join(__dirname, "assets", "icon.png");
  let trayIcon;
  try{
    trayIcon = nativeImage.createFromPath(iconPath);
    // Scale down for tray — 16x16 or 32x32 is ideal on Windows
    if (!trayIcon.isEmpty()) trayIcon = trayIcon.resize({ width:16, height:16 });
  }catch{
    trayIcon = nativeImage.createEmpty();
  }

  appTray = new Tray(trayIcon);
  appTray.setToolTip("Idle Clans Sentinel");

  const buildMenu = () => Menu.buildFromTemplate([
    { label:"Show Sentinel", click: showMainWindow },
    { type:"separator" },
    { label:"Quit", click: ()=>{ app.isQuitting = true; app.quit(); } },
  ]);

  appTray.setContextMenu(buildMenu());
  appTray.on("double-click", showMainWindow);
}

// Show a tray balloon notification when a mention fires while window is hidden.
// Maps theme name to accent hex colour — matches styles.css
const THEME_ACCENT = {
  forest:   "#22c55e",
  midnight: "#3b82f6",
  crimson:  "#ef4444",
  void:     "#8b5cf6",
  amber:    "#f59e0b",
};

// Custom overlay toast — bypasses Windows notification system entirely.
// Creates a small always-on-top frameless window in the bottom-right corner.
let toastWindow = null;
let toastTimer  = null;

function showOverlayToast({ title, body, duration = 5000 }){
  try{
    if (toastWindow && !toastWindow.isDestroyed()) toastWindow.destroy();
    clearTimeout(toastTimer);

    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.workAreaSize;
    const W = 320;

    // Build HTML first so we can measure required height
    const safeTitle = title.replace(/&/g,"&amp;").replace(/</g,"&lt;");
    const safeBody  = body.replace(/&/g,"&amp;").replace(/</g,"&lt;");
    const accent = THEME_ACCENT[currentTheme] || "#22c55e";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;overflow:hidden;margin:0;padding:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:rgba(15,22,18,0.96);
    border:1px solid rgba(255,255,255,0.1);
    border-top:2px solid ${accent};
    border-radius:10px;
    padding:12px 14px 14px 14px;
    color:#e9fff4;
    display:flex;flex-direction:column;gap:5px;
    -webkit-app-region:no-drag;
  }
  .tag{font-size:10px;font-weight:600;color:${accent};letter-spacing:0.04em;opacity:0.9}
  h4{font-size:13px;font-weight:600;color:#fff;line-height:1.35;word-break:break-word}
  p{font-size:12px;color:rgba(255,255,255,0.55);line-height:1.5;word-break:break-word}
  .bar{position:fixed;bottom:0;left:0;right:0;height:2px;background:${accent};opacity:0.6;animation:shrink ${duration}ms linear forwards}
  @keyframes shrink{from{width:100%}to{width:0}}
</style></head>
<body>
  <div class="tag">Idle Clans Sentinel</div>
  <h4>${safeTitle}</h4>
  <p>${safeBody}</p>
  <div class="bar"></div>
</body></html>`;

    // Estimate height: title ~20px, body wraps at ~45ch, padding 28px, bar 3px
    const charsPerLine = 42;
    const titleLines = Math.ceil(safeTitle.length / charsPerLine);
    const bodyLines  = Math.ceil(safeBody.length  / charsPerLine);
    const H = 28 + (titleLines * 20) + (bodyLines * 18) + 12;

    toastWindow = new BrowserWindow({
      width: W, height: H,
      x: sw - W - 16, y: sh - H - 16,
      frame: false, transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false,
      focusable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      show: false,
    });

    const encoded = "data:text/html;charset=utf-8," + encodeURIComponent(html);
    toastWindow.loadURL(encoded);
    toastWindow.once("ready-to-show", () => {
      if (toastWindow && !toastWindow.isDestroyed()){
        toastWindow.showInactive();
        toastTimer = setTimeout(() => {
          try{ if (toastWindow && !toastWindow.isDestroyed()) toastWindow.destroy(); }catch{}
        }, duration);
      }
    });
    toastWindow.on("closed", () => { toastWindow = null; });
  }catch(err){
    console.error("[toast]", err);
  }
}

function showMentionToast(hit){
  const isKeyword = !!hit?.keyword;
  const title = isKeyword
    ? `Keyword detected: "${hit.keyword}"`
    : `${hit.accountName || "Account"} mentioned`;
  const body = hit?.message
    ? hit.message.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "").trim()
    : "Click the tray icon to open Sentinel";
  showOverlayToast({ title, body });
}

const APP_TITLE = "Idle Clans Sentinel";

// Sets the window title to "Idle Clans Sentinel - <name>" using the first
// linked account (My Accounts page, ordered by when it was linked), or just
// "Idle Clans Sentinel" if no accounts are linked. Called once after the DB
// is ready and again whenever accounts are linked/unlinked, plus on every
// page-title-updated (see createWindow) so it survives the initial page load.
//
// Accepts an optional explicit window reference — falls back to the module-
// level `mainWindow`. The explicit form matters for the very first
// page-title-updated event, which can fire synchronously during
// `new BrowserWindow(...)`/loadFile, before `mainWindow = createWindow()`
// has assigned its return value.
function updateWindowTitle(win){
  const target = win || mainWindow;
  if (!target || target.isDestroyed()) return;
  try{
    const first = getFirstLinkedAccount();
    target.setTitle(first?.username ? `${APP_TITLE} - ${first.username}` : APP_TITLE);
  }catch(e){
    console.warn("[main] updateWindowTitle failed:", e?.message);
  }
}

function createWindow(){
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    backgroundColor: "#062b1b",
    title: APP_TITLE,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Electron syncs the window title to the page's <title> element by
  // default (page-title-updated), which would overwrite the
  // "Idle Clans Sentinel - <account>" title set by updateWindowTitle() as
  // soon as index.html finishes loading (its <title> is just
  // "Idle Clans Sentinel"). Suppress that sync and re-apply our title
  // instead, so it survives the initial page load and any future
  // navigation/reload.
  win.on("page-title-updated", (e) => {
    e.preventDefault();
    updateWindowTitle(win);
  });

  // On close, ask whether to minimise to tray or quit.
  // Remember the choice so they aren't asked every time.
  win.on("close", (e) => {
    if (app.isQuitting) return;
    e.preventDefault();

    // If user previously saved a preference, honour it without showing the dialog
    if (app._alwaysMinimiseToTray){
      win.hide();
      showOverlayToast({ title:"Idle Clans Sentinel", body:"Running in the background. Active scans continue.", duration:4000 });
      return;
    }
    if (app._alwaysQuit){
      app.isQuitting = true;
      app.quit();
      return;
    }

    dialog.showMessageBox(win, {
      type:           "question",
      title:          "Idle Clans Sentinel",
      message:        "What would you like to do?",
      detail:         "Minimising to tray keeps all active scans running in the background.",
      buttons:        ["Minimise to tray", "Quit Sentinel", "Cancel"],
      defaultId:      0,
      cancelId:       2,
      checkboxLabel:  "Remember my choice",
      checkboxChecked: false,
      noLink:         true,
    }).then(({ response, checkboxChecked }) => {
      if (response === 0){
        if (checkboxChecked){
          app._alwaysMinimiseToTray = true;
          try{ setSetting({ key:"closeBehaviour", value:"tray" }); }catch{}
        }
        win.hide();
        showOverlayToast({ title:"Idle Clans Sentinel", body:"Running in the background. Active scans continue.", duration:4000 });
      } else if (response === 1){
        if (checkboxChecked){
          app._alwaysQuit = true;
          try{ setSetting({ key:"closeBehaviour", value:"quit" }); }catch{}
        }
        app.isQuitting = true;
        // Small delay ensures any pending DB writes flush before process exits
        setTimeout(() => app.quit(), 50);
      }
      // response === 2 → Cancel, window stays open
    }).catch(() => {});
  });

  attachAutoDevTools(win);

  // Extra fallback: try to open devtools shortly after window creation.
  if (!app.isPackaged || process.env.SENTINEL_DEVTOOLS === "1" || !!process.env.VITE_DEV_SERVER_URL){
    setTimeout(()=>{ try{ win.webContents.openDevTools({ mode: "detach" }); }catch{} }, 400);
  }

  if (!app.isPackaged){
    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

    const showDevServerHelp = () => {
      const indexPath = path.join(__dirname, "..", "dist", "index.html");
      if (fs.existsSync(indexPath)){
        win.loadFile(indexPath);
        return;
      }
      const html = `<!doctype html><meta charset="utf-8" />
        <title>Idle Clans Sentinel</title>
        <body style="font-family:system-ui; padding:24px; background:#062b1b; color:#e9fff4;">
          <h2 style="margin:0 0 8px 0;">Idle Clans Sentinel</h2>
          <p style="margin:0 0 12px 0; opacity:0.9;">The UI dev server isn't running.</p>
          <ul style="line-height:1.6; opacity:0.9;">
            <li>Run <b>npm run dev</b> for development, or</li>
            <li>Run <b>npm run build</b> then start Electron again to load <code>dist/</code>.</li>
          </ul>
          <p style="margin-top:14px; opacity:0.85; font-size:12px;">Tried: <code>${devUrl}</code></p>
        </body>`;
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    };

    win.webContents.once("did-fail-load", () => showDevServerHelp());

    win.loadURL(devUrl)
      .catch(() => showDevServerHelp());

  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    win.loadFile(indexPath).catch(()=>{});
  }

  return win;
}


// ── Global IPC error guard ────────────────────────────────────────────────────
// Wraps every handler so that DB/runtime errors never propagate as unhandled
// Electron exceptions, which would crash the renderer. Instead they resolve to
// { ok:false, error:"...", degraded:true } so the UI can show a meaningful state.
function safeHandle(channel, fn){
  ipcMain.handle(channel, async (...args) => {
    try{
      return await fn(...args);
    }catch(e){
      const msg = e?.message || String(e);
      console.error(`[handler] ${channel} failed:`, msg);
      return { ok:false, error: msg, degraded: true };
    }
  });
}

app.whenReady().then(async()=>{
  // Minimal app chrome for an investigation tool
  try{ app.setName("Idle Clans Sentinel"); }catch{}
  Menu.setApplicationMenu(null);

  // Allow toggling DevTools even when menus/shortcuts are unavailable.
  try{
    globalShortcut.register("CommandOrControl+Shift+I", ()=>{
      try{
        const wc = mainWindow?.webContents;
        if (!wc) return;
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: "detach" });
      }catch{}
    });
  }catch(err){
    try{ console.warn("[devtools] failed to register shortcut:", err); }catch{}
  }

  // DB folder prompt on first run
  try {
    const cfgPath = path.join(app.getPath("userData"), "sentinel-config.json");
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
    let chosenDbPath = (cfg && typeof cfg.dbPath === "string" && cfg.dbPath.trim()) ? cfg.dbPath.trim() : "";
    if (!chosenDbPath) {
      const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
      const defaultDir = !app.isPackaged ? process.cwd()
                       : portableDir ? portableDir
                       : path.dirname(process.execPath);
      const res = await dialog.showOpenDialog({
        title: "Select a folder to store the Sentinel database",
        defaultPath: defaultDir,
        properties: ["openDirectory", "createDirectory"],
        buttonLabel: "Use this folder",
      });
      if (!res.canceled && res.filePaths?.[0]) {
        const dir = res.filePaths[0];
        chosenDbPath = path.join(dir, "idleclans-desktop.sqlite");
        try {
          fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, dbDir: dir, dbPath: chosenDbPath, selectedAt: new Date().toISOString() }, null, 2), "utf8");
        } catch {}
      }
    }
    if (chosenDbPath) { try { setDbPathOverride(chosenDbPath); } catch {} }
  } catch (err) {
    try { console.warn("[db] location prompt failed:", err); } catch {}
  }

  try {
    await initDb();
  } catch (err) {
    console.error("[FATAL] initDb failed:", err);
    app.quit();
    return;
  }

  // Serve bundled assets via asset://  e.g. asset://gameimages/gold_bar.png
  protocol.handle("asset", (request) => {
    const url = new URL(request.url);
    const category = url.hostname;
    const filename = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const assetBase = app.isPackaged
      ? path.join(process.resourcesPath, "assets")
      : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
    return net.fetch("file://" + path.join(assetBase, category, filename));
  });

  setupTray();
  mainWindow = createWindow();
  updateWindowTitle();

  // Load persisted close-behaviour preference (DB is now open)
  try{
    const s = getSettings();
    const pref = s?.closeBehaviour;
    if (pref === "tray") app._alwaysMinimiseToTray = true;
    if (pref === "quit") app._alwaysQuit = true;
  }catch{}

  // Auto-update game data on start.
  // Always fetch if no game-data file exists yet (first run).
  // Otherwise respect the auto-update toggle and max-age setting.
  try{
    const s = await getSettings();
    const enabled    = String(s.gameDataAutoUpdate ?? "1") === "1";
    const maxAgeDays = Number(s.gameDataMaxAgeDays ?? 7);
    const last       = s.gameDataUpdatedAt ? Date.parse(s.gameDataUpdatedAt) : NaN;
    const tooOld     = !Number.isFinite(last) || ((Date.now() - last) > maxAgeDays * 24 * 60 * 60 * 1000);

    // Check if the game data JSON exists on disk next to the EXE
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    const exeDir = !app.isPackaged ? process.cwd()
                 : portableDir ? portableDir
                 : path.dirname(process.execPath);
    const gdPath  = path.join(exeDir, "idleclans-game-data.json");
    const gdPath2 = path.join(app.getPath("userData"), "idleclans-game-data.json");
    const hasFile = fs.existsSync(gdPath) || fs.existsSync(gdPath2);

    if (!hasFile || (enabled && tooOld)){
      setTimeout(async()=>{
        try{ await updateGameData({ force:true }); }catch(err){ console.warn("[gameData] auto-update failed:", err); }
      }, 1500);
    }
  } catch{}

  // UI file picker
  safeHandle("ui:pickImportFile", async()=>{
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name:"Data", extensions:["json","txt"] }],
    });
    if (r.canceled || !r.filePaths?.[0]) return null;
    const fp = r.filePaths[0];
    let sizeBytes = 0;
    try{ sizeBytes = fs.statSync(fp).size; }catch{}
    return { path: fp, name: path.basename(fp), sizeBytes };
  });

  // UI save dialog helper (exports)
  safeHandle("ui:saveTextFile", async(_e, { defaultName, content })=>{
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || "export.csv",
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "CSV", extensions: ["csv"] },
        { name: "JSON", extensions: ["json"] },
        { name: "Text", extensions: ["txt"] },
      ],
    });
    if (r.canceled || !r.filePath) return { ok:false, canceled:true };
    fs.writeFileSync(r.filePath, String(content ?? ""), "utf8");
    return { ok:true, path: r.filePath };
  });

  // Export HTML report to PDF / PNG
  safeHandle("ui:exportHtml", async(_e, { defaultName, html, format })=>{
    try{
      return await exportHtmlToFile({ defaultName, html, format });
    } catch(err){
      const message = String(err?.message || err);
      console.error("[exportHtml] failed:", message);
      if (err?.stack) console.error(err.stack);
      // Return a structured failure so the renderer can show a useful message.
      return { ok:false, error: message, stack: String(err?.stack || "") };
    }
  });

  // DB handlers
  safeHandle("db:getCounts", async () => {
    try{ return getCounts(); }
    catch(e){
      console.error("[handler] db:getCounts failed:", e?.message);
      return { players:0, clans:0, bannedPlayers:0, playersByMode:{}, clansByMode:{}, degraded:true, error: e?.message };
    }
  });
  safeHandle("db:getCountsFast", async () => {
    try{ return getCountsFast(); }
    catch(e){
      console.error("[handler] db:getCountsFast failed:", e?.message);
      return { players:0, clans:0, degraded:true, error: e?.message };
    }
  });
  safeHandle("db:getDbInfo", async () => {
    try{ return getDbInfo(); }
    catch(e){
      console.error("[handler] db:getDbInfo failed:", e?.message);
      return { path: null, sizeBytes: 0, degraded:true, error: e?.message };
    }
  });
  safeHandle("api:getRateStats", async()=> getApiRateStats());
  safeHandle("db:pruneBackups", async(_e, opts)=> pruneBackups(opts||{}));
  safeHandle("db:pickBackupFolder", async()=> pickBackupFolder());

  safeHandle("db:getStorageBreakdown", async()=> getStorageBreakdown());
  safeHandle("db:deleteAllData", async()=> deleteAllData());
  safeHandle("db:importData", async(_e, payload)=> {
    // Large imports should run in main process and stream from disk.
    if (payload?.path){
      const importId = String(payload.importId || `imp_${Date.now()}_${Math.random().toString(16).slice(2)}`);
      const ac = new AbortController();
      importControllers.set(importId, ac);

      try{
        const res = await importData({
          ...payload,
          importId,
          signal: ac.signal,
          onProgress: (p)=>{
            mainWindow?.webContents?.send("import:progress", { importId, ...p });
          }
        });
        mainWindow?.webContents?.send("import:progress", { importId, done:true, ok:true });
        return { ok:true, importId, ...res };
      } catch(err){
        const message = String(err?.message || err);
        mainWindow?.webContents?.send("import:progress", { importId, done:true, ok:false, error: message });
        throw err;
      } finally{
        importControllers.delete(importId);
      }
    }

    // Small paste/import mode (legacy)
    return importData(payload);
  });

  safeHandle("db:cancelImport", async(_e, { importId })=>{
    const ac = importControllers.get(String(importId||""));
    if (ac){
      try{ ac.abort(); }catch{}
      return { ok:true };
    }
    return { ok:false, error:"Import not found" };
  });
  safeHandle("db:listPlayers", async(_e, q, opts)=> listPlayers(q, opts||{}));
  safeHandle("db:listPlayersWithEquipment", async (_e, opts) => listPlayersWithEquipment(opts||{}));
  safeHandle("db:getPlayersWithItem", async (_e, { itemId, activeOnly, staleDays }) => getPlayersWithItem(itemId, { activeOnly:!!activeOnly, staleDays:Number(staleDays)||7 }));

  safeHandle("db:getTaskActivitySummary", async (_e, opts) => getTaskActivitySummary(opts||{}));
  safeHandle("db:getPlayersByTask", async (_e, { task, gameMode, activeOnly, limit }) => getPlayersByTask(task, { gameMode:gameMode||null, activeOnly:!!activeOnly, limit:Number(limit)||200 }));
  safeHandle("db:listClans", async(_e, q, opts)=> listClans(q, opts||{}));
  safeHandle("db:listPotentialClans", async(_e, p)=> listPotentialClans(p || {}));
safeHandle("db:listClanSkillSignals", async(_e, opts)=> listClanSkillSignals(opts));
  safeHandle("db:getPlayer", async(_e, name)=> getPlayer(name));
  safeHandle("db:getClan", async(_e, name)=> getClan(name));
  safeHandle("db:getLogs", async(_e, p)=> getLogs(p));
  safeHandle("db:getLogsDetailed", async(_e, p)=> getLogsDetailed(p));

  // Discover / Live API preview (no DB writes)
  safeHandle("db:previewPlayerLive", async(_e, { name })=> previewPlayerLive(name));
  safeHandle("db:previewClanLive", async(_e, { name })=> previewClanLive(name));

  // Discover / Live API save to DB
  safeHandle("db:lookupPlayerLive", async(_e, { name })=> lookupPlayerLive(name));
  safeHandle("db:lookupClanLive", async(_e, { name, includeMemberProfiles })=> lookupClanLive(name, { includeMemberProfiles: !!includeMemberProfiles }));
  // Timeline
  safeHandle("timeline:getVault", async (_e, params) => {
    return getVaultTimeline(params || {});
  });
  safeHandle("timeline:getVaultContents", async (_e, params) => {
    return getVaultContents(params || {});
  });
  safeHandle("timeline:getVaultLeaderboard", async (_e, params) => {
    return getVaultLeaderboard(params || {});
  });

  safeHandle("timeline:getMovement", async (_e, params) => {
    return getMovementTimeline(params || {});
  });

  // Chat
  safeHandle("chat:getRecent", async (_e, params) => getRecentChat(params || {}));
  safeHandle("chat:getMessagesGlobal", async(_e,p)=> getChatMessagesGlobal(p||{}));
  safeHandle("chat:getMessages", async (_e, params) => getChatMessages(params || {}));
  safeHandle("chat:getMessagesAroundId", async (_e, params) => getChatMessagesAroundId(params || {}));

  // Player-specific chat query (used by Player page "Chat Messages" block)
  safeHandle("chat:getMessagesForPlayer", async (_e, params) => {
    return getChatMessagesForPlayer(params || {});
  });

  // Backward-compatible alias (older renderer builds)
  safeHandle("chat:getForPlayer", async (_e, params) => {
    return getChatMessagesForPlayer(params || {});
  });

safeHandle("chat:search", async (_e, params) => {
  return searchChatMessages(params || {});
});

safeHandle("chat:getMessageCounts", async () => getChatMessageCounts());

  // Chat background scan (global, survives navigation like Scan All)
  safeHandle("chatScan:start", async ()=> {
    startChatScan((state)=>{
      try{ mainWindow?.webContents?.send("chatScan:status", state); }catch{}
    });
    return getChatScanStatus();
  });
  safeHandle("chatScan:stop", async ()=> {
    stopChatScan((state)=>{
      try{ mainWindow?.webContents?.send("chatScan:status", state); }catch{}
    });
    return getChatScanStatus();
  });
  safeHandle("chatScan:status", async ()=> getChatScanStatus());

  // Wire mention detection — fires whenever a new chat message mentions a linked account
  setChatMentionCallback((hit)=>{
    try{ mainWindow?.webContents?.send("chat:mention", hit); }catch{}
    // Toast notification when the window is not visible
    try{
      if (mainWindow && (!mainWindow.isVisible() || mainWindow.isMinimized())){
        showMentionToast(hit);
      }
    }catch{}
  });

  ipcMain.on("app:setTheme", (_e, theme) => { currentTheme = theme || "forest"; });

  // Close-behaviour preference (called from Settings page)
  ipcMain.on("app:resetCloseBehaviour", () => {
    app._alwaysMinimiseToTray = false;
    app._alwaysQuit = false;
    try{ setSetting({ key:"closeBehaviour", value:"ask" }); }catch{}
  });
  safeHandle("app:getCloseBehaviour", () => {
    if (app._alwaysMinimiseToTray) return "tray";
    if (app._alwaysQuit) return "quit";
    return "ask";
  });
  ipcMain.on("app:setCloseBehaviour", (_e, val) => {
    app._alwaysMinimiseToTray = val === "tray";
    app._alwaysQuit           = val === "quit";
    try{ setSetting({ key:"closeBehaviour", value: val || "ask" }); }catch{}
  });

  safeHandle("chat:setKeywords", async(_e, keywords)=>{
    setChatKeywords(Array.isArray(keywords) ? keywords : []);
    return { ok:true };
  });
  safeHandle("chat:setIgnoredChannels", async(_e, channels)=>{
    setChatIgnoredChannels(Array.isArray(channels) ? channels : []);
    return { ok:true };
  });
  safeHandle("chat:getCategories", async()=> getChatCategories());

safeHandle("db:getPlayerClanHistory", async(_e, { playerName, limit })=> getPlayerClanHistory(playerName, limit));
  safeHandle("db:getClanMemberChanges", async(_e, { clanName, limit })=> getClanMemberChanges(clanName, limit));
  safeHandle("db:getPlayerLastOnlineEvents", async(_e, { playerName, days, limit })=>
    getPlayerLastOnlineEvents(playerName, days, limit)
  );
  safeHandle("db:getClanLastOnlineEvents", async(_e, { clanName, days, limit })=>
    getClanLastOnlineEvents(clanName, days, limit)
  );

  // Reports / alerts / export
  safeHandle("db:getAlerts", async(_e, p)=> getAlerts(p));
  safeHandle("db:markAlertRead", async(_e, { id })=> markAlertRead(id));
  safeHandle("db:clearAlerts", async(_e, p)=> clearAlerts(p));
  safeHandle("db:getAnalyticsSummary", async()=> getAnalyticsSummary());
  safeHandle("db:getInactiveReport", async(_e, p)=> getInactiveReport(p));
  safeHandle("db:runIntegrityCheck", async()=> runIntegrityCheck());
  safeHandle("db:exportCsv",           async(_e, p)=> exportCsv(p));
  safeHandle("db:exportShareableJson", async(_e, p)=> exportShareableJson(p));

  // Full backup — spawns a worker thread, streams progress to renderer
  safeHandle("db:exportFullBackup", async (_e) => {
    const d     = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `sentinel_full_backup_${stamp}.json`,
      filters: [{ name:"JSON Backup", extensions:["json"] }],
    });
    if (r.canceled || !r.filePath) return { ok:false, canceled:true };

    return exportFullBackup(r.filePath, (progress) => {
      try{ mainWindow?.webContents.send("backup:exportProgress", progress); }catch{}
    });
  });

  // Full backup import — streams from disk row-by-row, never loads full file into JS heap
  safeHandle("db:importFullBackupFromPath", async(_e, { path: filePath })=> {
    return importFullBackup({ filePath, onProgress: (p) => {
      try{ mainWindow?.webContents.send("backup:importProgress", p); }catch{}
    }});
  });
  safeHandle("db:getClansWithNameClusters", async(_e, p)=> getClansWithNameClusters(p || {}));
  safeHandle("db:getCrossClanMatches", async(_e, p)=> getCrossClanMatches(p || {}));
  safeHandle("db:getSettings", async()=> getSettings());
  safeHandle("db:setSetting", async(_e, p)=> setSetting(p));
  safeHandle("db:getStaleEntities", async(_e, p)=> getStaleEntities(p || {}));


// Leaderboards (offline cache + scans)
safeHandle("leaderboards:listBoards", async()=> listLeaderboardBoards());
safeHandle("leaderboards:getCache", async(_e, p) => {
  try{ return getLeaderboardCache(p || {}); }
  catch(e){
    console.error("[handler] leaderboards:getCache failed:", e?.message);
    return { boardKey: p?.boardKey || "", rows: [], totalRows: 0, lastCapturedAt: null, degraded: true, error: e?.message };
  }
});
safeHandle("leaderboards:getEntityStandings", async(_e, p) => {
  try{ return getEntityLeaderboardStandings(p?.name, { entityType: p?.entityType || null }); }
  catch(e){
    console.error("[handler] leaderboards:getEntityStandings failed:", e?.message);
    return { rows: [], degraded: true, error: e?.message };
  }
});
safeHandle("leaderboards:getState", async(_e, { boardKey })=> getLeaderboardScanState(boardKey));
safeHandle("leaderboards:clearCache", async(_e, { boardKey })=> clearLeaderboardCache(boardKey));

// Leaderboard snapshots (DB-backed frozen datasets)
safeHandle("leaderboards:snapshots:list", async(_e, p)=> listLeaderboardSnapshots(p || {}));
safeHandle("leaderboards:snapshots:count", async(_e, p)=> countLeaderboardSnapshots(p || {}));
safeHandle("leaderboards:snapshots:get", async(_e, p)=> getLeaderboardSnapshot(p || {}));
safeHandle("leaderboards:snapshots:getRows", async(_e, p)=> getLeaderboardSnapshotRows(p || {}));
safeHandle("leaderboards:snapshots:createFromCache", async(_e, p)=> createLeaderboardSnapshotFromCache(p || {}));
safeHandle("leaderboards:snapshots:createFromRows", async(_e, p)=> createLeaderboardSnapshotFromRows(p || {}));
safeHandle("leaderboards:snapshots:delete", async(_e, p)=> deleteLeaderboardSnapshot(p || {}));

// Leaderboard watches (scheduled scans while app is open)
safeHandle("leaderboards:watches:list", async(_e, p)=> listLeaderboardWatches(p || {}));
safeHandle("leaderboards:watches:upsert", async(_e, p)=> upsertLeaderboardWatch(p || {}));
safeHandle("leaderboards:watches:delete", async(_e, p)=> deleteLeaderboardWatch(p || {}));
safeHandle("leaderboards:watches:runNow", async(_e, p)=> {
  // "Run now" should actually run immediately if possible, and update the UI live.
  const queued = runLeaderboardWatchNow(p || {});
  try{
    // Push an immediate tick so the watch row doesn't stay blank.
    const watches = listLeaderboardWatches({ enabledOnly:true, limit:200 });
    mainWindow?.webContents?.send("leaderboardWatch:tick", {
      now: new Date().toISOString(),
      scanBusy: !!globalThis.__idleclansLeaderboardScanController,
      watches,
    });
  }catch{}

  // Attempt to run one due watch right away (will safely no-op if scan is busy).
  try{
    const r = await runOneDueLeaderboardWatch();
    if (r?.ran || r?.saved || r?.error){
      try{ mainWindow?.webContents?.send("leaderboardWatch:status", r); }catch{}
    }
  }catch(err){
    try{ mainWindow?.webContents?.send("leaderboardWatch:status", { ok:false, error:String(err?.message||err) }); }catch{}
  }

  return queued;
});

// Scheduler / automation dashboard (control tower)
safeHandle("scheduler:getStatus", async()=> {
  const s = getSchedulerStatus();
  // Attach current leaderboard job label if scan-all/custom job runner is active.
  try{
    if (activeLeaderboardJob?.jobId){
      s.leaderboardJob = getLeaderboardJob(activeLeaderboardJob.jobId);
    } else {
      s.leaderboardJob = null;
    }
  }catch{
    s.leaderboardJob = null;
  }
  // Friendly blocking reason for watches.
  try{
    const meta = s?.scans?.leaderboard?.meta;
    if (s?.scans?.leaderboard?.running){
      const label = meta?.boardKey ? String(meta.boardKey) : null;
      const jobLabel = s.leaderboardJob?.currentLabel ? String(s.leaderboardJob.currentLabel) : null;
      s.blockingReason = jobLabel || label || "Leaderboard scan running";
    } else {
      s.blockingReason = null;
    }
  }catch{ s.blockingReason = null; }
  return s;
});

safeHandle("leaderboards:listImportedStubs", async(_e, p)=> listLeaderboardImportedStubs(p || {}));

safeHandle("leaderboards:scanBoard", async(_e, opts)=> {
  const res = await scanLeaderboardBoard(opts || {}, (p)=>{
    try{ mainWindow?.webContents?.send("leaderboardScan:progress", p); }catch{}
  });
  // send final state too
  try{ mainWindow?.webContents?.send("leaderboardScan:progress", { ...res, running:false, status: res.status || "done" }); }catch{}
  return res;
});

// -------------------------------
// Leaderboard job APIs (pause/resume across restarts)
// -------------------------------
safeHandle("leaderboards:jobs:list", async(_e, p)=> listLeaderboardJobs(p || {}));
safeHandle("leaderboards:jobs:get", async(_e, { jobId })=> getLeaderboardJob(jobId));

safeHandle("leaderboards:jobs:startScanAll", async(_e, opts)=> {
  const o = opts || {};
  const plan = buildScanAllPlan(o.maxRank);
  const job = createLeaderboardJob({
    title: "Scan All Leaderboards",
    plan,
    options: {
      importMissing: !!o.importMissing,
      clearCache: ("clearCache" in o) ? !!o.clearCache : false,
      refreshProfiles: !!o.refreshProfiles,
    },
  });
  // Fire and forget runner
  runLeaderboardJob(job.id).catch((err)=>{
    try{ updateLeaderboardJob(job.id, { status:"paused", lastError: String(err?.message||err) }); }catch{}
  });
  return job;
});

safeHandle("leaderboards:jobs:startCustom", async(_e, payload)=> {
  const p = payload || {};
  const plan = Array.isArray(p.plan) ? p.plan : [];
  const job = createLeaderboardJob({
    title: String(p.title || "Custom Leaderboard Scan"),
    plan,
    options: {
      importMissing: !!p.importMissing,
      clearCache: ("clearCache" in p) ? !!p.clearCache : false,
      refreshProfiles: !!p.refreshProfiles,
    },
  });
  runLeaderboardJob(job.id).catch((err)=>{
    try{ updateLeaderboardJob(job.id, { status:"paused", lastError: String(err?.message||err) }); }catch{}
  });
  return job;
});

safeHandle("leaderboards:jobs:pause", async(_e, { jobId })=> {
  const id = Number(jobId);
  if (activeLeaderboardJob && activeLeaderboardJob.jobId === id){
    activeLeaderboardJob.pauseRequested = true;
    try{ cancelLeaderboardScan(); }catch{}
  }
  updateLeaderboardJob(id, { status: "paused" });
  return getLeaderboardJob(id);
});

safeHandle("leaderboards:jobs:resume", async(_e, { jobId })=> {
  const id = Number(jobId);
  const job = getLeaderboardJob(id);
  if (!job) throw new Error("Job not found");
  if (job.status === "done" || job.status === "cancelled") return job;
  // prevent double-run
  if (activeLeaderboardJob && activeLeaderboardJob.jobId === id) return job;
  runLeaderboardJob(id).catch((err)=>{
    try{ updateLeaderboardJob(id, { status:"paused", lastError: String(err?.message||err) }); }catch{}
  });
  return getLeaderboardJob(id);
});

safeHandle("leaderboards:jobs:cancel", async(_e, { jobId })=> {
  const id = Number(jobId);
  if (activeLeaderboardJob && activeLeaderboardJob.jobId === id){
    try{ cancelLeaderboardScan(); }catch{}
    activeLeaderboardJob = null;
  }
  updateLeaderboardJob(id, { status: "cancelled" });
  return getLeaderboardJob(id);
});

safeHandle("leaderboards:scanAll", async(_e, opts)=> {
  const o = opts || {};
  const importMissing = !!o.importMissing;
  const clearCache = ("clearCache" in o) ? !!o.clearCache : false; // default: keep cache unless requested
  const resume = !!o.resume;

  const SKILLS = [
    "total_level","attack","strength","defence","archery","magic","health","crafting","woodcutting","carpentry","fishing","cooking","mining","smithing","thieving","farming","alchemy","enhancing","sailing","foraging","husbandry"
  ];
  const BOSSES = ["zeus","medusa","griffin","hades","chimera","wyvern","kraken","manticore","fenrir"];
  const RAIDS = ["guardians_of_the_citadel","reckoning_of_the_gods","bloodmoon_massacre"];
  const GAME_MODES = ["default","ironman","groupironman"];

  const plan = [];
  // players: skills + bosses + raids
  for (const gm of GAME_MODES){
    for (const cat of [...SKILLS, ...BOSSES, ...RAIDS]) plan.push({ entityType:"players", gameMode:gm, category:cat });
  }
  // clans + pets: skills only
  for (const gm of GAME_MODES){
    for (const cat of SKILLS) plan.push({ entityType:"clans", gameMode:gm, category:cat });
    for (const cat of SKILLS) plan.push({ entityType:"pets", gameMode:gm, category:cat });
  }

  let done = 0;
  const total = plan.length;

  for (const item of plan){
    const overall = { overallDone: done, overallTotal: total, overallPct: total ? Math.round((done/total)*100) : 0 };
    try{
      const res = await scanLeaderboardBoard({ ...item, resume, importMissing, clearCache }, (p)=>{
        try{ mainWindow?.webContents?.send("leaderboardScan:progress", { ...p, ...overall }); }catch{}
      });
      done++;
      const overallAfter = { overallDone: done, overallTotal: total, overallPct: total ? Math.round((done/total)*100) : 0 };
      try{ mainWindow?.webContents?.send("leaderboardScan:progress", { ...res, running:false, status: res.status || "done", ...overallAfter }); }catch{}
      if (res?.status === "stopped" || res?.status === "error") break;
    }catch(err){
      try{ mainWindow?.webContents?.send("leaderboardScan:progress", { running:false, status:"error", error:String(err?.message||err), ...overall }); }catch{}
      break;
    }
  }

  // Final completion signal (useful for UI to know scan-all finished)
  if (done >= total){
    const overallFinal = { overallDone: done, overallTotal: total, overallPct: total ? Math.round((done/total)*100) : 0 };
    try{ mainWindow?.webContents?.send("leaderboardScan:progress", { running:false, status:"allCompleted", ...overallFinal }); }catch{}
  }

  return { ok:true, overallDone: done, overallTotal: total };
});

safeHandle("leaderboards:cancelScan", async()=> cancelLeaderboardScan());
  safeHandle("db:setTracked", async(_e, p)=> setTracked(p));
  safeHandle("db:getTracked", async(_e, p)=> getTracked(p));
  safeHandle("db:setPlayerBanned", async(_e, p)=> setPlayerBanned(p));
  safeHandle("db:banClanMembers", async(_e, p)=> banClanMembers(p));
  safeHandle("db:flagClanMembers", async(_e, p)=> flagClanMembers(p));
  safeHandle("db:listBannedPlayers", async(_e, p)=> listBannedPlayers(p || {}));
  safeHandle("db:listNotFoundEntities", async(_e, p)=> listNotFoundEntities(p || {}));
  safeHandle("db:clearNotFoundEntity", async(_e, p)=> clearNotFoundEntity(p || {}));
  safeHandle("db:recheckNotFoundEntity", async(_e, p)=> recheckNotFoundEntity(p || {}));
  safeHandle("db:listDormantPlayers",    async(_e, p)=> listDormantPlayers(p || {}));
  safeHandle("db:clearDormantPlayer",    async(_e, p)=> clearDormantPlayer(p?.username || p || ""));
  safeHandle("db:recheckDormantPlayer",  async(_e, p)=> recheckDormantPlayer(p?.username || p || ""));
  safeHandle("market:fetchPrices",     async(_e,opts)=> fetchMarketPrices(opts||{}));
  safeHandle("market:getSnapshot",     async()=> getMarketSnapshot());
  safeHandle("market:getPriceChanges", async(_e,opts)=> getMarketPriceChanges(opts||{}));
  safeHandle("market:getTopVolume",    async(_e,opts)=> getMarketTopVolume(opts||{}));
  safeHandle("market:getHistory",      async(_e,opts)=> getMarketHistory(opts||{}));
    safeHandle("accounts:verify",  async(_e,token)=> {
      const res = await verifyAccountToken(token);
      if (res?.ok) updateWindowTitle();
      return res;
    });
  safeHandle("accounts:list",    async()=> listVerifiedAccounts());
  safeHandle("accounts:remove",       async(_e,u)  => {
    const res = removeVerifiedAccount(u);
    updateWindowTitle();
    return res;
  });
  safeHandle("accounts:snapshotSkills", async(_e,u)  => snapshotAccountSkills(u));
  safeHandle("accounts:skillHistory",   async(_e,u,o)=> getAccountSkillHistory(u,o||{}));
  safeHandle("accounts:skillLatest",    async(_e,u)  => getAccountSkillLatest(u));
  safeHandle("news:fetchLatest", async()=> fetchLatestNews());
  safeHandle("news:list", async(_e,limit,offset)=> listNews({limit:limit||50,offset:offset||0}));
  safeHandle("db:listFlaggedPlayers", async(_e, p)=> listFlaggedPlayers(p || {}));
  safeHandle("db:listFlaggedClans",   async(_e, p)=> listFlaggedClans(p || {}));
  safeHandle("db:getPlayersClanMap", async(_e, p)=> getPlayersClanMap(p || {}));
  safeHandle("db:getPvmDelta24h", async(_e, p)=> getPvmDelta24h(p || {}));
	  safeHandle("db:getPvmSnapshotStatus", async(_e, p)=> getPvmSnapshotStatus(p || {}));
	  safeHandle("db:takePvmSnapshotNow", async(_e, p)=> takePvmSnapshotNow(p || {}));
  safeHandle("db:getPvmCorrelation", async(_e, p)=> getPvmCorrelation(p || {}));
  safeHandle("db:getPvmRollingDelta", async(_e, p)=> getPvmRollingDelta(p || {}));
  safeHandle("db:getPvmSampleStats", async()=> getPvmSampleStats());
  safeHandle("db:getPvmCorrelationRolling", async(_e, p)=> getPvmCorrelationRolling(p || {}));
  safeHandle("db:verifyPvmGroupLeaderboard", async(_e, p)=> verifyPvmGroupLeaderboard(p || {}));

  // Cases / dossiers
  safeHandle("cases:create", async(_e, p)=> createCase(p || {}));
  safeHandle("cases:list", async()=> listCases());
  safeHandle("cases:get", async(_e, { caseId })=> getCase(caseId));
  safeHandle("cases:update", async(_e, p)=> updateCase(p || {}));
  safeHandle("cases:delete", async(_e, { caseId })=> deleteCase(caseId));
  safeHandle("cases:addNote", async(_e, p)=> addCaseNote(p || {}));
  safeHandle("cases:attachEntity", async(_e, p)=> attachCaseEntity(p || {}));
  safeHandle("cases:detachEntity", async(_e, p)=> detachCaseEntity(p || {}));
  safeHandle("cases:addSnapshot", async(_e, p)=> addCaseSnapshot(p || {}));
  safeHandle("cases:getSnapshot", async(_e, p)=> getCaseSnapshot(p || {}));
  safeHandle("cases:updateAutoSnapshot", async(_e, p)=> updateCaseAutoSnapshot(p || {}));
  safeHandle("cases:runAutoSnapshots", async()=> runCaseAutoSnapshots());

  // API handlers
  safeHandle("api:refreshPlayer", async(_e, name)=> upsertPlayerFromApi(name));
  safeHandle("api:refreshClan", async(_e, name)=> upsertClanFromApi(name));
  safeHandle("api:fetchPlayerLogs", async(_e, name)=> insertLogs("player", name));
  safeHandle("api:fetchClanLogs", async(_e, name)=> insertLogs("clan", name));
  safeHandle("api:fetchClanPvmProfile", async(_e, p)=> fetchClanPvmProfile(p || {}));
  safeHandle("api:fetchPlayerPvmProfile", async(_e, p)=> fetchPlayerPvmProfile(p || {}));
  safeHandle("api:fetchPlayerPvmProfileAuto", async(_e, p)=> fetchPlayerPvmProfileAuto(p || {}));
  safeHandle("api:getPlayerPvmLeaderboardSnapshot", async(_e, p)=> getPlayerPvmLeaderboardSnapshot(p || {}));
  safeHandle("db:getClanPvmSnapshot",   async(_e, p)=> getClanPvmSnapshot(p || {}));
  safeHandle("db:deletePlayersHard",    async(_e, p)=> deletePlayersHard(p || {}));
  safeHandle("db:deleteClansHard",      async(_e, p)=> deleteClansHard(p || {}));
  // Renamed in the UI to "Refresh members" — now does a full per-member
  // profile refresh (skills, equipment, logs, leaderboard PvM ranks), not
  // just hoursOffline. Channel name kept as "api:scanClanMembers" and
  // progress still sent on "scan:progress" so the existing progress UI and
  // cancel button (api:cancelScanClanMembers) keep working unchanged.
  safeHandle("api:scanClanMembers", async(_e, clanName)=> {
    const res = await refreshClanMembersFull(clanName, (payload)=>{
      mainWindow?.webContents?.send("scan:progress", payload);
    });
    return res;
  });

  safeHandle("api:cancelScanClanMembers", async()=> {
    return cancelScanClanMembers();
  });

  safeHandle("api:scanAll", async(_e, opts)=> {
    await scanAll(opts || {}, (payload)=>{
      mainWindow?.webContents?.send("bulkScan:progress", payload);
    });
    return { ok:true };
  });

  safeHandle("api:cancelScanAll", async()=> {
    return cancelScanAll();
  });

  // Game data (item/equipment definitions)
  safeHandle("gameData:getLookup", async()=> getGameDataLookup());
  safeHandle("gameData:update", async(_e, opts)=> updateGameData(opts || {}));

  // Scheduler (tracked items)
  setInterval(async()=>{
    try{
      const s = await getSettings();
      const callsPerMin = Number(s.apiCallsPerMinute ?? 15);
      const intervalDefault = Number(s.trackIntervalMinutes ?? 10);
      await runScheduler({ callsPerMin, intervalDefault });
    }catch{}
  }, 5000);

  // Start background market poll once (moved out of runScheduler to avoid re-init every 5s)
  try{ await startMarketPoll(); }catch(e){ console.error("[startup] startMarketPoll failed:", e); }

  // ── Auto-snapshot linked accounts ─────────────────────────────────────────
  // Runs on a configurable interval (accountSnapshotHours, default 6h).
  // Reads from the stored profileJson — no API calls, so it runs regardless of
  // whether a bulk scan is active. The snapshot dedup guard in snapshotAccountSkills
  // prevents more than one snapshot per hour per account even if called more often.
  // Re-reads the interval setting on every tick so changes take effect without restart.
  let lastAccountSnapshotAt = 0;
  setInterval(async()=>{
    try{
      const s = await getSettings();
      const hours = Math.max(0, Number(s.accountSnapshotHours ?? 6));
      if (hours <= 0) return; // disabled
      const intervalMs = hours * 3600 * 1000;
      if (Date.now() - lastAccountSnapshotAt < intervalMs) return;
      const accounts = listVerifiedAccounts();
      if (!accounts || accounts.length === 0) return;
      lastAccountSnapshotAt = Date.now();
      for (const acct of accounts){
        try{ snapshotAccountSkills(acct.username); }catch{}
      }
    }catch(e){ console.error("[accountSnapshot] auto-snapshot error:", e); }
  }, 15 * 60 * 1000); // check every 15 minutes, but only runs when interval has elapsed

  // Auto-refresh stale entities (players + clans not updated within N days).
  // Runs every 30 minutes, but only proceeds when the setting is enabled and
  // no bulk scan is already running (to avoid hammering the API).

  // Track last stale run time to enforce the user-configured interval.
  // Must be declared BEFORE the setInterval that references it.
  let lastStaleRunAt = 0;

  let staleRefreshRunning = false;
  let staleRefreshStatus = {
    running: false,
    total: 0,
    remaining: 0,
    current: null,
    lastRunAt: null,
    lastCount: 0,
    nextRunAt: null,
  };

  function emitStaleProgress(){
    try{ mainWindow?.webContents.send("staleRefresh:progress", { ...staleRefreshStatus }); }catch{}
  }

  safeHandle("db:getStaleRefreshStatus", async () => ({ ...staleRefreshStatus }));

  // Schedule next run time on startup
  staleRefreshStatus.nextRunAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // initial estimate; updated on first run

  setInterval(async()=>{
    try{
      const s = getSettings();
      const intervalMinutes = Math.max(1, Number(s.autoRefreshIntervalMinutes ?? 30));
      staleRefreshStatus.nextRunAt = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
      staleRefreshStatus.intervalMinutes = intervalMinutes;

      if (String(s.autoRefreshStaleEnabled ?? "0") !== "1"){
        staleRefreshStatus.running = false;
        emitStaleProgress();
        return;
      }
      if (staleRefreshRunning) return;

      // Only run if enough time has elapsed since the last run
      const intervalMs = intervalMinutes * 60 * 1000;
      if (lastStaleRunAt && (Date.now() - lastStaleRunAt) < intervalMs) return;

      const staleDays = Math.max(1, Number(s.autoRefreshStaleDays ?? 7));
      const waveSize = Math.max(1, Math.min(5000, Number(s.autoRefreshWaveSize ?? 100)));
      const callsPerMin = Math.max(1, Number(s.apiCallsPerMinute ?? 15));
      const delayMs = Math.ceil(60000 / callsPerMin);

      const { players, clans } = getStaleEntities({ staleDays, limit: waveSize });
      const queue = [
        ...players.map(r => ({ type: "player", name: r.entityName })),
        ...clans.map(r => ({ type: "clan", name: r.entityName })),
      ];

      if (!queue.length){
        staleRefreshStatus = { ...staleRefreshStatus, running:false, total:0, remaining:0, current:null, lastRunAt: new Date().toISOString(), lastCount:0 };
        emitStaleProgress();
        return;
      }

      staleRefreshRunning = true;
      lastStaleRunAt = Date.now();
      staleRefreshStatus = { ...staleRefreshStatus, running:true, total:queue.length, remaining:queue.length, current:null, lastRunAt: new Date().toISOString(), lastCount:queue.length };
      emitStaleProgress();

      for (const item of queue){
        staleRefreshStatus.current = `${item.type}: ${item.name}`;
        emitStaleProgress();
        try{
          if (item.type === "player"){
            await upsertPlayerFromApi(item.name);
            await insertLogs("player", item.name);
          } else {
            await upsertClanFromApi(item.name);
            await insertLogs("clan", item.name);
          }
        }catch{ /* skip failed individual refreshes */ }
        staleRefreshStatus.remaining = Math.max(0, staleRefreshStatus.remaining - 1);
        emitStaleProgress();
        await new Promise(r => setTimeout(r, delayMs));
      }
    }catch{}
    finally{
      staleRefreshRunning = false;
      staleRefreshStatus = { ...staleRefreshStatus, running:false, current:null };
      emitStaleProgress();
    }
  }, 60 * 1000); // runs every minute; actual execution gated by intervalMinutes setting

  app.on("activate", ()=>{ if (BrowserWindow.getAllWindows().length===0) mainWindow=createWindow(); });
});

// Home page: scan only players (profiles + logs)
safeHandle("api:scanPlayersOnly", async(_e, opts)=> {
  await scanPlayersOnly(opts || {}, (payload)=>{
    try{ mainWindow?.webContents.send("bulkScan:progress", payload); }catch{}
  });
  return { ok:true };
});



// Scan a specific list of players (profiles + logs). Used by Name Matches page.
safeHandle("api:scanPlayersList", async(_e, opts)=> {
  try{
    const res = await scanPlayersList(opts || {}, (payload)=>{
      try{ mainWindow?.webContents.send("bulkScan:progress", payload); }catch{}
    });
    return res || { ok:true };
  }catch(e){
    // Cancellation is expected when user presses "Cancel"
    if (e && (e.name === "AbortError" || e.code === "ABORT_ERR" || e.code === "UND_ERR_ABORTED" || e.isCancelled)){
      return { ok:false, cancelled:true };
    }
    console.error("[api:scanPlayersList] failed:", e);
    return { ok:false, error: (e?.message || String(e)) };
  }
});


// Home page: scan clans and their members (profiles + logs)
safeHandle("api:scanStale", async(_e, opts)=> {
  const { staleDays = 7, includeClans = true, limit = 5000 } = opts || {};
  try{
    const { players, clans } = getStaleEntities({ staleDays, limit });
    const playerNames = players.map(r => r.entityName);
    const clanNames   = clans.map(r => r.entityName);
    const totalPlayers = playerNames.length;
    const totalClans   = includeClans ? clanNames.length : 0;
    const total        = totalPlayers + totalClans;

    const emit = (payload) => {
      try{ mainWindow?.webContents?.send("bulkScan:progress", payload); }catch{}
    };

    // Initial emit so the UI shows the total immediately
    emit({ running: true, done: 0, total, current: null,
           startedAt: new Date().toISOString(), phase: "stale" });

    // --- Scan players ---
    // scanPlayersList tracks its own done counter (0..totalPlayers).
    // We relay its progress directly, overriding total with the combined total
    // so the bar covers the full player+clan range.
    if (playerNames.length){
      let playersDone = 0;
      await scanPlayersList({ players: playerNames, skipPreviouslyScanned: false },
        (payload) => {
          // payload.done counts players 0..totalPlayers
          playersDone = Number(payload.done ?? playersDone);
          emit({
            ...payload,
            done:  playersDone,
            total,            // combined total keeps bar in correct proportion
            phase: "stale",
          });
        }
      );
    }

    // --- Scan clans ---
    for (let i = 0; i < clanNames.length; i++){
      if (globalThis.__idleclansBulkScanController?.signal?.aborted) break;
      const clanName = clanNames[i];
      const doneSoFar = totalPlayers + i;
      emit({ running: true, done: doneSoFar, total,
             current: { entityType:"clan", name: clanName }, phase: "stale" });
      try{
        await upsertClanFromApi(clanName);
        await insertLogs("clan", clanName);
      }catch{}
    }

    emit({ running: false, done: total, total, current: null, phase: "stale" });
    return { ok: true, players: totalPlayers, clans: totalClans };
  }catch(e){
    try{ mainWindow?.webContents?.send("bulkScan:progress",
      { running: false, error: String(e?.message || e), phase: "stale" }); }catch{}
    return { ok: false, error: String(e?.message || e) };
  }
});

safeHandle("api:scanClansWithMembers", async(_e, opts)=> {
  await scanClansWithMembers(opts || {}, (payload)=>{
    try{ mainWindow?.webContents.send("bulkScan:progress", payload); }catch{}
  });
  return { ok:true };
});

safeHandle("api:getActivePlayersEstimate", async(_e, days)=>{
  return getActivePlayersEstimate(days ?? 7);
});

// Homepage: server status
safeHandle("api:getServerInfo", async()=>{
  return await getServerInfo();
});

safeHandle("api:getServerPopulationStats", async(_e, opts)=>{
  return await getServerPopulationStats(opts || {});
});


ipcMain.handle("app:checkForUpdate", async () => {
  try {
    const res = await net.fetch("");
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const latest  = String(data.version || "").trim();
    const current = app.getVersion();
    const downloadUrl = String(data.downloadUrl || "");
    const changelog   = String(data.changelog  || "");
    if (!latest) return { ok: false, error: "No version in response" };
    return { ok: true, current, latest, downloadUrl, changelog, hasUpdate: latest !== current };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("shell:openExternal", async (_e, url) => {
  const { shell } = await import("electron");
  await shell.openExternal(url);
});

app.on("window-all-closed", () => {
  if (process.platform === "win32" && !app.isQuitting) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", ()=>{
  try{ globalShortcut.unregisterAll(); }catch{}
});

// ── Background market poll ─────────────────────────────────────────────────
// Initialized ONCE at startup — NOT inside runScheduler which runs every 5s.
let marketPollTimer = null;
let marketNextFetchAt = null; // epoch ms — when the next automatic fetch will fire
async function startMarketPoll(){
  if (marketPollTimer) clearInterval(marketPollTimer);
  marketNextFetchAt = null;
  try{
    const settings = getSettings() || {};
    const mins = Math.max(0, Number(settings.marketPollMinutes ?? 15));
    if (mins <= 0) return;
    const ms = mins * 60 * 1000;
    marketNextFetchAt = Date.now() + ms;
    marketPollTimer = setInterval(async()=>{
      try{
        const result = await fetchMarketPrices({ includeAverage:true });
        marketNextFetchAt = Date.now() + ms; // reset after each tick
        const snap = getMarketSnapshot();
        const alertPct = Number(getSettings()?.marketAlertPct ?? 5);
        if (alertPct > 0 && snap?.rows?.length){
          const hits = snap.rows.filter(r=>{
            if (!r.lowestSellPrice || !r.dailyAveragePrice) return false;
            if (r.lowestSellPrice >= r.dailyAveragePrice) return false;
            const discountPct = ((r.dailyAveragePrice - r.lowestSellPrice) / r.dailyAveragePrice) * 100;
            return discountPct >= alertPct;
          });
          if (hits.length > 0){
            mainWindow?.webContents?.send("market:alert", { count:hits.length, pct:alertPct, fetchedAt:result.fetchedAt });
          }
        }
        mainWindow?.webContents?.send("market:updated", { count:result.count, fetchedAt:result.fetchedAt });
      }catch(e){ console.error("market poll error", e); }
    }, ms);
  }catch(e){ console.error("startMarketPoll error", e); }
}
// Allow renderer to restart poll (e.g. after settings change)
safeHandle("market:restartPoll", async()=>{ await startMarketPoll(); return {ok:true}; });
// Return the real next-fetch timestamp so the page can show an accurate countdown on mount
safeHandle("market:getNextFetch", ()=>({ nextFetchAt: marketNextFetchAt }));

async function runScheduler({ callsPerMin, intervalDefault }){
  const { runOneDueTracked, maybeSnapshotPvmForPlayer, recordPvmSampleForPlayer, runOneDueLeaderboardWatch, listLeaderboardWatches } = await import("./services.js");
  await runOneDueTracked({ callsPerMin, intervalDefault }, async (job)=>{
    // For tracking we refresh BOTH the profile AND logs so history can be backdated
    // using the timestamps returned by the logs endpoints.
    if (job.entityType === "player"){
      const res = await upsertPlayerFromApi(job.entityName);
      // If 404, auto-disable tracking for this entity so it stops consuming scan slots
      if (res?.notFound){
        setTracked({ entityType:"player", name:job.entityName, enabled:false });
        return;
      }
      // Record high-frequency PvM samples on every flagged refresh (no extra API calls)
      try{ await recordPvmSampleForPlayer(job.entityName); }catch{}
      // Daily PvM snapshot (stored once per day after the configured snapshot time)
      try{ await maybeSnapshotPvmForPlayer(job.entityName); }catch{}
      await insertLogs("player", job.entityName);
    }
    if (job.entityType === "clan"){
      const res = await upsertClanFromApi(job.entityName);
      // If 404, auto-disable tracking for this entity
      if (res?.notFound){
        setTracked({ entityType:"clan", name:job.entityName, enabled:false });
        return;
      }
      await insertLogs("clan", job.entityName);
    }
  });

  // Run at most one due leaderboard watch per tick.
  try{
    const r = await runOneDueLeaderboardWatch();
	    // Only emit a status message when something happened (ran/saved/error).
	    if (r && r.ok && (r.ran || r.saved || r.error)){
	      try{ mainWindow?.webContents?.send("leaderboardWatch:status", r); }catch{}
	    }
  }catch{}

  // Always push a lightweight "tick" so the UI can show due/blocked status even before a watch has ever run.
  try{
    const watches = listLeaderboardWatches({ enabledOnly:true, limit:200 });
    mainWindow?.webContents?.send("leaderboardWatch:tick", {
      now: new Date().toISOString(),
      scanBusy: !!globalThis.__idleclansLeaderboardScanController,
      watches,
    });
  }catch{}
}