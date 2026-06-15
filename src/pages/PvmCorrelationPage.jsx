import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, onLeaderboardScanProgress, onLeaderboardWatchStatus, onLeaderboardWatchTick } from "../lib/bridge.js";
import { Card } from "../components/Card.jsx";

// ── Boss / Raid keys (stable — defined outside component) ─────────────────────
const PVM_BOSS_KEYS = [
  { key:"zeus",                     label:"Zeus" },
  { key:"medusa",                   label:"Medusa" },
  { key:"griffin",                  label:"Griffin" },
  { key:"hades",                    label:"Hades" },
  { key:"chimera",                  label:"Chimera" },
  { key:"wyvern",                   label:"Wyvern" },
  { key:"kraken",                   label:"Kraken" },
  { key:"manticore",                label:"Manticore" },
  { key:"fenrir",                   label:"Fenrir" },
  { key:"guardians_of_the_citadel", label:"Guardians of the Citadel" },
  { key:"reckoning_of_the_gods",    label:"Reckoning of the Gods" },
  { key:"bloodmoon_massacre",       label:"Bloodmoon Massacre" },
];

function FieldLabel({ children, title, style={} }){
  return (
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", opacity:0.45, marginBottom:5, ...style }} title={title}>
      {children}
    </div>
  );
}
function FilterCard({ children }){
  return (
    <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"12px 14px" }}>
      {children}
    </div>
  );
}
function InfoStrip({ children }){
  return (
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", fontSize:12, opacity:0.55, marginTop:8 }}>
      {children}
    </div>
  );
}

function BossKeyPicker({ value, onChange }){
  const [open, setOpen] = React.useState(false);
  const [q, setQ]       = React.useState(value||"");
  const ref             = React.useRef(null);

  React.useEffect(()=>{ setQ(value||""); }, [value]);

  React.useEffect(()=>{
    if (!open) return;
    function handler(e){ if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = q.trim()
    ? PVM_BOSS_KEYS.filter(b=>b.label.toLowerCase().includes(q.toLowerCase())||b.key.includes(q.toLowerCase()))
    : PVM_BOSS_KEYS;

  function pick(key){ onChange(key); setQ(key); setOpen(false); }
  function handleInput(e){ setQ(e.target.value); onChange(e.target.value); setOpen(true); }
  function handleClear(){ setQ(""); onChange(""); setOpen(false); }

  return (
    <div ref={ref} style={{ position:"relative", width:210 }}>
      <div style={{ position:"relative" }}>
        <input className="input" placeholder="All bosses — type to filter"
          value={q} style={{ width:"100%", paddingRight:28 }}
          onChange={handleInput}
          onFocus={()=>setOpen(true)}
          onKeyDown={e=>{ if(e.key==="Escape") setOpen(false); }}
        />
        {q && (
          <button onClick={handleClear} style={{
            position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
            background:"none", border:"none", cursor:"pointer", opacity:0.4, fontSize:16, padding:0, lineHeight:1,
          }}>×</button>
        )}
      </div>
      {open && filtered.length>0 && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:200,
          background:"rgba(6,22,14,0.97)", border:"1px solid rgba(255,255,255,0.12)",
          borderRadius:10, overflow:"hidden", boxShadow:"0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {filtered.map(b=>(
            <div key={b.key} onMouseDown={()=>pick(b.key)} style={{
              padding:"8px 12px", cursor:"pointer", fontSize:13,
              borderBottom:"1px solid rgba(255,255,255,0.05)",
              background: b.key===value ? "rgba(var(--info-rgb),0.12)" : "transparent",
            }}>
              <span style={{ fontWeight:600, color: b.key===value ? "var(--info)" : "rgba(255,255,255,0.85)" }}>{b.label}</span>
              <span style={{ marginLeft:8, opacity:0.35, fontSize:11 }}>{b.key}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PvmCorrelationPage(){
  const [tab, setTab] = useState("pvm"); // "pvm" | "leaderboard"

  // -------------------------------
  // PvM correlation state
  // -------------------------------
  const [days, setDays] = useState(7);
  const [windowKind, setWindowKind] = useState("daily"); // "daily" or "rolling"
  const [rollingHours, setRollingHours] = useState(1);
  const [rollingEndNow, setRollingEndNow] = useState(true);
  const [rollingEndLocal, setRollingEndLocal] = useState(""); // datetime-local (local time)
  const [dailyEndDate, setDailyEndDate] = useState(""); // YYYY-MM-DD (local)

  const [pvmMinGroupSize, setPvmMinGroupSize] = useState(2);
  const [pvmMinDelta, setPvmMinDelta] = useState(1);
  const [bossKey, setBossKey] = useState("");
  const [trackedOnly, setTrackedOnly] = useState(true);
  // Optional: narrow PvM correlation results to a small set of players (useful when jumping from leaderboard groups).
  const [pvmPlayersCsv, setPvmPlayersCsv] = useState("");

  const [pvmToleranceOn, setPvmToleranceOn] = useState(false);
  const [pvmTolerance, setPvmTolerance] = useState(1);
  const [pvmSort, setPvmSort] = useState("delta"); // delta | size

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [verifyByGroupKey, setVerifyByGroupKey] = useState({});
  const [pvmExpanded, setPvmExpanded] = useState({}); // groupKey => boolean

  // -------------------------------
  // Leaderboard correlation state
  // -------------------------------
  const [lbBoards, setLbBoards] = useState([]);
  const [lbBoardKey, setLbBoardKey] = useState("");

  // DB-backed leaderboard snapshots (preferred for repeatable correlation)
  const [lbSnapshots, setLbSnapshots] = useState([]); // [{id, title, createdAt, rowCount}]
  const [lbBaselineSnapshotId, setLbBaselineSnapshotId] = useState(null);
  const [lbCompareSnapshotId, setLbCompareSnapshotId] = useState(null);
  // Snapshot timeline UX: click a snapshot to preview + one-click compare actions.
  const [lbSelectedSnapshotId, setLbSelectedSnapshotId] = useState(null);

  // Baseline (persisted per board)
  const [lbBaselineAt, setLbBaselineAt] = useState(null);
  const [lbBaselineMap, setLbBaselineMap] = useState(null); // {nameLower: value}
  const [lbBaselineMeta, setLbBaselineMeta] = useState(null); // {rows, capturedAtIso}

  // Latest scan + deltas
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState(null);
  const [lbGroups, setLbGroups] = useState([]);
  const [lbClanMap, setLbClanMap] = useState({});
  const [lbProgress, setLbProgress] = useState(null);

  // Scheduled watch for this board (optional)
  const [lbWatch, setLbWatch] = useState(null); // {id,...}
  const [lbWatchEnabled, setLbWatchEnabled] = useState(false);
  const [lbWatchInterval, setLbWatchInterval] = useState(10);
  const [lbWatchSaveMode, setLbWatchSaveMode] = useState("ifChanged"); // always | ifChanged
  const [lbWatchRetentionDays, setLbWatchRetentionDays] = useState(30);

  // Snapshot list paging (simple “load more”)
  const [lbSnapshotLimit, setLbSnapshotLimit] = useState(50);
  const [lbSnapshotsTotal, setLbSnapshotsTotal] = useState(null);
  const [lbWatchStatus, setLbWatchStatus] = useState(null); // last status payload
  const [lbWatchTick, setLbWatchTick] = useState({ now: null, scanBusy: false });


  // Snapshot board viewer (investigation aid)
    const [lbBoardViewerOpen, setLbBoardViewerOpen] = useState(false);
    const [lbBoardViewerMode, setLbBoardViewerMode] = useState("snapshot"); // snapshot | diff
    const [lbBoardViewerTitle, setLbBoardViewerTitle] = useState("");
    const [lbBoardViewerLoading, setLbBoardViewerLoading] = useState(false);
    const [lbBoardViewerError, setLbBoardViewerError] = useState(null);
    const [lbBoardViewerRows, setLbBoardViewerRows] = useState([]); // [{rank,name,value,clanName,baseline,compare,delta}]
    const [lbBoardViewerSearch, setLbBoardViewerSearch] = useState("");
    const [lbBoardViewerOnlyChanged, setLbBoardViewerOnlyChanged] = useState(true);

  const [lbLastScanAt, setLbLastScanAt] = useState(null);
  const [lbLatestMeta, setLbLatestMeta] = useState(null); // {rowsNow, matchedPlayers, missingFromNow, newInNow}

  const [lbMinGroupSize, setLbMinGroupSize] = useState(2);
  const [lbMinDelta, setLbMinDelta] = useState(1);
  const [lbToleranceOn, setLbToleranceOn] = useState(false);
  const [lbTolerance, setLbTolerance] = useState(1);
  const [lbSort, setLbSort] = useState("suspicious"); // suspicious | delta | size

  const [lbExpanded, setLbExpanded] = useState({}); // groupKey => boolean
  const [lbAdvancedOpen, setLbAdvancedOpen] = useState(false);
  const [lbRun, setLbRun] = useState(null); // { boardKey, baselineAt, compareAt, baselineRows, compareRows, scopeRows }
  const [lbSavedRunSnapshotIds, setLbSavedRunSnapshotIds] = useState(null); // { baselineSnapshotId, compareSnapshotId }
  const [copyToast, setCopyToast] = useState(null); // {msg, at}

  const toastTimer = useRef(null);

  function showToast(msg){
    try{
      if (toastTimer.current) clearTimeout(toastTimer.current);
    }catch{}
    setCopyToast({ msg, at: Date.now() });
    toastTimer.current = setTimeout(()=>setCopyToast(null), 2200);
  }

  function fmtTime(iso){
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  function fmtClock(iso){
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
  }

  function fmtDueMs(ms){
    if (!Number.isFinite(ms)) return "—";
    if (ms <= 0) return "due now";
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m <= 0) return `${remS}s`;
    if (m < 60) return `${m}m ${remS}s`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM}m`;
  }

  function localDatetimeToIso(v){
    const s = String(v||"").trim();
    if (!s) return null;
    const d = new Date(s); // datetime-local interpreted as local time
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function clampInt(n, lo, hi, fallback){
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(x)));
  }

  // -------------------------------
  // Leaderboard correlation helpers
  // -------------------------------
  function parseBoardKey(boardKey){
    const s = String(boardKey||"");
    const [left, cat] = s.split("|");
    const [entityType, gameMode] = String(left||"").split(":");
    return {
      entityType: (entityType||"").trim(),
      gameMode: (gameMode||"default").trim() || "default",
      category: (cat||"").trim(),
    };
  }

  function inferBossKeyFromBoard(boardKey){
    const { category } = parseBoardKey(boardKey);
    return String(category||"").trim();
  }

  function parsePlayersCsv(csv){
    const set = new Set();
    const parts = String(csv||"")
      .split(/[,\n\t ]+/g)
      .map(s=>s.trim())
      .filter(Boolean);
    for (const p of parts){
      set.add(p.toLowerCase());
    }
    return set;
  }

  function prettyBoardLabel(boardKey){
    const { entityType, gameMode, category } = parseBoardKey(boardKey);
    const et = entityType === "players" ? "Players" : (entityType === "clans" ? "Clans" : entityType);
    const gm = gameMode && gameMode !== "default" ? ` (${gameMode})` : "";
    const cat = category ? category.replace(/_/g, " ") : "";
    const niceCat = cat ? cat.replace(/\b\w/g, (c)=>c.toUpperCase()) : "";
    return `${et}${gm} → ${niceCat || boardKey}`;
  }

  async function loadAllLeaderboardRows(boardKey){
    const limit = 5000;
    let offset = 0;
    let out = [];
    let total = null;
    while (true){
      const r = await api.getLeaderboardCache({ boardKey, limit, offset });
      const rows = Array.isArray(r?.rows) ? r.rows : [];
      if (total === null) total = Number(r?.totalRows || 0);
      out = out.concat(rows);
      offset += rows.length;
      if (!rows.length || offset >= total) break;
    }
    return out;
  }

  async function loadAllLeaderboardSnapshotRows(snapshotId){
    const limit = 5000;
    let offset = 0;
    let out = [];
    let total = null;
    while (true){
      const r = await api.getLeaderboardSnapshotRows({ snapshotId, limit, offset });
      if (!r?.ok) throw new Error(r?.error || "Failed to load snapshot rows");
      const rows = Array.isArray(r?.rows) ? r.rows : [];
      if (total === null) total = Number(r?.totalRows || 0);
      out = out.concat(rows);
      offset += rows.length;
      if (!rows.length || offset >= total) break;
    }
    return out;
  }

  async function refreshLbBoards(){
    const boards = await api.listLeaderboardBoards();
    const arr = Array.isArray(boards) ? boards : [];
    const playerBoards = arr.filter(b=> String(b.boardKey||"").startsWith("players:"));
    setLbBoards(playerBoards);
    if (!lbBoardKey && playerBoards.length) setLbBoardKey(playerBoards[0].boardKey);
  }

  function persistLbSnapshotSelection(boardKey, baselineSnapshotId, compareSnapshotId){
    try{
      localStorage.setItem(`lbSnapshotSel:${boardKey}`, JSON.stringify({ baselineSnapshotId, compareSnapshotId }));
    }catch{}
  }

  function readPersistedLbSnapshotSelection(boardKey){
    try{
      const raw = localStorage.getItem(`lbSnapshotSel:${boardKey}`);
      if (!raw) return null;
      return JSON.parse(raw);
    }catch{
      return null;
    }
  }

  async function loadLeaderboardWatchForBoard(boardKey){
    if (!boardKey) return null;
    try{
      const ws = await api.listLeaderboardWatches({ boardKey, limit: 5 });
      const w = Array.isArray(ws) && ws.length ? ws[0] : null;
      setLbWatch(w);
      setLbWatchEnabled(!!w?.enabled);
      setLbWatchInterval(Number(w?.intervalMinutes || 10));
      setLbWatchSaveMode(w?.saveMode || "ifChanged");
      setLbWatchRetentionDays(w?.retentionDays !== null && w?.retentionDays !== undefined ? Number(w.retentionDays) : 30);
      return w;
    }catch{
      setLbWatch(null);
      setLbWatchEnabled(false);
      return null;
    }
  }

  async function saveLeaderboardWatch(){
    if (!lbBoardKey) return;
    try{
      const res = await api.upsertLeaderboardWatch({
        id: lbWatch?.id || null,
        boardKey: lbBoardKey,
        title: lbWatch?.title || null,
        enabled: !!lbWatchEnabled,
        intervalMinutes: clampInt(lbWatchInterval, 1, 24*60, 10),
        saveMode: lbWatchSaveMode === "always" ? "always" : "ifChanged",
        retentionDays: clampInt(lbWatchRetentionDays, 1, 3650, 30),
      });
      if (res?.ok && res.watch){
        setLbWatch(res.watch);
        showToast("Watch saved");
      }
    }catch(err){
      showToast(String(err?.message||err));
    }
  }

  async function deleteLeaderboardWatchUi(){
    if (!lbWatch?.id) return;
    if (!confirm("Delete this watch?")) return;
    try{
      await api.deleteLeaderboardWatch(lbWatch.id);
      setLbWatch(null);
      setLbWatchEnabled(false);
      showToast("Watch deleted");
    }catch(err){
      showToast(String(err?.message||err));
    }
  }

  async function stopLeaderboardWatchUi(){
    if (!lbBoardKey) return;
    if (!lbWatch?.id) return;
    try{
      // Persist disabled state.
      const res = await api.upsertLeaderboardWatch({
        id: lbWatch.id,
        boardKey: lbBoardKey,
        title: lbWatch?.title || null,
        enabled: false,
        intervalMinutes: clampInt(lbWatchInterval, 1, 24*60, 10),
        saveMode: lbWatchSaveMode === "always" ? "always" : "ifChanged",
        retentionDays: clampInt(lbWatchRetentionDays, 1, 3650, 30),
      });
      if (res?.ok && res.watch){
        setLbWatch(res.watch);
        setLbWatchEnabled(false);
        showToast("Watch stopped");
      }
    }catch(err){
      showToast(String(err?.message||err));
    }
  }



  async function startLeaderboardWatchUi(){
    if (!lbBoardKey) return;
    if (!lbWatch?.id) return;
    try{
      const res = await api.upsertLeaderboardWatch({
        id: lbWatch.id,
        boardKey: lbBoardKey,
        title: lbWatch?.title || null,
        enabled: true,
        intervalMinutes: clampInt(lbWatchInterval, 1, 24*60, 10),
        saveMode: lbWatchSaveMode === "always" ? "always" : "ifChanged",
        retentionDays: clampInt(lbWatchRetentionDays, 1, 3650, 30),
      });
      if (res?.ok && res.watch){
        setLbWatch(res.watch);
        setLbWatchEnabled(true);
        showToast("Watch started");
      }
    }catch(err){
      showToast(String(err?.message||err));
    }
  }

  async function reloadLeaderboardSnapshots(nextLimit){
    if (!lbBoardKey) return [];
    const lim = Math.max(1, Math.min(5000, Number(nextLimit || lbSnapshotLimit || 50)));
    setLbSnapshotLimit(lim);
    try{
      const [snaps, total] = await Promise.all([
        api.listLeaderboardSnapshots({ boardKey: lbBoardKey, limit: lim }),
        api.countLeaderboardSnapshots ? api.countLeaderboardSnapshots({ boardKey: lbBoardKey }) : Promise.resolve(null),
      ]);
      const arr = Array.isArray(snaps) ? snaps : [];
      setLbSnapshots(arr);
      if (total !== null && total !== undefined && Number.isFinite(Number(total))) setLbSnapshotsTotal(Number(total));
      return arr;
    }catch{
      // Best effort; keep existing list.
      return lbSnapshots || [];
    }
  }

  async function loadMoreLeaderboardSnapshots(){
    const next = Math.min(5000, Number(lbSnapshotLimit || 50) + 50);
    await reloadLeaderboardSnapshots(next);
  }

  async function runWatchNowUi(){
    if (!lbWatch?.id) {
      // Create + enable then run.
      setLbWatchEnabled(true);
      await saveLeaderboardWatch();
      if (!lbWatch?.id) return;
    }
    try{
      await api.runLeaderboardWatchNow(lbWatch.id);
      showToast("Queued watch run");
      // Force reload of watch row.
      await loadLeaderboardWatchForBoard(lbBoardKey);
    }catch(err){
      showToast(String(err?.message||err));
    }
  }

  async function deleteSnapshotUi(snapshotId){
    const id = Number(snapshotId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!confirm(`Delete snapshot #${id}? This removes its stored rows.`)) return;
    try{
      const r = await api.deleteLeaderboardSnapshot(id);
      if (r?.ok){
        await reloadLeaderboardSnapshots(lbSnapshotLimit);
        if (lbBaselineSnapshotId === id) setLbBaselineSnapshotId(null);
        if (lbCompareSnapshotId === id) setLbCompareSnapshotId(null);
        showToast(`Deleted snapshot #${id}`);
      }
    }catch(err){
      showToast(String(err?.message||err));
    }
  }

  function getSnapshotById(id){
    const sid = Number(id);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    return (lbSnapshots || []).find(s=>Number(s.id) === sid) || null;
  }

  async function compareSnapshotsQuick(baselineId, compareId){
    const bId = Number(baselineId);
    const cId = Number(compareId);
    if (!Number.isFinite(bId) || !Number.isFinite(cId) || bId <= 0 || cId <= 0) return;
    setLbBaselineSnapshotId(bId);
    setLbCompareSnapshotId(cId);
    setLbSelectedSnapshotId(cId);
    setLbLoading(true);
    setLbError(null);
    try{
      try{ await loadLeaderboardBaselineFromSnapshot(bId); }catch{}
      await correlateLeaderboardSnapshotsWithIds(bId, cId);
    }catch(err){
      setLbError(String(err?.message || err));
    }finally{
      setLbLoading(false);
    }
  }

  function getPrevSnapshotId(snapshotId){
    const sid = Number(snapshotId);
    if (!Number.isFinite(sid) || sid <= 0) return null;
    const idx = (lbSnapshots || []).findIndex(s=>Number(s.id) === sid);
    if (idx < 0) return null;
    const prev = (lbSnapshots || [])[idx + 1]; // list is DESC, so next index is previous in time
    return prev ? Number(prev.id) : null;
  }

  function renderLeaderboardSnapshotTimeline(){
    const snaps = lbSnapshots || [];
    if (!snaps.length) return null;

    const selectedId = lbSelectedSnapshotId || lbCompareSnapshotId || lbBaselineSnapshotId || snaps[0].id;
    const selected = getSnapshotById(selectedId);
    const prevId = selected ? getPrevSnapshotId(selected.id) : null;
    const baselinePinned = !!lbBaselineSnapshotId;
    const latestId = snaps[0]?.id || null;

    return (
      <div style={{ display:"grid", gridTemplateColumns:"360px 1fr", gap:12 }}>
        {/* Snapshot list */}
        <div style={{ border:"1px solid rgba(255,255,255,0.10)", borderRadius:12, overflow:"hidden" }}>
          <div className="row" style={{ justifyContent:"space-between", padding:"10px 12px", borderBottom:"1px solid rgba(255,255,255,0.10)", alignItems:"center" }}>
            <div className="small" style={{ fontWeight:800 }}>
              Snapshots{lbSnapshotsTotal !== null && lbSnapshotsTotal !== undefined ? ` (${Number(lbSnapshotsTotal).toLocaleString()})` : ""}
            </div>
            <div className="row" style={{ gap:8, alignItems:"center" }}>
              <div className="small" style={{ opacity:0.75 }}>
                {snaps.length.toLocaleString()} shown{lbSnapshotsTotal ? ` of ${Number(lbSnapshotsTotal).toLocaleString()}` : ""}
              </div>
              {lbSnapshotsTotal && snaps.length < Number(lbSnapshotsTotal) ? (
                <button className="btn btnSmall" onClick={loadMoreLeaderboardSnapshots} title="Load 50 more snapshots">
                  Load more
                </button>
              ) : null}
            </div>
          </div>

          <div style={{ maxHeight:220, overflow:"auto" }}>
            {snaps.map((s)=>{
              const active = Number(s.id) === Number(selected?.id);
              const isBaseline = lbBaselineSnapshotId && Number(s.id) === Number(lbBaselineSnapshotId);
              const isCompare = lbCompareSnapshotId && Number(s.id) === Number(lbCompareSnapshotId);
              const label = `${fmtClock(s.createdAt)} · #${s.id}`;
              return (
                <button
                  key={s.id}
                  className={"btn"}
                  onClick={()=>setLbSelectedSnapshotId(Number(s.id))}
                  style={{
                    width:"100%",
                    textAlign:"left",
                    padding:"8px 12px",
                    borderRadius:0,
                    border:"none",
                    background: active ? "rgba(255,255,255,0.06)" : "transparent",
                    display:"flex",
                    justifyContent:"space-between",
                    gap:10,
                    alignItems:"center",
                  }}
                  title={`${prettyBoardLabel(lbBoardKey)} · ${fmtTime(s.createdAt)} · ${(Number(s.rowCount||0)).toLocaleString()} rows`}
                >
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    <div className="small" style={{ fontWeight:800, opacity:0.95 }}>{label}</div>
                    <div className="small" style={{ opacity:0.75 }}>{(Number(s.rowCount||0)).toLocaleString()} rows</div>
                  </div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
                    {isBaseline ? <span className="tag" title="Pinned baseline">Baseline</span> : null}
                    {isCompare ? <span className="tag" title="Selected compare">Compare</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Details + quick actions */}
        <div style={{ border:"1px solid rgba(255,255,255,0.10)", borderRadius:12, padding:12 }}>
          {selected ? (
            <>
              <div className="row" style={{ justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                <div>
                  <div style={{ fontWeight:900 }}>#{selected.id} · {fmtTime(selected.createdAt)}</div>
                  <div className="small" style={{ opacity:0.8, marginTop:2 }}>
                    {prettyBoardLabel(lbBoardKey)} · {(Number(selected.rowCount||0)).toLocaleString()} rows
                  </div>
                </div>
                <div className="row" style={{ gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
                  <button
                    className={"btn btnSmall" + (!prevId || lbLoading ? " disabled" : "")}
                    disabled={!prevId || lbLoading}
                    onClick={()=>compareSnapshotsQuick(prevId, selected.id)}
                    title={prevId ? `Compare previous (#${prevId}) → selected (#${selected.id})` : "No previous snapshot"}
                  >
                    Compare to previous
                  </button>


                  <button
                    className={"btn btnSmall" + (lbLoading ? " disabled" : "")}
                    disabled={lbLoading}
                    onClick={()=>openLeaderboardSnapshotBoard(selected.id)}
                    title="View this snapshot as a full leaderboard table"
                  >
                    View board
                  </button>

                  {(() => {
                    const diffBase = (baselinePinned && Number(lbBaselineSnapshotId) !== Number(selected.id)) ? lbBaselineSnapshotId : prevId;
                    const can = !!diffBase && Number(diffBase) !== Number(selected.id) && !lbLoading;
                    if (!diffBase) return null;
                    return (
                      <button
                        className={"btn btnSmall" + (!can ? " disabled" : "")}
                        disabled={!can}
                        onClick={()=>openLeaderboardDiffBoard(diffBase, selected.id)}
                        title={`View a full leaderboard diff table for #${diffBase} → #${selected.id}`}
                      >
                        View diff
                      </button>
                    );
                  })()}


                  <button
                    className={"btn btnSmall" + (lbLoading ? " disabled" : "")}
                    disabled={lbLoading}
                    onClick={()=>{
                      setLbBaselineSnapshotId(Number(selected.id));
                      setLbCompareSnapshotId(null);
                      setLbSelectedSnapshotId(Number(selected.id));
                      try{ loadLeaderboardBaselineFromSnapshot(Number(selected.id)); }catch{}
                      persistLbSnapshotSelection(lbBoardKey, Number(selected.id), null);
                    }}
                    title="Pin this snapshot as the baseline (for repeated comparisons)."
                  >
                    Set baseline
                  </button>

                  <button
                    className={"btn btnSmall" + (!baselinePinned || lbLoading ? " disabled" : "")}
                    disabled={!baselinePinned || lbLoading}
                    onClick={()=>compareSnapshotsQuick(lbBaselineSnapshotId, selected.id)}
                    title={baselinePinned ? `Compare pinned baseline (#${lbBaselineSnapshotId}) → selected (#${selected.id})` : "Set a baseline first"}
                  >
                    Baseline → this
                  </button>

                  <button
                    className={"btn btnSmall" + (!latestId || Number(latestId) === Number(selected.id) || lbLoading ? " disabled" : "")}
                    disabled={!latestId || Number(latestId) === Number(selected.id) || lbLoading}
                    onClick={()=>compareSnapshotsQuick(selected.id, latestId)}
                    title={latestId ? `Compare selected (#${selected.id}) → latest (#${latestId})` : "No latest snapshot"}
                  >
                    This → latest
                  </button>

                  <button
                    className={"btn btnSmall" + (lbLoading ? " disabled" : "")}
                    disabled={lbLoading}
                    onClick={()=>deleteSnapshotUi(selected.id)}
                    title="Delete this snapshot"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="small" style={{ opacity:0.75, marginTop:8 }}>
                Tip: click a snapshot on the left to preview it here. Use <b>Compare to previous</b> for the usual "last run → this run" workflow.
              </div>
            </>
          ) : (
            <div className="small" style={{ opacity:0.8 }}>Select a snapshot to view details and quick compare actions.</div>
          )}
        </div>
      </div>
    );
  }

  function getScoreOrLevel(row){
    const v = (row?.score !== null && row?.score !== undefined) ? Number(row.score)
            : (row?.level !== null && row?.level !== undefined) ? Number(row.level)
            : null;
    if (v === null || Number.isNaN(v)) return null;
    return v;
  }

  async function openLeaderboardSnapshotBoard(snapshotId){
      const sid = Number(snapshotId);
      if (!Number.isFinite(sid) || sid <= 0) return;
      setLbBoardViewerOpen(true);
      setLbBoardViewerMode("snapshot");
      setLbBoardViewerError(null);
      setLbBoardViewerLoading(true);
      setLbBoardViewerOnlyChanged(false);
      setLbBoardViewerSearch("");
      try{
        const snap = await api.getLeaderboardSnapshot(sid);
        const rows = await loadAllLeaderboardSnapshotRows(sid);
  
        // Build clan map (best-effort)
        const names = rows.map(r=>String(r?.name||"").toLowerCase()).filter(Boolean);
        const uniq = Array.from(new Set(names));
        let clanMap = {};
        try{
          const res = await api.getPlayersClanMap(uniq);
          if (res?.ok && res?.clans) clanMap = res.clans;
        }catch{}
  
        const out = [];
        for (const r of rows){
          const name = String(r?.name||"");
          const nl = name.toLowerCase();
          const value = getScoreOrLevel(r);
          if (!nl) continue;
          out.push({
            rank: r?.rank ?? null,
            name,
            value,
            clanName: clanMap?.[nl]?.clanName || "",
          });
        }
  
        // Sort by value desc (fallback to name)
        out.sort((a,b)=>{
          const av = (a.value === null || a.value === undefined) ? -Infinity : Number(a.value);
          const bv = (b.value === null || b.value === undefined) ? -Infinity : Number(b.value);
          if (bv !== av) return bv - av;
          return String(a.name||"").localeCompare(String(b.name||""));
        });
  
        // Fill rank if missing
        for (let i=0;i<out.length;i++){
          if (out[i].rank === null || out[i].rank === undefined) out[i].rank = i+1;
        }
  
        setLbBoardViewerRows(out);
        setLbBoardViewerTitle(`${prettyBoardLabel(lbBoardKey)} · Snapshot #${sid}${snap?.createdAt ? ` · ${fmtTime(snap.createdAt)}` : ""}`);
      }catch(err){
        setLbBoardViewerError(String(err?.message || err));
        setLbBoardViewerRows([]);
        setLbBoardViewerTitle("");
      }finally{
        setLbBoardViewerLoading(false);
      }
    }
  
    async function openLeaderboardDiffBoard(baselineId, compareId){
      const bId = Number(baselineId);
      const cId = Number(compareId);
      if (!Number.isFinite(bId) || bId <= 0 || !Number.isFinite(cId) || cId <= 0) return;
      setLbBoardViewerOpen(true);
      setLbBoardViewerMode("diff");
      setLbBoardViewerError(null);
      setLbBoardViewerLoading(true);
      setLbBoardViewerOnlyChanged(true);
      setLbBoardViewerSearch("");
      try{
        const [bSnap, cSnap] = await Promise.all([
          api.getLeaderboardSnapshot(bId),
          api.getLeaderboardSnapshot(cId),
        ]);
        const [bRows, cRows] = await Promise.all([
          loadAllLeaderboardSnapshotRows(bId),
          loadAllLeaderboardSnapshotRows(cId),
        ]);
  
        const bMap = {};
        for (const r of bRows){
          const nl = String(r?.name||"").toLowerCase();
          if (!nl) continue;
          const v = getScoreOrLevel(r);
          if (v === null) continue;
          bMap[nl] = v;
        }
        const cMap = {};
        for (const r of cRows){
          const nl = String(r?.name||"").toLowerCase();
          if (!nl) continue;
          const v = getScoreOrLevel(r);
          if (v === null) continue;
          cMap[nl] = v;
        }
  
        const allNames = Array.from(new Set([...Object.keys(bMap), ...Object.keys(cMap)]));
        let clanMap = {};
        try{
          const res = await api.getPlayersClanMap(allNames);
          if (res?.ok && res?.clans) clanMap = res.clans;
        }catch{}
  
        const out = [];
        for (const nl of allNames){
          const baseline = (nl in bMap) ? Number(bMap[nl]) : null;
          const compare = (nl in cMap) ? Number(cMap[nl]) : null;
          const delta = (baseline !== null && compare !== null) ? (compare - baseline) : null;
          out.push({
            name: (clanMap?.[nl]?.name || nl),
            baseline,
            compare,
            delta,
            clanName: clanMap?.[nl]?.clanName || "",
          });
        }
  
        // Sort by delta desc, then compare value desc, then name
        out.sort((a,b)=>{
          const ad = (a.delta === null || a.delta === undefined) ? -Infinity : Number(a.delta);
          const bd = (b.delta === null || b.delta === undefined) ? -Infinity : Number(b.delta);
          if (bd !== ad) return bd - ad;
          const ac = (a.compare === null || a.compare === undefined) ? -Infinity : Number(a.compare);
          const bc = (b.compare === null || b.compare === undefined) ? -Infinity : Number(b.compare);
          if (bc !== ac) return bc - ac;
          return String(a.name||"").localeCompare(String(b.name||""));
        });
  
        setLbBoardViewerRows(out);
        setLbBoardViewerTitle(`${prettyBoardLabel(lbBoardKey)} · Diff #${bId} → #${cId}${cSnap?.createdAt ? ` · ${fmtTime(cSnap.createdAt)}` : ""}`);
      }catch(err){
        setLbBoardViewerError(String(err?.message || err));
        setLbBoardViewerRows([]);
        setLbBoardViewerTitle("");
      }finally{
        setLbBoardViewerLoading(false);
      }
    }
  
    

  function renderLeaderboardBoardViewer(){
      if (!lbBoardViewerOpen) return null;
  
      const mode = lbBoardViewerMode;
      const search = String(lbBoardViewerSearch||"").trim().toLowerCase();
      const onlyChanged = !!lbBoardViewerOnlyChanged;
  
      let rows = Array.isArray(lbBoardViewerRows) ? lbBoardViewerRows : [];
      if (mode === "diff" && onlyChanged){
        rows = rows.filter(r=>Number(r?.delta || 0) !== 0);
      }
      if (search){
        rows = rows.filter(r=>{
          const n = String(r?.name||"").toLowerCase();
          const c = String(r?.clanName||"").toLowerCase();
          return n.includes(search) || c.includes(search);
        });
      }
  
      const headerCell = { padding:"10px 10px", borderBottom:"1px solid rgba(255,255,255,0.10)", fontSize:12, opacity:0.9, textAlign:"left" };
      const cell = { padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.06)", fontSize:13, textAlign:"left" };
  
      return (
        <div
          onClick={()=>setLbBoardViewerOpen(false)}
          style={{
            position:"fixed",
            inset:0,
            background:"rgba(0,0,0,0.55)",
            zIndex: 9999,
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding: 16,
          }}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{
              width: "min(1100px, 96vw)",
              maxHeight: "92vh",
              background: "#062b1b",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 12px 60px rgba(0,0,0,0.45)",
              display:"flex",
              flexDirection:"column",
            }}
          >
            <div className="row" style={{ justifyContent:"space-between", alignItems:"center", padding:"12px 12px", borderBottom:"1px solid rgba(255,255,255,0.12)" }}>
              <div>
                <div style={{ fontWeight:900 }}>{lbBoardViewerTitle || "Snapshot"}</div>
                <div className="small" style={{ opacity:0.8, marginTop:2 }}>
                  {mode === "diff" ? "Baseline → Compare" : "Snapshot board"} · {rows.length.toLocaleString()} rows
                </div>
              </div>
              <div className="row" style={{ gap:10, alignItems:"center" }}>
                <input
                  className="input"
                  placeholder="Search player or clan…"
                  value={lbBoardViewerSearch}
                  onChange={(e)=>setLbBoardViewerSearch(e.target.value)}
                  style={{ width: 260 }}
                />
                {mode === "diff" ? (
                  <label className="row small" style={{ gap:8, opacity:0.9 }}>
                    <input type="checkbox" checked={lbBoardViewerOnlyChanged} onChange={(e)=>setLbBoardViewerOnlyChanged(e.target.checked)} />
                    Only changed
                  </label>
                ) : null}
                <button className="btn" onClick={()=>setLbBoardViewerOpen(false)}>Close</button>
              </div>
            </div>
  
            {lbBoardViewerError ? (
              <div style={{ padding: 12 }}>
                <div className="small" style={{ color:"#ffb0b0" }}>{lbBoardViewerError}</div>
              </div>
            ) : null}
  
            <div style={{ padding: 12, overflow:"auto" }}>
              {lbBoardViewerLoading ? (
                <div className="small" style={{ opacity:0.8 }}>Loading…</div>
              ) : (
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    {mode === "diff" ? (
                      <tr>
                        <th style={headerCell}>Player</th>
                        <th style={headerCell}>Clan</th>
                        <th style={headerCell}>Baseline</th>
                        <th style={headerCell}>Compare</th>
                        <th style={headerCell}>Δ</th>
                      </tr>
                    ) : (
                      <tr>
                        <th style={headerCell}>Rank</th>
                        <th style={headerCell}>Player</th>
                        <th style={headerCell}>Clan</th>
                        <th style={headerCell}>Value</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {rows.slice(0, 2000).map((r, idx)=>{
                      if (mode === "diff"){
                        return (
                          <tr key={`${r.name}-${idx}`}>
                            <td style={cell}><a href={`#/players/${encodeURIComponent(r.name)}`}>{r.name}</a></td>
                            <td style={cell}>{r.clanName || ""}</td>
                            <td style={cell}>{r.baseline === null ? "—" : Number(r.baseline).toLocaleString()}</td>
                            <td style={cell}>{r.compare === null ? "—" : Number(r.compare).toLocaleString()}</td>
                            <td style={cell}>{r.delta === null ? "—" : (r.delta >= 0 ? `+${Number(r.delta).toLocaleString()}` : `${Number(r.delta).toLocaleString()}`)}</td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={`${r.name}-${idx}`}>
                          <td style={cell}>{r.rank ?? ""}</td>
                          <td style={cell}><a href={`#/players/${encodeURIComponent(r.name)}`}>{r.name}</a></td>
                          <td style={cell}>{r.clanName || ""}</td>
                          <td style={cell}>{r.value === null ? "—" : Number(r.value).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {(!lbBoardViewerLoading && rows.length > 2000) ? (
                <div className="small" style={{ opacity:0.7, marginTop:10 }}>
                  Showing first 2,000 rows. Use search to narrow.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    }


  async function setLeaderboardBaseline(){
    setLbLoading(true);
    setLbError(null);
    setLbProgress(null);
    try{
      if (!lbBoardKey) throw new Error("Select a leaderboard first.");
      // Freeze a coherent baseline snapshot from the current cached leaderboard.
      const snapRes = await api.createLeaderboardSnapshotFromCache({
        boardKey: lbBoardKey,
        title: `Baseline · ${prettyBoardLabel(lbBoardKey)}`,
        source: "baseline",
      });
      if (!snapRes?.ok) throw new Error(snapRes?.error || "Failed to create baseline snapshot");
      const snap = snapRes.snapshot;
      const rows = await loadAllLeaderboardSnapshotRows(snap.id);

      const base = {};
      for (const r of rows){
        const nl = String(r?.name||"").toLowerCase();
        if (!nl) continue;
        const val = getScoreOrLevel(r);
        if (val === null) continue;
        base[nl] = val;
      }

      setLbBaselineSnapshotId(snap.id);
      setLbBaselineMap(base);
      setLbBaselineAt(snap.createdAt);
      setLbBaselineMeta({ rows: rows.length, capturedAtIso: snap.createdAt, source: "snapshot", snapshotId: snap.id, title: snap.title });

      // Reset results (baseline changed)
      setLbGroups([]);
      setLbLastScanAt(null);
      setLbClanMap({});
      setLbLatestMeta(null);
      setLbExpanded({});

      // Refresh list & remember selection.
      try{ await reloadLeaderboardSnapshots(lbSnapshotLimit); }catch{}
      persistLbSnapshotSelection(lbBoardKey, snap.id, lbCompareSnapshotId);
    }catch(err){
      setLbError(String(err?.message || err));
    }finally{
      setLbLoading(false);
    }
  }

  async function createLeaderboardCompareSnapshot(){
    if (!lbBoardKey) return;
    setLbLoading(true);
    setLbError(null);
    try{
      const snapRes = await api.createLeaderboardSnapshotFromCache({
        boardKey: lbBoardKey,
        title: `Compare · ${prettyBoardLabel(lbBoardKey)} · ${fmtClock(new Date().toISOString())}`,
        source: "compare",
      });
      if (!snapRes?.ok) throw new Error(snapRes?.error || "Failed to create compare snapshot");
      const snap = snapRes.snapshot;

      try{ await reloadLeaderboardSnapshots(lbSnapshotLimit); }catch{}

      setLbCompareSnapshotId(snap.id);
      persistLbSnapshotSelection(lbBoardKey, lbBaselineSnapshotId, snap.id);
      setLbLastScanAt(snap.createdAt);
    }catch(err){
      setLbError(String(err?.message || err));
    }finally{
      setLbLoading(false);
    }
  }

  async function correlateBaselineToLatestSnapshot(){
    if (!lbBaselineSnapshotId) { setLbError("Select a baseline snapshot first."); return; }
    if (!lbBoardKey) return;

    setLbLoading(true);
    setLbError(null);
    setLbProgress({ status:"selecting_latest_snapshot" });
    try{
      const snaps = await api.listLeaderboardSnapshots({ boardKey: lbBoardKey, limit: 1 });
      const latest = Array.isArray(snaps) && snaps.length ? snaps[0] : null;
      if (!latest) throw new Error("No snapshots found yet. Create a compare snapshot (or rescan) first.");
      setLbCompareSnapshotId(latest.id);
      persistLbSnapshotSelection(lbBoardKey, lbBaselineSnapshotId, latest.id);
      // Correlate immediately
      await correlateLeaderboardSnapshotsWithIds(lbBaselineSnapshotId, latest.id);
    }catch(err){
      setLbError(String(err?.message || err));
      setLbProgress({ status:"error" });
    }finally{
      setLbLoading(false);
    }
  }

  async function loadLeaderboardBaselineFromSnapshot(snapshotId){
    const id = Number(snapshotId);
    if (!Number.isFinite(id) || id <= 0) return;
    setLbLoading(true);
    setLbError(null);
    try{
      const snap = await api.getLeaderboardSnapshot(id);
      if (!snap) throw new Error("Snapshot not found");
      const rows = await loadAllLeaderboardSnapshotRows(id);

      const base = {};
      for (const r of rows){
        const nl = String(r?.name||"").toLowerCase();
        if (!nl) continue;
        const val = getScoreOrLevel(r);
        if (val === null) continue;
        base[nl] = val;
      }

      setLbBaselineSnapshotId(id);
      setLbBaselineMap(base);
      setLbBaselineAt(snap.createdAt);
      setLbBaselineMeta({ rows: rows.length, capturedAtIso: snap.createdAt, source: "snapshot", snapshotId: id, title: snap.title });

      // Reset results (baseline changed)
      setLbGroups([]);
      setLbLastScanAt(null);
      setLbClanMap({});
      setLbLatestMeta(null);
      setLbExpanded({});

      persistLbSnapshotSelection(lbBoardKey, id, lbCompareSnapshotId);
    }catch(err){
      setLbError(String(err?.message || err));
    }finally{
      setLbLoading(false);
    }
  }

  async function applyLeaderboardCorrelationFromRows({ rowsNow, compareSnapshotId=null, compareCreatedAt=null } = {}){
    const nowSet = new Set();
    const deltas = [];
    // Prefer clan info frozen into snapshot rows. Fallback to DB lookup only if needed.
    const clanByLower = {};
    for (const r of (rowsNow||[])){
      const nl = String(r?.name||"").toLowerCase();
      if (!nl) continue;
      nowSet.add(nl);
      if (r?.clanName && !clanByLower[nl]) clanByLower[nl] = String(r.clanName);
      const nowVal = getScoreOrLevel(r);
      if (nowVal === null) continue;
      const beforeVal = lbBaselineMap ? lbBaselineMap[nl] : undefined;
      if (beforeVal === undefined) continue;

      const delta = nowVal - beforeVal;
      if (Number.isNaN(delta)) continue;

      deltas.push({
        name: r.name,
        nameLower: nl,
        before: beforeVal,
        after: nowVal,
        delta,
        clanName: clanByLower[nl] || null
      });
    }

    const baselineCount = lbBaselineMap ? Object.keys(lbBaselineMap).length : 0;
    const matchedPlayers = deltas.length;
    let missingFromNow = 0;
    if (lbBaselineMap){
      for (const k of Object.keys(lbBaselineMap)){
        if (!nowSet.has(k)) missingFromNow++;
      }
    }
    const newInNow = Math.max(0, (rowsNow||[]).length - matchedPlayers);

    setLbLatestMeta({ rowsNow: (rowsNow||[]).length, baselineCount, matchedPlayers, missingFromNow, newInNow, compareSnapshotId, compareCreatedAt });

    // Apply filters
    const md = Number(lbMinDelta||0);
    const mgs = Number(lbMinGroupSize||2);
    const filtered = deltas.filter(r=> r.delta >= md);

    const tol = lbToleranceOn ? clampInt(lbTolerance, 0, 999, 1) : 0;
    let grouped = groupByDeltaWithTolerance(filtered, tol).filter(g=> g.players.length >= mgs);
    grouped = sortGroups(grouped, lbSort);

    // If snapshot rows didn't include clan info, fall back to local DB lookup.
    const missingClan = grouped.some(g => (g.players||[]).some(p => !p.clanName));
    if (missingClan){
      const need = [];
      const seen = new Set();
      for (const g of grouped){
        for (const p of g.players){
          if (!p.clanName && !seen.has(p.nameLower)){
            seen.add(p.nameLower);
            need.push(p.name);
          }
        }
      }

      let clanMap = {};
      try{
        const res = await api.getPlayersClanMap(need);
        clanMap = res?.clans || {};
      }catch{}
      setLbClanMap(clanMap);

      grouped = grouped.map(g=>({
        ...g,
        players: g.players.map(p=>({
          ...p,
          clanName: p.clanName || clanMap[p.nameLower]?.clanName || null
        }))
      }));
    }else{
      setLbClanMap({});
    }

    setLbGroups(grouped);
  }

  async function correlateLeaderboardSnapshots(){
    if (!lbBaselineSnapshotId) { setLbError("Select a baseline snapshot first."); return; }
    if (!lbCompareSnapshotId) { setLbError("Select a compare snapshot first."); return; }
    setLbLoading(true);
    setLbError(null);
    try{
      await correlateLeaderboardSnapshotsWithIds(lbBaselineSnapshotId, lbCompareSnapshotId);
    }catch(err){
      setLbError(String(err?.message || err));
      setLbProgress({ status:"error" });
    }finally{
      setLbLoading(false);
    }
  }

  async function correlateLeaderboardSnapshotsWithIds(baselineId, compareId){
    setLbProgress({ status:"loading_snapshots" });
    const bId = Number(baselineId);
    const cId = Number(compareId);
    if (!Number.isFinite(bId) || bId <= 0) throw new Error("Invalid baseline snapshot");
    if (!Number.isFinite(cId) || cId <= 0) throw new Error("Invalid compare snapshot");

    // Ensure baseline map matches the selected baseline snapshot.
    if (!lbBaselineMap || lbBaselineSnapshotId !== bId){
      await loadLeaderboardBaselineFromSnapshot(bId);
    }

    const snapNow = await api.getLeaderboardSnapshot(cId);
    if (!snapNow) throw new Error("Compare snapshot not found");

    const rowsNow = await loadAllLeaderboardSnapshotRows(cId);
    setLbLastScanAt(snapNow.createdAt);
    await applyLeaderboardCorrelationFromRows({ rowsNow, compareSnapshotId: cId, compareCreatedAt: snapNow.createdAt });
    setLbProgress({ status:"done" });
    persistLbSnapshotSelection(lbBoardKey, bId, cId);
  }

  function groupByDeltaWithTolerance(deltaRows, tol){
    if (!tol || tol <= 0){
      // exact
      const by = new Map();
      for (const r of deltaRows){
        const key = String(r.delta);
        if (!by.has(key)) by.set(key, []);
        by.get(key).push(r);
      }
      const groups = Array.from(by.entries()).map(([key, players])=>({
        key,
        deltaMin: Number(key),
        deltaMax: Number(key),
        players
      }));
      return groups;
    }

    // tolerance sweep: sort by delta then cluster consecutive deltas within tol
    const sorted = [...deltaRows].sort((a,b)=> (a.delta - b.delta) || a.nameLower.localeCompare(b.nameLower));
    const groups = [];
    let cur = null;

    for (const r of sorted){
      if (!cur){
        cur = { key:`${r.delta}`, deltaMin:r.delta, deltaMax:r.delta, players:[r] };
        continue;
      }
      if (Math.abs(r.delta - cur.deltaMax) <= tol){
        cur.deltaMax = Math.max(cur.deltaMax, r.delta);
        cur.deltaMin = Math.min(cur.deltaMin, r.delta);
        cur.players.push(r);
      }else{
        groups.push(cur);
        cur = { key:`${r.delta}`, deltaMin:r.delta, deltaMax:r.delta, players:[r] };
      }
    }
    if (cur) groups.push(cur);

    // Stable keys for UI expansion
    return groups.map(g=>({
      ...g,
      key: `${g.deltaMin}..${g.deltaMax}`
    }));
  }

  function sortGroups(groups, sortMode){
    const arr = [...groups];
    if (sortMode === "size"){
      arr.sort((a,b)=> (b.players.length - a.players.length) || (Math.abs(b.deltaMax) - Math.abs(a.deltaMax)));
      return arr;
    }
    // default delta-desc (by max)
    arr.sort((a,b)=> (b.deltaMax - a.deltaMax) || (b.players.length - a.players.length));
    return arr;
  }

  function getClanStats(players){
    const clans = new Set();
    for (const p of (players||[])){
      const c = (p.clanName || "").trim();
      if (c) clans.add(c);
    }
    return { clanCount: clans.size, clans: Array.from(clans) };
  }

  function normalizeClanMap(raw){
    // Accept either:
    //  - { nameLower: { clanName } }
    //  - { nameLower: "Clan" }
    const out = {};
    for (const [k, v] of Object.entries(raw || {})){
      if (!k) continue;
      const kk = String(k).toLowerCase();
      if (v && typeof v === "object") out[kk] = { clanName: v.clanName || null };
      else if (typeof v === "string") out[kk] = { clanName: v };
      else out[kk] = { clanName: null };
    }
    return out;
  }

  async function waitForLeaderboardScanDone(boardKey, maxMs=120000){
    const start = Date.now();
    while (Date.now() - start < maxMs){
      try{
        const st = await api.getLeaderboardScanState(boardKey);
        // best-effort: treat falsy/undefined as done
        const running = !!(st?.running || st?.isRunning || st?.status === "running");
        if (!running) return true;
      }catch{
        // If we can't query state, fall back to progress status updates
        // (We'll just sleep a bit and continue)
      }
      await new Promise(r=>setTimeout(r, 400));
    }
    return false;
  }

  async function applyLeaderboardCorrelationFromRows({ rowsNow, compareSnapshotId=null, compareCreatedAt=null } = {}){
    const nowSet = new Set();
    const deltas = [];
    const snapshotClanByLower = {};
    for (const r of (rowsNow||[])){
      const nl = String(r?.name||"").toLowerCase();
      if (!nl) continue;
      nowSet.add(nl);

      // If snapshot rows include clan data, keep it for the UI (this makes results repeatable)
      if (r?.clanName && !snapshotClanByLower[nl]){
        snapshotClanByLower[nl] = String(r.clanName);
      }

      const nowVal = getScoreOrLevel(r);
      if (nowVal === null) continue;
      const beforeVal = lbBaselineMap ? lbBaselineMap[nl] : undefined;
      if (beforeVal === undefined) continue;

      const delta = nowVal - beforeVal;
      if (Number.isNaN(delta)) continue;

      deltas.push({
        name: r.name,
        nameLower: nl,
        before: beforeVal,
        after: nowVal,
        delta,
        clanName: snapshotClanByLower[nl] || null
      });
    }

    const baselineCount = lbBaselineMap ? Object.keys(lbBaselineMap).length : 0;
    const matchedPlayers = deltas.length;
    let missingFromNow = 0;
    if (lbBaselineMap){
      for (const k of Object.keys(lbBaselineMap)){
        if (!nowSet.has(k)) missingFromNow++;
      }
    }
    const newInNow = Math.max(0, (rowsNow||[]).length - matchedPlayers);

    setLbLatestMeta({ rowsNow: (rowsNow||[]).length, baselineCount, matchedPlayers, missingFromNow, newInNow, compareSnapshotId, compareCreatedAt });

    // Apply filters
    const md = Number(lbMinDelta||0);
    const mgs = Number(lbMinGroupSize||2);
    const filtered = deltas.filter(r=> r.delta >= md);

    const tol = lbToleranceOn ? clampInt(lbTolerance, 0, 999, 1) : 0;
    let grouped = groupByDeltaWithTolerance(filtered, tol).filter(g=> g.players.length >= mgs);
    grouped = sortGroups(grouped, lbSort);

    // Clan map: start with snapshot-provided values, then optionally fill missing via local DB.
    let clanMap = {};
    for (const [k,v] of Object.entries(snapshotClanByLower)) clanMap[k] = { clanName: v };

    const need = [];
    const seen = new Set();
    for (const g of grouped){
      for (const p of g.players){
        if (!seen.has(p.nameLower)){
          seen.add(p.nameLower);
          if (!clanMap[p.nameLower]?.clanName) need.push(p.name);
        }
      }
    }

    if (need.length){
      try{
        const res = await api.getPlayersClanMap(need);
        // Some implementations return { clans: { nameLower: "Clan" } }
        // Others return { clans: { nameLower: { clanName } } }
        const extraRaw = res?.clans || {};
        const extra = normalizeClanMap(extraRaw);
        clanMap = { ...extra, ...clanMap }; // snapshot wins
      }catch{}
    }
    setLbClanMap(clanMap);

    grouped = grouped.map(g=>({
      ...g,
      players: g.players.map(p=>({
        ...p,
        clanName: p.clanName || clanMap[p.nameLower]?.clanName || null
      }))
    }));

    setLbGroups(grouped);
  }

  async function rescanAndCorrelateLeaderboard(){
    setLbLoading(true);
    setLbError(null);
    setLbProgress({ status:"starting" });

    try{
      if (!lbBoardKey) throw new Error("Select a leaderboard first.");
      if (!lbBaselineMap) throw new Error("Set a baseline first.");

      const { entityType, gameMode, category } = parseBoardKey(lbBoardKey);

      // Trigger a rescan now (rate-limited on the backend)
      await api.scanLeaderboardBoard({
        entityType,
        gameMode,
        category,
        startCount: 1,
        maxCount: 100,
        resume: false,
        importMissing: false,
        clearCache: false
      });

      // IMPORTANT for reliability:
      // Wait until the scan job is actually finished before reading the refreshed cache.
      setLbProgress(prev=>({ ...(prev||{}), status:"waiting_for_completion" }));
      const done = await waitForLeaderboardScanDone(lbBoardKey, 120000);
      if (!done){
        setLbProgress(prev=>({ ...(prev||{}), status:"timeout_waiting_for_completion" }));
      }

      // Create a frozen "scan" snapshot from the refreshed cache, then compare snapshots.
      const scanAt = new Date().toISOString();
      const snapRes = await api.createLeaderboardSnapshotFromCache({
        boardKey: lbBoardKey,
        title: `Scan · ${prettyBoardLabel(lbBoardKey)} · ${fmtClock(scanAt)}`,
        source: "scan",
        note: `Created after a manual rescan at ${scanAt}`
      });
      if (!snapRes?.ok) throw new Error(snapRes?.error || "Failed to create scan snapshot");
      const snapNow = snapRes.snapshot;

      try{ await reloadLeaderboardSnapshots(lbSnapshotLimit); }catch{}

      setLbCompareSnapshotId(snapNow.id);
      persistLbSnapshotSelection(lbBoardKey, lbBaselineSnapshotId, snapNow.id);
      setLbLastScanAt(snapNow.createdAt || scanAt);

      const rowsNow = await loadAllLeaderboardSnapshotRows(snapNow.id);

      await applyLeaderboardCorrelationFromRows({
        rowsNow,
        compareSnapshotId: snapNow.id,
        compareCreatedAt: snapNow.createdAt || scanAt,
      });
      setLbProgress(prev=>({ ...(prev||{}), status:"done" }));
    }catch(err){
      setLbError(String(err?.message || err));
      setLbProgress(prev=>({ ...(prev||{}), status:"error" }));
    }finally{
      setLbLoading(false);
    }
  }

  // Quick investigator workflow:
  // 1) Freeze baseline from current cached leaderboard (in-memory)
  // 2) Rescan the leaderboard now
  // 3) Load refreshed cache and correlate deltas
  async function quickScanAndCorrelate(){
    setLbLoading(true);
    setLbError(null);
    setLbSavedRunSnapshotIds(null);
    setLbProgress({ status: "capturing_baseline" });

    try{
      if (!lbBoardKey) throw new Error("Select a leaderboard first.");

      // Freeze baseline from current cache (do NOT persist unless investigator chooses to).
      const baselineAt = new Date().toISOString();
      const baselineRows = await loadAllLeaderboardRows(lbBoardKey);

      const base = {};
      for (const r of (baselineRows||[])){
        const nl = String(r?.name||"").toLowerCase();
        if (!nl) continue;
        const val = getScoreOrLevel(r);
        if (val === null) continue;
        base[nl] = val;
      }

      setLbBaselineMap(base);
      setLbBaselineAt(baselineAt);
      setLbBaselineMeta({ rows: (baselineRows||[]).length, capturedAtIso: baselineAt, source: "cache" });

      // Reset previous results (new baseline)
      setLbGroups([]);
      setLbClanMap({});
      setLbLatestMeta(null);
      setLbExpanded({});

      // Rescan now (rate-limited on the backend)
      setLbProgress({ status: "scanning" });
      const { entityType, gameMode, category } = parseBoardKey(lbBoardKey);
      await api.scanLeaderboardBoard({
        entityType,
        gameMode,
        category,
        startCount: 1,
        maxCount: 100,
        resume: false,
        importMissing: false,
        clearCache: false,
      });

      setLbProgress({ status: "waiting_for_completion" });
      await waitForLeaderboardScanDone(lbBoardKey, 120000);

      setLbProgress({ status: "loading_latest" });
      const compareAt = new Date().toISOString();
      const compareRows = await loadAllLeaderboardRows(lbBoardKey);
      setLbLastScanAt(compareAt);

      // Keep the exact datasets in-memory so "Save run as snapshots" is deterministic.
      setLbRun({
        boardKey: lbBoardKey,
        baselineAt,
        compareAt,
        baselineRows,
        compareRows,
        scopeRows: (compareRows||[]).length,
      });

      await applyLeaderboardCorrelationFromRows({
        rowsNow: compareRows,
        compareSnapshotId: null,
        compareCreatedAt: compareAt,
      });

      setLbProgress({ status: "done" });
    }catch(err){
      setLbError(String(err?.message || err));
      setLbProgress({ status: "error" });
    }finally{
      setLbLoading(false);
    }
  }

  function openPvmCorrelationForLeaderboardGroup(group){
    try{
      const boss = inferBossKeyFromBoard(lbBoardKey);
      const names = (group?.players || []).map(p=>p.name).filter(Boolean);

      // Prefill PvM correlation to corroborate this leaderboard group.
      setBossKey(boss || "");
      setWindowKind("rolling");
      setRollingHours(1);
      setRollingEndNow(true);
      setTrackedOnly(false); // this is an investigative cross-check, not a flagged-only view
      setPvmMinGroupSize(2);
      setPvmMinDelta(1);
      setPvmToleranceOn(false);

      setPvmPlayersCsv(names.join(", "));
      setTab("pvm");

      // Run after state updates
      setTimeout(()=>{ try{ runPvm(); }catch{} }, 0);
    }catch{}
  }

  // Optional: persist the current quick-scan run as DB snapshots for repeatability.
  async function saveCurrentRunAsSnapshots(){
    if (!lbRun?.baselineRows?.length || !lbRun?.compareRows?.length) return;

    setLbLoading(true);
    setLbError(null);
    try{
      const boardKey = lbRun.boardKey || lbBoardKey;
      const baseAt = lbRun.baselineAt || new Date().toISOString();
      const cmpAt = lbRun.compareAt || new Date().toISOString();

      const baseRes = await api.createLeaderboardSnapshotFromRows({
        boardKey,
        title: `Baseline · ${prettyBoardLabel(boardKey)} · ${fmtClock(baseAt)}`,
        source: "baseline",
        capturedAt: baseAt,
        rows: lbRun.baselineRows,
      });
      if (!baseRes?.ok) throw new Error(baseRes?.error || "Failed to save baseline snapshot");

      const cmpRes = await api.createLeaderboardSnapshotFromRows({
        boardKey,
        title: `Compare · ${prettyBoardLabel(boardKey)} · ${fmtClock(cmpAt)}`,
        source: "compare",
        capturedAt: cmpAt,
        rows: lbRun.compareRows,
      });
      if (!cmpRes?.ok) throw new Error(cmpRes?.error || "Failed to save compare snapshot");

      setLbSavedRunSnapshotIds({ baselineSnapshotId: baseRes.snapshot?.id, compareSnapshotId: cmpRes.snapshot?.id });

      // Refresh snapshot list for the current board.
      try{ await reloadLeaderboardSnapshots(lbSnapshotLimit); }catch{}
    }catch(err){
      setLbError(String(err?.message || err));
    }finally{
      setLbLoading(false);
    }
  }

  async function copyEvidence(kind, group, extra={}){
    const lines = [];
    const nowIso = new Date().toISOString();
    lines.push(`Idle Clans Sentinel — ${kind} correlation evidence`);
    lines.push(`Exported: ${fmtTime(nowIso)} (${nowIso})`);
    lines.push("");

    if (kind === "PvM"){
      lines.push(`Window: ${group.window?.kind === "rolling" ? `Rolling ${group.window?.hours}h` : `Daily (${group.dayKey || ""})`}`);
      if (group.window?.kind === "rolling"){
        lines.push(`Baseline: ${fmtTime(group.window?.cutoffIso)} → Latest: ${fmtTime(group.window?.latestIso)}`);
      }
      lines.push(`Boss: ${group.bossKey || ""}`);
      lines.push(`Game mode: ${group.gameMode || "default"}`);
      lines.push(`Delta: ${group.delta >= 0 ? "+" : ""}${group.delta}`);
      lines.push(`Players: ${(group.players||[]).length}`);
      const cs = getClanStats(group.players||[]);
      lines.push(`Distinct clans: ${cs.clanCount}${cs.clans.length ? ` (${cs.clans.join(", ")})` : ""}`);
      lines.push("");
      for (const p of (group.players||[])){
        const nm = p.playerName || p.name;
        lines.push(`${nm}\t${p.before} → ${p.after}\tΔ ${group.delta >= 0 ? "+" : ""}${group.delta}\t${p.clanName || "—"}`);
      }
      if (extra?.leaderboardVerification){
        lines.push("");
        lines.push("Leaderboard verification:");
        lines.push(JSON.stringify(extra.leaderboardVerification, null, 2));
      }
    }

    if (kind === "Leaderboard"){
      const tol = extra?.toleranceOn ? ` (tolerance ±${extra.tolerance})` : "";
      lines.push(`Leaderboard: ${prettyBoardLabel(lbBoardKey)}`);
      lines.push(`Baseline captured: ${fmtTime(lbBaselineAt)}`);
      lines.push(`Scan captured: ${fmtTime(lbLastScanAt)}`);
      if (group.deltaMin === group.deltaMax){
        lines.push(`Delta: +${group.deltaMax}${tol}`);
      }else{
        lines.push(`Delta range: +${group.deltaMin} .. +${group.deltaMax}${tol}`);
      }
      lines.push(`Players: ${(group.players||[]).length}`);
      const cs = getClanStats(group.players||[]);
      lines.push(`Distinct clans: ${cs.clanCount}${cs.clans.length ? ` (${cs.clans.join(", ")})` : ""}`);
      lines.push("");
      for (const p of (group.players||[])){
        lines.push(`${p.name}\t${p.before} → ${p.after}\tΔ +${p.delta}\t${p.clanName || "—"}`);
      }
    }

    const text = lines.join("\n");

    // Prefer clipboard; fall back to saveTextFile if clipboard is blocked
    try{
      await navigator.clipboard.writeText(text);
      showToast("Copied evidence to clipboard");
      return;
    }catch{}

    try{
      await api.saveTextFile(`idleclans-evidence-${kind.toLowerCase()}-${Date.now()}.txt`, text);
      showToast("Saved evidence as text file");
    }catch{
      showToast("Could not copy/save evidence");
    }
  }

  function buildLeaderboardEvidenceText({ includePlayers=false } = {}){
    const lines = [];
    const nowIso = new Date().toISOString();
    const boardLabel = prettyBoardLabel(lbBoardKey);
    const baseId = lbBaselineSnapshotId ? `#${lbBaselineSnapshotId}` : "(unset)";
    const compareId = lbLatestMeta?.compareSnapshotId ? `#${lbLatestMeta.compareSnapshotId}` : (lbCompareSnapshotId ? `#${lbCompareSnapshotId}` : "(unset)");
    const tol = lbToleranceOn ? `±${clampInt(lbTolerance,0,999,1)}` : "exact";

    lines.push(`Idle Clans Sentinel — Leaderboard correlation evidence`);
    lines.push(`Exported: ${fmtTime(nowIso)} (${nowIso})`);
    lines.push(`Leaderboard: ${boardLabel}`);
    lines.push(`Baseline snapshot: ${baseId}${lbBaselineAt ? ` · ${fmtTime(lbBaselineAt)}` : ""}`);
    lines.push(`Compare snapshot: ${compareId}${lbLatestMeta?.compareCreatedAt ? ` · ${fmtTime(lbLatestMeta.compareCreatedAt)}` : (lbLastScanAt ? ` · ${fmtTime(lbLastScanAt)}` : "")}`);
    const baseRows = lbLatestMeta?.baselineCount ?? (lbBaselineMeta?.rows ?? (lbBaselineMap ? Object.keys(lbBaselineMap).length : 0));
    const nowRows = lbLatestMeta?.rowsNow ?? null;
    if (nowRows !== null){
      lines.push(`Scan scope: ${Number(nowRows||0).toLocaleString()} rows (baseline ${Number(baseRows||0).toLocaleString()} rows)`);
    }
    lines.push(`Grouping: ${tol} · minDelta ${Number(lbMinDelta||0)} · minGroup ${Number(lbMinGroupSize||2)}`);
    lines.push("");

    const groups = lbGroups || [];
    lines.push(`Groups: ${groups.length}`);

    for (const g of groups){
      const isRange = g.deltaMin !== g.deltaMax;
      const deltaLabel = isRange ? `Δ +${g.deltaMin}..+${g.deltaMax}` : `Δ +${g.deltaMax}`;
      const cs = getClanStats(g.players||[]);
      lines.push("");
      lines.push(`${deltaLabel} — ${(g.players||[]).length} players — ${cs.clanCount} clans`);
      if (includePlayers){
        for (const p of (g.players||[])){
          lines.push(`- ${p.name} (${p.clanName || "—"})  ${p.before} → ${p.after}  Δ +${p.delta}`);
        }
      }
    }

    return lines.join("\n");
  }

  async function copyLeaderboardEvidence({ includePlayers=false } = {}){
    const text = buildLeaderboardEvidenceText({ includePlayers });
    try{
      await navigator.clipboard.writeText(text);
      showToast(includePlayers ? "Copied full evidence" : "Copied evidence summary");
      return;
    }catch{}
    try{
      await api.saveTextFile(
        `idleclans-evidence-leaderboard-${includePlayers ? "full" : "summary"}-${Date.now()}.txt`,
        text
      );
      showToast("Saved evidence as text file");
    }catch{
      showToast("Could not copy/save evidence");
    }
  }

  async function exportLeaderboardEvidenceJson(){
    const payload = {
      kind: "leaderboard_correlation",
      exportedAt: new Date().toISOString(),
      boardKey: lbBoardKey,
      boardLabel: prettyBoardLabel(lbBoardKey),
      baselineSnapshotId: lbBaselineSnapshotId,
      baselineCreatedAt: lbBaselineAt,
      compareSnapshotId: lbLatestMeta?.compareSnapshotId || lbCompareSnapshotId,
      compareCreatedAt: lbLatestMeta?.compareCreatedAt || lbLastScanAt,
      scope: {
        baselineRows: lbLatestMeta?.baselineCount ?? (lbBaselineMeta?.rows ?? (lbBaselineMap ? Object.keys(lbBaselineMap).length : 0)),
        compareRows: lbLatestMeta?.rowsNow ?? null,
        matchedPlayers: lbLatestMeta?.matchedPlayers ?? null,
        missingFromLatest: lbLatestMeta?.missingFromNow ?? null,
        newInLatest: lbLatestMeta?.newInNow ?? null,
      },
      params: {
        minGroupSize: Number(lbMinGroupSize||2),
        minDelta: Number(lbMinDelta||0),
        toleranceOn: !!lbToleranceOn,
        tolerance: clampInt(lbTolerance,0,999,1),
        sort: lbSort,
      },
      groups: (lbGroups||[]).map(g=>({
        key: g.key,
        deltaMin: g.deltaMin,
        deltaMax: g.deltaMax,
        players: (g.players||[]).map(p=>({
          name: p.name,
          nameLower: p.nameLower,
          before: p.before,
          after: p.after,
          delta: p.delta,
          clanName: p.clanName || null,
        }))
      }))
    };
    try{
      await api.saveTextFile(`idleclans-evidence-leaderboard-${Date.now()}.json`, JSON.stringify(payload, null, 2));
      showToast("Exported evidence JSON");
    }catch{
      showToast("Could not export JSON");
    }
  }

  // -------------------------------
  // PvM correlation load + transform
  // -------------------------------
  async function runPvm(){
    setLoading(true);
    try{
      const common = {
        minGroupSize: Number(pvmMinGroupSize||2),
        minDelta: Number(pvmMinDelta||1),
        bossKey: bossKey.trim() || null,
        trackedOnly: !!trackedOnly
      };
      const r = windowKind === "rolling"
        ? await api.getPvmCorrelationRolling({
            ...common,
            hours: Number(rollingHours||1),
            endIso: (rollingEndNow ? null : localDatetimeToIso(rollingEndLocal))
          })
        : await api.getPvmCorrelation({
            ...common,
            days: Number(days||7),
            endDayKey: (dailyEndDate ? dailyEndDate : null)
          });
      setResult(r);
    }catch(err){
      console.error("Failed to load PvM correlation", err);
      setResult({ ok:false, error: String(err?.message || err) });
    } finally {
      setLoading(false);
    }
  }

  async function verifyWithLeaderboard(group){
    try{
      const groupKey = pvmGroupKey(group);
      setVerifyByGroupKey(prev=>({ ...prev, [groupKey]: { loading:true } }));
      const playerNames = (group.players||[]).map(p=>p.playerName).filter(Boolean);
      const res = await api.verifyPvmGroupLeaderboard({
        bossKey: group.bossKey,
        gameMode: group.gameMode || "default",
        expectedDelta: group.delta,
        playerNames
      });
      setVerifyByGroupKey(prev=>({ ...prev, [groupKey]: { loading:false, ...res } }));
    }catch(err){
      const groupKey = pvmGroupKey(group);
      setVerifyByGroupKey(prev=>({ ...prev, [groupKey]: { loading:false, ok:false, error: String(err?.message || err) } }));
    }
  }

  useEffect(()=>{ runPvm(); }, []); // initial
  useEffect(()=>{ refreshLbBoards(); }, []);

  // Restore per-board snapshot selections and load baseline map from DB
  useEffect(()=>{
    let cancelled = false;
    (async()=>{
      if (!lbBoardKey) return;
      // Load scheduled watch settings for this board (if any)
      try{ await loadLeaderboardWatchForBoard(lbBoardKey); }catch{}
      try{
        // Always refresh snapshot list + total when switching boards.
        const snaps = await reloadLeaderboardSnapshots(lbSnapshotLimit);
        if (cancelled) return;

        const savedSel = readPersistedLbSnapshotSelection(lbBoardKey);
        const baseId = savedSel?.baselineSnapshotId ? Number(savedSel.baselineSnapshotId) : null;
        const cmpId = savedSel?.compareSnapshotId ? Number(savedSel.compareSnapshotId) : null;
        if (baseId && Number.isFinite(baseId)) setLbBaselineSnapshotId(baseId); else setLbBaselineSnapshotId(null);
        if (cmpId && Number.isFinite(cmpId)) setLbCompareSnapshotId(cmpId); else setLbCompareSnapshotId(null);

        if (baseId && Number.isFinite(baseId)){
          await loadLeaderboardBaselineFromSnapshot(baseId);
        }else{
          setLbBaselineMap(null);
          setLbBaselineAt(null);
          setLbBaselineMeta(null);
        }
      }catch{
        if (cancelled) return;
        setLbSnapshots([]);
        setLbSnapshotsTotal(null);
      }

      if (cancelled) return;
      setLbGroups([]);
      setLbLastScanAt(null);
      setLbLatestMeta(null);
      setLbExpanded({});
      setLbSelectedSnapshotId(null);
    })();
    return ()=>{ cancelled = true; };
  }, [lbBoardKey]);

  const lbWatchComputedStatus = useMemo(()=>{
    const w = lbWatch;
    if (!w) return "—";
    const enabled = !!w.enabled;
    if (!enabled) return w.lastStatus || "disabled";

    const nowMs = lbWatchTick.now ? Date.parse(lbWatchTick.now) : Date.now();
    const nextMs = w.nextRunAt ? Date.parse(w.nextRunAt) : NaN;
    const dueMs = Number.isFinite(nextMs) ? (nextMs - nowMs) : NaN;

    if (lbWatchTick.scanBusy && Number.isFinite(dueMs) && dueMs <= 0){
      return "blocked (scan running)";
    }
    if (Number.isFinite(dueMs)){
      return `due in ${fmtDueMs(dueMs)}`;
    }
    if (w.lastStatus) return w.lastStatus;
    if (!w.lastRunAt) return "queued";
    return "—";
  }, [lbWatch, lbWatchTick]);

  // Listen for leaderboard scan progress and surface it in UI
  useEffect(()=>{
    const off = onLeaderboardScanProgress((p)=>{
      try{
        setLbProgress(prev=>({ ...(prev||{}), ...p, status: p?.status || prev?.status || "running", receivedAt: new Date().toISOString() }));
      }catch{}
    });
    return () => { try{ off && off(); }catch{} };
  }, []);

  // Listen for background watch runs (saved snapshots, errors, etc.)
  useEffect(()=>{
    const off = onLeaderboardWatchStatus((p)=>{
      try{
        if (!p) return;
        setLbWatchStatus(p);
        if (p.boardKey && p.boardKey === lbBoardKey){
          // Refresh snapshots + watch row when our current board ran.
          reloadLeaderboardSnapshots(lbSnapshotLimit).catch(()=>{});
          loadLeaderboardWatchForBoard(lbBoardKey).catch(()=>{});
        }
      }catch{}
    });
    return () => { try{ off && off(); }catch{} };
  }, [lbBoardKey]);

  // Lightweight periodic tick from main process (shows due/blocked status even before the first run).
  useEffect(()=>{
    const off = onLeaderboardWatchTick((payload)=>{
      try{
        if (!payload) return;
        setLbWatchTick({ now: payload.now || null, scanBusy: !!payload.scanBusy });
        // Keep the currently-selected board's watch row fresh without extra IPC calls.
        if (lbBoardKey && Array.isArray(payload.watches)){
          const w = payload.watches.find(x=>x?.boardKey===lbBoardKey);
          if (w) setLbWatch(w);
        }
      }catch{}
    });
    return () => { try{ off && off(); }catch{} };
  }, [lbBoardKey]);

  // Normalize/prepare PvM groups
  const pvmGroupsRaw = useMemo(()=>{
    const arr = Array.isArray(result?.groups) ? result.groups : [];
    return arr.map(g=>({
      ...g,
      players: Array.isArray(g.players) ? g.players.map(p=>({
        playerName: p.playerName ?? p.name,
        clanName: p.clanName ?? null,
        before: p.before,
        after: p.after,
        beforeTakenAt: p.beforeTakenAt,
        afterTakenAt: p.afterTakenAt,
      })) : []
    }));
  }, [result]);

  const pvmPlayersSet = useMemo(()=>{
    const s = String(pvmPlayersCsv||"").trim();
    if (!s) return null;
    const set = new Set();
    for (const part of s.split(",")){
      const n = part.trim();
      if (!n) continue;
      set.add(n.toLowerCase());
    }
    return set.size ? set : null;
  }, [pvmPlayersCsv]);

  function pvmGroupKey(g){
    return `${g.dayKey||""}|${g.gameMode||""}|${g.bossKey||""}|${g.delta||""}|${g.window?.kind||""}`;
  }

  function pvmBaseKeyNoDelta(g){
    return `${g.dayKey||""}|${g.gameMode||""}|${g.bossKey||""}|${g.window?.kind||""}`;
  }

  const pvmGroups = useMemo(()=>{
    let arr = [...pvmGroupsRaw];

    // Optional investigator filter: only keep listed players within each group.
    // This is used by the leaderboard → PvM "Check PvM" cross-link.
    if (pvmPlayersSet){
      arr = arr
        .map(g=>({
          ...g,
          players: (g.players||[]).filter(p=> pvmPlayersSet.has(String(p.playerName||"").toLowerCase()))
        }))
        .filter(g=> (g.players||[]).length >= 2);
    }

    // Optional tolerance: merge groups that share the same window/boss/mode and have deltas within ±tol.
    if (pvmToleranceOn){
      const tol = clampInt(pvmTolerance, 0, 999, 1);
      const byBase = new Map();
      for (const g of arr){
        const k = pvmBaseKeyNoDelta(g);
        if (!byBase.has(k)) byBase.set(k, []);
        byBase.get(k).push(g);
      }

      const merged = [];
      for (const [k, list] of byBase.entries()){
        const sorted = [...list].sort((a,b)=>a.delta - b.delta);
        let cur = null;
        for (const g of sorted){
          if (!cur){
            cur = { ...g, deltaMin:g.delta, deltaMax:g.delta, _merged:[g] };
            continue;
          }
          if (Math.abs(g.delta - cur.deltaMax) <= tol){
            cur.deltaMax = Math.max(cur.deltaMax, g.delta);
            cur.deltaMin = Math.min(cur.deltaMin, g.delta);
            cur.players = [...cur.players, ...(g.players||[])];
            cur._merged.push(g);
          }else{
            merged.push(cur);
            cur = { ...g, deltaMin:g.delta, deltaMax:g.delta, _merged:[g] };
          }
        }
        if (cur) merged.push(cur);
      }

      // De-dup players inside merged groups
      arr = merged.map(g=>{
        const seen = new Set();
        const players = [];
        for (const p of (g.players||[])){
          const key = (p.playerName||"").toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          players.push(p);
        }
        return { ...g, delta: g.deltaMax, deltaMin: g.deltaMin, deltaMax: g.deltaMax, players };
      });
    }

    // Filter min group size again after potential merge
    const mgs = Number(pvmMinGroupSize||2);
    arr = arr.filter(g=> (g.players?.length||0) >= mgs);

    // Sort
    if (pvmSort === "size"){
      arr.sort((a,b)=> (b.players.length - a.players.length) || ((b.deltaMax ?? b.delta) - (a.deltaMax ?? a.delta)));
    }else{
      arr.sort((a,b)=> ((b.deltaMax ?? b.delta) - (a.deltaMax ?? a.delta)) || (b.players.length - a.players.length));
    }

    return arr;
  }, [pvmGroupsRaw, pvmToleranceOn, pvmTolerance, pvmMinGroupSize, pvmSort]);

  function togglePvmExpanded(key){
    setPvmExpanded(prev=>({ ...(prev||{}), [key]: !prev?.[key] }));
  }

  function toggleLbExpanded(key){
    setLbExpanded(prev=>({ ...(prev||{}), [key]: !prev?.[key] }));
  }

  function pvmWindowSummary(){
    if (windowKind === "rolling"){
      const endIso = rollingEndNow ? new Date().toISOString() : localDatetimeToIso(rollingEndLocal);
      const endLabel = rollingEndNow ? "Now" : fmtTime(endIso);
      return `Rolling ${rollingHours}h ending ${endLabel} (local)`;
    }
    return `Daily ${days}d ending ${dailyEndDate ? dailyEndDate : "today"} (local)`;
  }

  function renderWindowMetaStrip(){
    const meta = result?.meta;
    if (!meta) return null;

    const left = windowKind === "rolling"
      ? `Baseline samples: ${Number(meta.withBaseline||0).toLocaleString()} / ${Number(meta.players||0).toLocaleString()}`
      : `Players w/ ≥2 snapshots: ${Number(meta.withBaseline||0).toLocaleString()} / ${Number(meta.players||0).toLocaleString()}`;

    return (
      <div className="summaryStrip">
        <div className="summaryLeft">
          <span className="tag">{pvmWindowSummary()}</span>
          <span className="small" style={{opacity:0.85}}>{left}</span>
        </div>
        <div className="summaryRight">
          <span className="small" style={{opacity:0.85}}>Groups: {pvmGroups.length}</span>
        </div>
      </div>
    );
  }

  async function copySingleLeaderboardGroup(g){
    await copyEvidence("Leaderboard", g, { toleranceOn: lbToleranceOn, tolerance: clampInt(lbTolerance,0,999,1) });
  }

  // ── small helpers for the clean UI ──────────────────────────────────────────
  // ── PvM Tab ───────────────────────────────────────────────────────────────
  function renderPvmTab(){
    const meta = result?.meta;
    const windowSummary = windowKind === "rolling"
      ? `Rolling ${rollingHours}h${rollingEndNow ? " · ends now" : ""}`
      : `Daily · ${days}d`;

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

        {/* ── Controls card ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="cardHeader" style={{ justifyContent:"space-between" }}>
            <div className="cardTitle">PvM Correlation</div>
            <div style={{ fontSize:12, opacity:0.45 }}>Find players who gained the same kill delta in the same window</div>
          </div>
          <div className="cardBody">

            {/* Row 1: Window type + params */}
            <FilterCard>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end" }}>

                <div>
                  <FieldLabel title="Daily uses 1 snapshot/day; Rolling uses frequent samples.">Window type</FieldLabel>
                  <div style={{ display:"flex", gap:4 }}>
                    {[["daily","Daily"],["rolling","Rolling"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setWindowKind(v)} style={{
                        padding:"5px 12px", border:"none", cursor:"pointer", borderRadius:7, fontSize:13, fontWeight:600,
                        background: windowKind===v ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.07)",
                        color: windowKind===v ? "#fff" : "rgba(255,255,255,0.6)",
                      }}>{l}</button>
                    ))}
                  </div>
                </div>

                {windowKind === "daily" ? (
                  <>
                    <div>
                      <FieldLabel>Days</FieldLabel>
                      <input className="input" type="number" min="1" max="60" value={days}
                        onChange={e=>setDays(e.target.value)} style={{width:80}} />
                    </div>
                    <div>
                      <FieldLabel>End date</FieldLabel>
                      <input className="input" type="date" value={dailyEndDate}
                        onChange={e=>setDailyEndDate(e.target.value)} style={{width:160}} />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <FieldLabel title="How far back to look from the end point">Window size</FieldLabel>
                      <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                        {[[0.1667,"10m"],[0.5,"30m"],[1,"1h"],[6,"6h"],[12,"12h"],[24,"24h"]].map(([v,l])=>(
                          <button key={v} onClick={()=>setRollingHours(v)} style={{
                            padding:"5px 10px", border:"none", cursor:"pointer", borderRadius:7, fontSize:12, fontWeight:600,
                            background: Number(rollingHours)===Number(v) ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.07)",
                            color: Number(rollingHours)===Number(v) ? "#fff" : "rgba(255,255,255,0.6)",
                          }}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <FieldLabel>End point</FieldLabel>
                      <div style={{ display:"flex", borderRadius:8, overflow:"hidden", border:"1px solid rgba(255,255,255,0.1)" }}>
                        {[["now","Now (live)"],["custom","Pick time"]].map(([v,l])=>(
                          <button key={v} onClick={()=>setRollingEndNow(v==="now")} style={{
                            padding:"6px 14px", border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                            background: (v==="now")===rollingEndNow ? "rgba(var(--info-rgb),0.18)" : "transparent",
                            color: (v==="now")===rollingEndNow ? "var(--info)" : "rgba(255,255,255,0.45)",
                            borderRight: v==="now" ? "1px solid rgba(255,255,255,0.1)" : "none",
                          }}>{l}</button>
                        ))}
                      </div>
                      {!rollingEndNow && (
                        <input className="input" type="datetime-local" value={rollingEndLocal}
                          onChange={e=>setRollingEndLocal(e.target.value)}
                          style={{ marginTop:6, width:210 }} />
                      )}
                    </div>
                  </>
                )}

                <div>
                  <FieldLabel>Boss</FieldLabel>
                  <BossKeyPicker value={bossKey} onChange={setBossKey} />
                </div>
              </div>
            </FilterCard>

            {/* Row 2: Filters */}
            <FilterCard>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end" }}>
                <div>
                  <FieldLabel title="Minimum players in a group to show it">Min group size</FieldLabel>
                  <input className="input" type="number" min="2" max="50" value={pvmMinGroupSize}
                    onChange={e=>setPvmMinGroupSize(e.target.value)} style={{width:80}} />
                </div>
                <div>
                  <FieldLabel title="Ignore deltas smaller than this">Min delta</FieldLabel>
                  <input className="input" type="number" min="1" value={pvmMinDelta}
                    onChange={e=>setPvmMinDelta(e.target.value)} style={{width:80}} />
                </div>
                <div>
                  <FieldLabel title="Only show these players (comma-separated)">Player filter</FieldLabel>
                  <input className="input" placeholder="Player1, Player2…" value={pvmPlayersCsv}
                    onChange={e=>setPvmPlayersCsv(e.target.value)} style={{width:220}} />
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}
                    title="Only considers players you are tracking/flagging">
                    <input type="checkbox" checked={trackedOnly} onChange={e=>setTrackedOnly(e.target.checked)} />
                    Flagged only
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}
                    title="Merge groups with deltas within ±N of each other">
                    <input type="checkbox" checked={pvmToleranceOn} onChange={e=>setPvmToleranceOn(e.target.checked)} />
                    Tolerance ±
                    <input className="input" type="number" min="0" value={pvmTolerance}
                      disabled={!pvmToleranceOn} onChange={e=>setPvmTolerance(e.target.value)} style={{width:60}} />
                  </label>
                </div>
                <div>
                  <FieldLabel>Sort</FieldLabel>
                  <select className="select" value={pvmSort} onChange={e=>setPvmSort(e.target.value)} style={{width:150}}>
                    <option value="delta">Largest delta</option>
                    <option value="size">Most players</option>
                  </select>
                </div>
              </div>
            </FilterCard>

            {/* Actions */}
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginTop:4 }}>
              <button className="btn btnPrimary" onClick={runPvm} disabled={loading}>
                {loading ? "Loading…" : "Run correlation"}
              </button>
              {pvmGroups.length > 0 && (
                <>
                  <button className="btn" style={{fontSize:12}} onClick={()=>{ const n={}; for(const g of pvmGroups) n[pvmGroupKey(g)]=true; setPvmExpanded(n); }}>
                    Expand all
                  </button>
                  <button className="btn" style={{fontSize:12}} onClick={()=>setPvmExpanded({})}>Collapse all</button>
                </>
              )}
              {meta && (
                <InfoStrip>
                  <span>{windowSummary}</span>
                  <span>·</span>
                  <span>{Number(meta.withBaseline||0).toLocaleString()} / {Number(meta.players||0).toLocaleString()} players with baseline</span>
                  <span>·</span>
                  <span><b style={{color:"rgba(255,255,255,0.8)"}}>{pvmGroups.length}</b> groups</span>
                </InfoStrip>
              )}
            </div>
          </div>
        </div>

        {/* ── Results ───────────────────────────────────────────────────── */}
        {result?.ok === false && (
          <div style={{ padding:"10px 14px", borderRadius:8, background:"rgba(var(--danger-rgb),0.1)", border:"1px solid rgba(var(--danger-rgb),0.25)", color:"var(--danger)", fontSize:13 }}>
            {String(result.error||"unknown error")}
          </div>
        )}

        {result?.ok !== false && pvmGroups.length === 0 && !loading && (
          <div style={{ opacity:0.4, textAlign:"center", padding:24, fontSize:13 }}>
            No matching groups in the selected window.
          </div>
        )}

        {pvmGroups.map((g, idx)=>{
          const groupKey = pvmGroupKey(g);
          const expanded = (pvmExpanded[groupKey] !== undefined) ? !!pvmExpanded[groupKey] : (idx < 2);
          const verifying = !!verifyByGroupKey[groupKey]?.loading;
          const cs = getClanStats(g.players||[]);
          const crossClan = cs.clanCount >= 2;
          const deltaMin = g.deltaMin ?? g.delta;
          const deltaMax = g.deltaMax ?? g.delta;
          const isRange = deltaMin !== deltaMax;
          const headerDelta = isRange
            ? `Δ ${deltaMin>=0?"+":""}${deltaMin}..${deltaMax>=0?"+":""}${deltaMax}`
            : `Δ ${g.delta>=0?"+":""}${g.delta}`;
          const vr = verifyByGroupKey[groupKey];

          return (
            <div key={groupKey+"|"+idx} style={{
              background: crossClan ? "rgba(var(--warning-rgb),0.05)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${crossClan ? "rgba(var(--warning-rgb),0.25)" : "rgba(255,255,255,0.07)"}`,
              borderRadius:10, overflow:"hidden",
            }}>
              {/* Group header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"10px 14px", cursor:"pointer" }}
                onClick={()=>togglePvmExpanded(groupKey)}>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ fontSize:13, opacity:0.4 }}>{expanded ? "▾" : "▸"}</span>
                  <span style={{ fontWeight:800, fontSize:14 }}>
                    {g.window?.kind==="rolling"
                      ? `${g.gameMode} · ${g.bossKey}`
                      : `${g.dayKey} · ${g.gameMode} · ${g.bossKey}`}
                  </span>
                  <span style={{ fontWeight:700, fontSize:13, color:"var(--info)" }}>{headerDelta}</span>
                  <span style={{
                    fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6,
                    background: crossClan ? "rgba(var(--warning-rgb),0.15)" : "rgba(255,255,255,0.07)",
                    color: crossClan ? "var(--warning)" : "rgba(255,255,255,0.6)",
                  }}>
                    {cs.clanCount} clan{cs.clanCount!==1?"s":""}
                  </span>
                  <span style={{ fontSize:11, opacity:0.5 }}>
                    {g.players?.length||0} players
                    {g.window?.kind==="rolling"
                      ? ` · ${fmtClock(g.window.cutoffIso)} → ${fmtClock(g.window.latestIso)}`
                      : ""}
                  </span>
                </div>
                <div style={{ display:"flex", gap:6, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                  <button className="btn" style={{fontSize:12,padding:"4px 10px"}}
                    onClick={()=>copyEvidence("PvM",g,{leaderboardVerification:vr?.ok?vr:null})}>
                    Copy evidence
                  </button>
                  <button className="btn" style={{fontSize:12,padding:"4px 10px"}} disabled={verifying}
                    onClick={()=>verifyWithLeaderboard(g)}>
                    {verifying?"Verifying…":"Verify LB"}
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expanded && (
                <div style={{ padding:"0 14px 12px", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
                  {vr && !vr.loading && vr.ok && (
                    <div style={{ fontSize:12, opacity:0.7, padding:"6px 0" }}>
                      <b>Leaderboard check</b> ({vr.category||"—"}) · {fmtTime(vr.baselineCapturedAt)} → {fmtTime(vr.latestCapturedAt)}
                      {vr.note && <span> · {vr.note}</span>}
                    </div>
                  )}
                  {vr && !vr.loading && vr.ok===false && (
                    <div style={{ fontSize:12, color:"var(--danger)", padding:"6px 0" }}>Verification failed: {String(vr.error||"")}</div>
                  )}
                  <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:6 }}>
                    {(g.players||[]).map(p=>(
                      <div key={(p.playerName||"")+"|"+(p.clanName||"")} style={{ display:"flex", justifyContent:"space-between", gap:12, fontSize:13, padding:"3px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                        <div style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                          <a className="link" href={`/#/players/${encodeURIComponent(p.playerName)}`} style={{fontWeight:600}}>{p.playerName}</a>
                          <span style={{ opacity:0.6, fontSize:12 }}>
                            {Number.isFinite(p.before)&&Number.isFinite(p.after)?`${p.before} → ${p.after}`:""}
                            {p.beforeTakenAt&&p.afterTakenAt && <span style={{opacity:0.6}}> · {fmtTime(p.beforeTakenAt)} → {fmtTime(p.afterTakenAt)}</span>}
                          </span>
                        </div>
                        <span style={{ fontSize:12, opacity:0.6, flexShrink:0 }}>{p.clanName||"—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {copyToast && <div className="toast">{copyToast.msg}</div>}
      </div>
    );
  }

  // ── Leaderboard Tab ───────────────────────────────────────────────────────
  function renderLeaderboardTab(){
    const hasResults = lbGroups.length > 0;
    const canSave = !!(lbRun?.baselineRows?.length && lbRun?.compareRows?.length);
    const baseAt = lbLatestMeta?.baselineAt || lbRun?.baselineAt || lbBaselineAt || null;
    const cmpAt  = lbLatestMeta?.compareAt  || lbRun?.compareAt  || lbLastScanAt  || null;

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

        {/* ── Controls card ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="cardHeader" style={{ justifyContent:"space-between" }}>
            <div className="cardTitle">Leaderboard Correlation</div>
            <div style={{ fontSize:12, opacity:0.45 }}>Baseline → rescan → group identical increases</div>
          </div>
          <div className="cardBody">

            {/* Board selector + primary action */}
            <div style={{ display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap", marginBottom:12 }}>
              <div style={{ flex:1, minWidth:240 }}>
                <FieldLabel>Leaderboard</FieldLabel>
                <select className="select" value={lbBoardKey} onChange={e=>setLbBoardKey(e.target.value)} style={{width:"100%"}}>
                  {lbBoards.map(b=>(
                    <option key={b.boardKey} value={b.boardKey}>{prettyBoardLabel(b.boardKey)}</option>
                  ))}
                </select>
              </div>
              <button className="btn btnPrimary" disabled={!lbBoardKey||lbLoading} onClick={quickScanAndCorrelate}>
                {lbLoading ? "Scanning…" : "Scan & correlate"}
              </button>
              <button className="btn" disabled={!canSave||lbLoading} onClick={saveCurrentRunAsSnapshots}
                title="Save baseline + compare datasets as DB snapshots for repeatability">
                Save run
              </button>
              {lbSavedRunSnapshotIds && (
                <span style={{ fontSize:12, opacity:0.55 }}>Saved #{lbSavedRunSnapshotIds.baselineSnapshotId} / #{lbSavedRunSnapshotIds.compareSnapshotId}</span>
              )}
            </div>

            {/* Filters row */}
            <FilterCard>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end" }}>
                <div>
                  <FieldLabel>Min group</FieldLabel>
                  <input className="input" type="number" min="2" max="50" value={lbMinGroupSize}
                    onChange={e=>setLbMinGroupSize(e.target.value)} style={{width:80}} />
                </div>
                <div>
                  <FieldLabel>Min delta</FieldLabel>
                  <input className="input" type="number" min="0" value={lbMinDelta}
                    onChange={e=>setLbMinDelta(e.target.value)} style={{width:80}} />
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}>
                    <input type="checkbox" checked={lbToleranceOn} onChange={e=>setLbToleranceOn(e.target.checked)} />
                    Tolerance ±
                    <input className="input" type="number" min="0" value={lbTolerance}
                      disabled={!lbToleranceOn} onChange={e=>setLbTolerance(e.target.value)} style={{width:60}} />
                  </label>
                </div>
                <div>
                  <FieldLabel>Sort</FieldLabel>
                  <select className="select" value={lbSort} onChange={e=>setLbSort(e.target.value)} style={{width:170}}>
                    <option value="suspicious">Most suspicious</option>
                    <option value="delta">Largest delta</option>
                    <option value="size">Most players</option>
                  </select>
                </div>
              </div>
            </FilterCard>

            {/* Progress / status strip */}
            {(lbProgress || baseAt || cmpAt) && (
              <InfoStrip>
                {baseAt && <span>Baseline: {fmtTime(baseAt)}</span>}
                {cmpAt  && <span>Compare: {fmtTime(cmpAt)}</span>}
                {lbLatestMeta?.rowsNow && <span>{Number(lbLatestMeta.rowsNow).toLocaleString()} rows</span>}
                {lbLatestMeta?.matchedPlayers !== undefined && <span>{Number(lbLatestMeta.matchedPlayers).toLocaleString()} matched</span>}
                {hasResults && <span><b style={{color:"rgba(255,255,255,0.8)"}}>{lbGroups.length}</b> groups</span>}
                {lbProgress && <span style={{color:"var(--info)"}}>{String(lbProgress.status||"running")}{lbProgress.page?` · p${lbProgress.page}`:""}</span>}
              </InfoStrip>
            )}
            {lbError && (
              <div style={{ marginTop:8, padding:"8px 12px", borderRadius:8, background:"rgba(var(--danger-rgb),0.1)", border:"1px solid rgba(var(--danger-rgb),0.25)", color:"var(--danger)", fontSize:13 }}>
                {lbError}
              </div>
            )}
          </div>
        </div>

        {/* ── Scheduled watch card ───────────────────────────────────────── */}
        <div className="card">
          <div className="cardHeader">
            <div className="cardTitle">Scheduled Watch</div>
            <div style={{ fontSize:12, opacity:0.45 }}>Recurring rescan of this board in the background</div>
          </div>
          <div className="cardBody">
            <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"flex-end" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={lbWatchEnabled} onChange={e=>setLbWatchEnabled(e.target.checked)} />
                  Enabled
                </label>
              </div>
              <div>
                <FieldLabel>Interval (min)</FieldLabel>
                <input className="input" type="number" min="1" max={24*60} value={lbWatchInterval}
                  onChange={e=>setLbWatchInterval(e.target.value)} style={{width:90}} />
              </div>
              <div>
                <FieldLabel>Save snapshot</FieldLabel>
                <select className="select" value={lbWatchSaveMode} onChange={e=>setLbWatchSaveMode(e.target.value)} style={{width:160}}>
                  <option value="ifChanged">Only if changed</option>
                  <option value="always">Every run</option>
                </select>
              </div>
              <div>
                <FieldLabel>Retain (days)</FieldLabel>
                <input className="input" type="number" min="1" max="3650" value={lbWatchRetentionDays}
                  onChange={e=>setLbWatchRetentionDays(e.target.value)} style={{width:90}} />
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <button className="btn" disabled={!lbBoardKey} onClick={saveLeaderboardWatch}>Save watch</button>
                <button className="btn" disabled={!lbBoardKey} onClick={runWatchNowUi}>Run now</button>
                {lbWatch?.id && (lbWatchEnabled
                  ? <button className="btn" onClick={stopLeaderboardWatchUi}>Stop</button>
                  : <button className="btn" onClick={startLeaderboardWatchUi}>Start</button>
                )}
                {lbWatch?.id && <button className="btn" onClick={deleteLeaderboardWatchUi}>Delete</button>}
              </div>
            </div>

            <InfoStrip>
              <span>Watch: {lbWatch?.id ? `#${lbWatch.id}` : "not created"}</span>
              <span>Last run: {lbWatch?.lastRunAt ? fmtTime(lbWatch.lastRunAt) : "—"}</span>
              <span>Status: {lbWatchComputedStatus||"—"}</span>
              <span>Snapshots: {lbSnapshotsTotal!==null&&lbSnapshotsTotal!==undefined ? Number(lbSnapshotsTotal).toLocaleString() : (lbSnapshots?.length||0).toLocaleString()}</span>
              {lbWatch?.lastError && <span style={{color:"var(--danger)"}}>{String(lbWatch.lastError).slice(0,100)}</span>}
            </InfoStrip>
            {lbWatchStatus?.boardKey===lbBoardKey && lbWatchStatus?.saved && (
              <div style={{ marginTop:6, fontSize:12, color:"var(--success)" }}>Watch saved snapshot #{lbWatchStatus?.snapshot?.id}</div>
            )}
          </div>
        </div>

        {/* ── Advanced: snapshot timeline ────────────────────────────────── */}
        <div className="card">
          <div className="cardHeader" style={{ justifyContent:"space-between", cursor:"pointer" }} onClick={()=>setLbAdvancedOpen(v=>!v)}>
            <div className="cardTitle">Snapshots & Advanced</div>
            <span style={{ fontSize:11, opacity:0.45 }}>{lbAdvancedOpen?"▲":"▼"}</span>
          </div>
          {lbAdvancedOpen && (
            <div className="cardBody">
              {lbSnapshots?.length > 0 && (
                <>
                  {renderLeaderboardSnapshotTimeline()}
                  <div style={{ height:12 }} />
                </>
              )}

              {/* Manual snapshot-to-snapshot */}
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ fontSize:12, opacity:0.6 }}>Manual compare:</span>
                <select className="select" style={{width:220}} value={lbBaselineSnapshotId||""}
                  onChange={e=>{ const v=e.target.value?Number(e.target.value):null; setLbBaselineSnapshotId(v); if(v)loadLeaderboardBaselineFromSnapshot(v); persistLbSnapshotSelection(lbBoardKey,v,lbCompareSnapshotId); }}>
                  <option value="">Baseline — select</option>
                  {lbSnapshots.map(s=><option key={s.id} value={s.id}>#{s.id} · {fmtTime(s.createdAt)}</option>)}
                </select>
                <select className="select" style={{width:220}} value={lbCompareSnapshotId||""}
                  onChange={e=>{ const v=e.target.value?Number(e.target.value):null; setLbCompareSnapshotId(v); persistLbSnapshotSelection(lbBoardKey,lbBaselineSnapshotId,v); }}>
                  <option value="">Compare — select</option>
                  {lbSnapshots.map(s=><option key={s.id} value={s.id}>#{s.id} · {fmtTime(s.createdAt)}</option>)}
                </select>
                <button className="btn" disabled={lbLoading||!lbBaselineSnapshotId||!lbCompareSnapshotId} onClick={correlateLeaderboardSnapshots}>
                  Correlate
                </button>
              </div>

              {/* Manage snapshots */}
              {lbSnapshots?.length > 0 && (
                <div style={{ marginTop:12 }}>
                  <div style={{ fontSize:11, fontWeight:800, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Manage snapshots</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    {lbSnapshots.slice(0,12).map(s=>(
                      <div key={s.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)", fontSize:12 }}>
                        <span style={{ opacity:0.75 }}>#{s.id} · {s.title||"Snapshot"} · {fmtTime(s.createdAt)} · {Number(s.rowCount||0).toLocaleString()} rows</span>
                        <button className="btn" style={{fontSize:11,padding:"2px 8px"}} onClick={()=>deleteSnapshotUi(s.id)}>Delete</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Results ───────────────────────────────────────────────────── */}
        {hasResults && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div style={{ display:"flex", gap:6 }}>
              <button className="btn" style={{fontSize:12}} onClick={()=>{ const n={}; for(const g of lbGroups) n[g.key]=true; setLbExpanded(n); }}>Expand all</button>
              <button className="btn" style={{fontSize:12}} onClick={()=>setLbExpanded({})}>Collapse all</button>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button className="btn" style={{fontSize:12}} onClick={()=>copyLeaderboardEvidence({includePlayers:false})}>Copy summary</button>
              <button className="btn" style={{fontSize:12}} onClick={()=>copyLeaderboardEvidence({includePlayers:true})}>Copy full</button>
              <button className="btn" style={{fontSize:12}} onClick={exportLeaderboardEvidenceJson}>Export JSON</button>
            </div>
          </div>
        )}

        {!hasResults && !lbLoading && (
          <div style={{ opacity:0.4, textAlign:"center", padding:24, fontSize:13 }}>
            No groups yet — click <b>Scan &amp; correlate</b> to begin.
          </div>
        )}

        {lbGroups.map((g, idx)=>{
          const expanded = (lbExpanded[g.key]!==undefined) ? !!lbExpanded[g.key] : (idx<2);
          const cs = getClanStats(g.players||[]);
          const crossClan = cs.clanCount >= 2;
          const isRange = g.deltaMin !== g.deltaMax;
          const titleDelta = isRange ? `Δ ${g.deltaMin}..${g.deltaMax}` : `Δ ${g.deltaMax}`;
          const size = g.players?.length||0;
          const teamLikely = size>=2 && size<=3;

          return (
            <div key={g.key+"|"+idx} style={{
              background: crossClan ? "rgba(var(--warning-rgb),0.05)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${crossClan ? "rgba(var(--warning-rgb),0.25)" : "rgba(255,255,255,0.07)"}`,
              borderRadius:10, overflow:"hidden",
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"10px 14px", cursor:"pointer" }}
                onClick={()=>toggleLbExpanded(g.key)}>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ fontSize:13, opacity:0.4 }}>{expanded?"▾":"▸"}</span>
                  <span style={{ fontWeight:800, fontSize:14 }}>{titleDelta}</span>
                  {teamLikely && (
                    <span style={{ fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:6, background:"rgba(var(--info-rgb),0.15)", color:"var(--info)" }}
                      title="Group of 2–3 — possible boss team">Possible team</span>
                  )}
                  <span style={{
                    fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6,
                    background: crossClan ? "rgba(var(--warning-rgb),0.15)" : "rgba(255,255,255,0.07)",
                    color: crossClan ? "var(--warning)" : "rgba(255,255,255,0.6)",
                  }}>{cs.clanCount} clan{cs.clanCount!==1?"s":""}</span>
                  <span style={{ fontSize:11, opacity:0.5 }}>{size} players</span>
                  {lbToleranceOn && <span style={{ fontSize:11, opacity:0.4 }}>±{clampInt(lbTolerance,0,999,1)}</span>}
                </div>
                <div style={{ display:"flex", gap:6 }} onClick={e=>e.stopPropagation()}>
                  <button className="btn" style={{fontSize:12,padding:"4px 10px"}} onClick={()=>openPvmCorrelationForLeaderboardGroup(g)}>Check PvM</button>
                  <button className="btn" style={{fontSize:12,padding:"4px 10px"}} onClick={()=>copySingleLeaderboardGroup(g)}>Copy</button>
                </div>
              </div>

              {expanded && (
                <div style={{ padding:"0 14px 12px", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:8 }}>
                    {(g.players||[]).map((p,pi)=>{
                      const d = p.delta;
                      const dLabel = d>=0?`+${d}`:String(d);
                      return (
                        <div key={p.nameLower+"|"+pi} style={{ display:"flex", justifyContent:"space-between", gap:12, fontSize:13, padding:"3px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                          <div style={{ display:"flex", gap:10, alignItems:"baseline" }}>
                            <a className="link" href={`#/players/${encodeURIComponent(p.name)}`} style={{fontWeight:600}}>{p.name}</a>
                            <span style={{ opacity:0.6, fontSize:12 }}>{p.before} → {p.after} (<b>Δ {dLabel}</b>)</span>
                          </div>
                          <span style={{ fontSize:12, opacity:0.5, flexShrink:0 }}>{p.clanName||"—"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {copyToast && <div className="toast">{copyToast.msg}</div>}
      </div>
    );
  }

  // ── Main return ───────────────────────────────────────────────────────────
  return (
    <div className="page">
      {/* Tab bar */}
      <div style={{ display:"flex", gap:4, marginBottom:16, borderBottom:"1px solid rgba(255,255,255,0.07)", paddingBottom:12 }}>
        {[["pvm","⚔ PvM Correlation"],["leaderboard","📊 Leaderboard Correlation"]].map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)} style={{
            padding:"6px 16px", border:"none", cursor:"pointer", borderRadius:8, fontSize:13, fontWeight:600,
            background: tab===v ? "var(--accent,#2563eb)" : "transparent",
            color: tab===v ? "#fff" : "rgba(255,255,255,0.5)",
            transition:"all 0.15s",
          }}>{l}</button>
        ))}
      </div>

      {tab==="pvm" ? renderPvmTab() : renderLeaderboardTab()}
      {renderLeaderboardBoardViewer()}
    </div>
  );
}
