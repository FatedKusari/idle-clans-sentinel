import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, onLeaderboardScanProgress } from "../lib/bridge.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SKILLS = [
  "total_level","attack","strength","defence","archery","magic","health",
  "crafting","woodcutting","carpentry","fishing","cooking","mining","smithing",
  "foraging","farming","agility","plundering","enchanting","brewing","exterminating","invocation",
];
const BOSSES = ["zeus","medusa","griffin","hades","chimera","devil","kronos","sobek","mesines"];
const RAIDS  = ["guardians_of_the_citadel","reckoning_of_the_gods","bloodmoon_massacre"];
// Clan boss leaderboards — available for both players (individual
// contribution) and clans (total kills) leaderboards.
const CLAN_BOSSES = ["malignant_spider","skeleton_warrior","otherworldly_golem"];
const GAME_MODES   = ["default","ironman","groupironman"];
const ENTITY_TYPES = ["players","clans","pets"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(s){
  return String(s||"").split(/[_\s]+/g).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
}
function prettyMode(m){
  return m==="default"?"Normal":m==="ironman"?"Ironman":m==="groupironman"?"Group Ironman":titleCase(m);
}
function prettyEntity(t){
  return t==="players"?"Players":t==="clans"?"Clans":t==="pets"?"Pets":titleCase(t);
}
function fmtNum(n){
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : "";
}
function fmtExpCapDate(v){
  const ticks = Number(v||0);
  if (!Number.isFinite(ticks)||ticks<=0) return "—";
  const ms = Math.floor((ticks-621355968000000000)/10000);
  if (!Number.isFinite(ms)||ms<=0) return "—";
  try{ return new Date(ms).toLocaleString(); }catch{ return "—"; }
}

// ── Small reusable pieces ──────────────────────────────────────────────────────

function ScannerSection({ title, children }){
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.07em", textTransform:"uppercase", opacity:0.4, marginBottom:10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SegButton({ active, disabled, onClick, children }){
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding:"5px 12px", border:"none", cursor:disabled?"not-allowed":"pointer",
      borderRadius:7, fontSize:13, fontWeight:600, transition:"background 0.1s",
      background: active ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.07)",
      color:       active ? "#fff"                  : "rgba(255,255,255,0.6)",
      opacity: disabled ? 0.45 : 1,
    }}>{children}</button>
  );
}

function CheckPill({ checked, onChange, disabled, children }){
  return (
    <label style={{ display:"inline-flex", alignItems:"center", gap:7, cursor:disabled?"not-allowed":"pointer",
      padding:"4px 10px", borderRadius:7, fontSize:13, fontWeight:500,
      background: checked ? "rgba(var(--info-rgb),0.15)" : "rgba(255,255,255,0.06)",
      border: checked ? "1px solid rgba(var(--info-rgb),0.35)" : "1px solid rgba(255,255,255,0.1)",
      opacity: disabled ? 0.45 : 1, userSelect:"none",
    }}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} style={{margin:0}} />
      {children}
    </label>
  );
}

// Custom scrollable dropdown for board selection. Replaces a native <select>
// with <optgroup>s — native select popups can be clipped to a fixed height
// in some Electron/Chromium builds, hiding later groups (Bosses/Raids/Clan
// Bosses) entirely behind an unscrollable popup. This version is just an
// absolutely-positioned panel we fully control, so it always scrolls.
function BoardSelect({ value, onChange, disabled, groups }){
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(()=>{
    if (!open) return;
    function onDocClick(e){
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e){ if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return ()=>{
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Find the label for the currently selected value.
  let currentLabel = value;
  for (const g of groups){
    const found = g.options.find(o=>o.value===value);
    if (found){ currentLabel = found.label; break; }
  }

  return (
    <div ref={rootRef} style={{ position:"relative" }}>
      <button type="button" className="select" disabled={disabled}
        onClick={()=>setOpen(o=>!o)}
        style={{
          width:"100%", textAlign:"left", display:"flex",
          alignItems:"center", justifyContent:"space-between", gap:8,
          background:"var(--card2, var(--card))", color:"inherit",
          border:"1px solid var(--border)", cursor: disabled ? "not-allowed" : "pointer",
        }}>
        <span>{currentLabel}</span>
        <span style={{ opacity:0.5, fontSize:11 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, right:0,
          maxHeight:320, overflowY:"auto", zIndex:50,
          background:"var(--card2, var(--card))", border:"1px solid var(--border)",
          borderRadius:10, boxShadow:"0 12px 32px rgba(0,0,0,0.35)", padding:"6px 0",
        }}>
          {groups.map(g => g.options.length > 0 && (
            <div key={g.label}>
              <div style={{
                fontSize:11, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase",
                opacity:0.4, padding:"6px 12px 4px",
              }}>{g.label}</div>
              {g.options.map(o => (
                <div key={o.value}
                  onClick={()=>{ onChange(o.value); setOpen(false); }}
                  style={{
                    padding:"6px 12px", fontSize:13, cursor:"pointer",
                    background: o.value===value ? "rgba(var(--info-rgb),0.15)" : "transparent",
                    fontWeight: o.value===value ? 700 : 400,
                  }}
                  onMouseEnter={e=>{ if(o.value!==value) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
                  onMouseLeave={e=>{ if(o.value!==value) e.currentTarget.style.background="transparent"; }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeaderboardsPage(){
  // ── Board selector state ──────────────────────────────────────────────────
  const [entityType, setEntityType] = useState("players");
  const [gameMode,   setGameMode]   = useState("default");
  const [category,   setCategory]   = useState("total_level");
  const [importMissing, setImportMissing] = useState(true);
  // When enabled, after a board scan completes, every cached name on that
  // board gets a full profile refresh via the same API call used by manual
  // player/clan lookups (skills, equipment, members, etc) — not just the
  // rank/level/score that leaderboard scans return on their own. This is
  // one API call per name, so it can take a long time for large boards.
  const [refreshProfiles, setRefreshProfiles] = useState(false);

  // ── Scanner state ─────────────────────────────────────────────────────────
  const [running,       setRunning]       = useState(false);
  const [scanAllActive, setScanAllActive] = useState(false);
  const [activeJobId,   setActiveJobId]   = useState(null);
  const [jobInfo,       setJobInfo]       = useState(null);
  const [progress,      setProgress]      = useState(null);
  const [error,         setError]         = useState(null);
  const [boardKey,      setBoardKey]      = useState(null);
  const [state,         setState]         = useState(null);
  const [scanStartedAt, setScanStartedAt] = useState(null);
  const [newlyImportedStubs,  setNewlyImportedStubs]  = useState([]);
  const [refreshingStubs,     setRefreshingStubs]     = useState(false);
  const [refreshStubProgress, setRefreshStubProgress] = useState(null);

  // ── Custom scan state ─────────────────────────────────────────────────────
  const [customEntityTypes, setCustomEntityTypes] = useState(["players"]);
  const [customModes,       setCustomModes]       = useState(["default"]);
  const [customBoards,      setCustomBoards]      = useState(["total_level"]);
  const [showCustom,        setShowCustom]        = useState(false);

  // ── Rank limit ("Top N") ──────────────────────────────────────────────────
  // When enabled, scans stop once they've covered the first `rankLimit` ranks
  // instead of walking every page until the API returns empty.
  const [limitRank,    setLimitRank]    = useState(false);
  const [rankLimit,    setRankLimit]    = useState(1000);

  // ── Cache / table state ───────────────────────────────────────────────────
  const [cache,     setCache]     = useState({ rows:[], totalRows:0, lastCapturedAt:null });
  const [pageSize,  setPageSize]  = useState(250);
  const [page,      setPage]      = useState(1);
  const [gotoPage,  setGotoPage]  = useState("1");
  const [nameQuery, setNameQuery] = useState("");
  const [nameQueryDebounced, setNameQueryDebounced] = useState("");

  // ── Derived ───────────────────────────────────────────────────────────────
  const availableCategories = useMemo(()=>{
    if (entityType==="pets") return SKILLS;
    // Both players and clans can have clan-boss leaderboards (e.g. a player's
    // contribution to Malignant Spider kills counts toward their clan's total).
    if (entityType==="clans" || entityType==="players") return [...SKILLS,...BOSSES,...RAIDS,...CLAN_BOSSES];
    return [...SKILLS,...BOSSES,...RAIDS];
  }, [entityType]);

  const customBoardOptions = useMemo(()=>{
    const types = new Set(customEntityTypes);
    if (types.has("clans") || types.has("players")) return [...SKILLS,...BOSSES,...RAIDS,...CLAN_BOSSES];
    return [...SKILLS];
  }, [customEntityTypes]);

  const totalPages = useMemo(()=>{
    const total = Number(cache?.totalRows||0);
    const size  = Number(pageSize||250);
    if (!total||!size) return 0;
    return Math.max(1, Math.ceil(total/size));
  }, [cache?.totalRows, pageSize]);

  function clampPage(p){ const n=Number(p); return Math.max(1,Math.min(totalPages||1,Number.isFinite(n)?Math.floor(n):1)); }

  const canResume = !!(state&&(state.status==="stopped"||state.status==="running")&&state.nextStartCount&&state.nextMaxCount);
  const lastUpdatedLabel = cache?.lastCapturedAt ? new Date(cache.lastCapturedAt).toLocaleString() : null;

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(()=>{
    if (!availableCategories.includes(category)) setCategory(availableCategories[0]||"total_level");
  }, [availableCategories, category]);

  useEffect(()=>{
    setCustomBoards(prev=>{
      const next=(Array.isArray(prev)?prev:[]).filter(b=>customBoardOptions.includes(b));
      return next.length ? next : (customBoardOptions[0] ? [customBoardOptions[0]] : []);
    });
  }, [customBoardOptions]);

  useEffect(()=>{ setBoardKey(`${entityType}:${gameMode}|${category}`); }, [entityType,gameMode,category]);

  useEffect(()=>{
    const t = setTimeout(()=>setNameQueryDebounced(nameQuery), 200);
    return ()=>clearTimeout(t);
  }, [nameQuery]);

  useEffect(()=>{ setPage(1); setGotoPage("1"); refreshCache(true); }, [nameQueryDebounced]); // eslint-disable-line

  useEffect(()=>{ setPage(1); setGotoPage("1"); refreshCache(true); }, [pageSize]); // eslint-disable-line

  useEffect(()=>{
    if (!totalPages) return;
    if (page>totalPages){ const p=totalPages; setPage(p); setGotoPage(String(p)); setTimeout(()=>refreshCache(false),0); }
  }, [totalPages]); // eslint-disable-line

  useEffect(()=>{
    setError(null); setProgress(null); setRunning(false);
    setPage(1); setGotoPage("1"); setNameQuery(""); setNameQueryDebounced("");
    refreshState(); refreshCache(true);
  }, [boardKey]); // eslint-disable-line

  useEffect(()=>{
    (async()=>{
      try{
        const jobs = await api.listLeaderboardJobs?.({ limit:10 });
        const latest = Array.isArray(jobs) ? jobs.find(j=>j.status==="running"||j.status==="paused"||j.status==="queued") : null;
        if (latest){ setActiveJobId(latest.id); setJobInfo(latest); setScanAllActive(true); }
      }catch{}
    })();
    return onLeaderboardScanProgress?.((p)=>{
      if (!p) return;
      if (p.jobId&&activeJobId&&Number(p.jobId)===Number(activeJobId)){/*ok*/}
      else if (!scanAllActive&&p.boardKey&&boardKey&&p.boardKey!==boardKey) return;
      setProgress(p);
      setRunning(!!p.running);
      if (p.status==="error"&&p.error) setError(p.error);
      if (p.jobId&&activeJobId&&Number(p.jobId)===Number(activeJobId)){
        if (p.jobStatus){ setJobInfo(prev=>prev?{...prev,status:p.jobStatus,currentLabel:p.currentLabel||prev.currentLabel,currentBoardKey:p.currentBoardKey||prev.currentBoardKey}:prev); }
        if (p.jobStatus==="done"){ setScanAllActive(false); setActiveJobId(null); setJobInfo(null); }
      }
      if (p.status==="completed"||p.status==="stopped"||p.status==="error"||p.status==="allCompleted"||p.status==="paused"){
        if (p.status==="allCompleted"){ setScanAllActive(false); refreshState(); refreshCache(true); return; }
        refreshState(); refreshCache(true);
        if (p.status==="completed") refreshNewlyImportedStubs(scanStartedAt);
      }
      if (p.status==="running"&&(p.page%3===0)) refreshCache(true);
    });
  }, [boardKey, scanStartedAt, entityType, gameMode, importMissing, scanAllActive, activeJobId]); // eslint-disable-line

  // ── API actions ───────────────────────────────────────────────────────────
  async function refreshState(){
    if (!boardKey) return;
    try{ const st=await api.getLeaderboardScanState?.(boardKey); setState(st||null); }catch{}
  }

  async function refreshCache(reset=false){
    if (!boardKey) return;
    try{
      const nextPage = reset ? 1 : page;
      const off = Math.max(0,(nextPage-1)*pageSize);
      const res = await api.getLeaderboardCache?.({ boardKey, limit:pageSize, offset:off, nameQuery:nameQueryDebounced });
      if (reset){ setPage(1); setGotoPage("1"); }
      setCache(res||{ rows:[],totalRows:0,lastCapturedAt:null });
    }catch{}
  }

  async function refreshNewlyImportedStubs(sinceIso){
    if (!sinceIso||!importMissing) return;
    if (entityType!=="players"&&entityType!=="clans"){ setNewlyImportedStubs([]); return; }
    try{
      const names = await api.listLeaderboardImportedStubs?.({ entityType, gameMode, sinceIso, limit:2000 });
      setNewlyImportedStubs(Array.isArray(names)?names:[]);
    }catch{ setNewlyImportedStubs([]); }
  }

  function beginScan(){
    setError(null); setProgress(null); setRunning(true);
    const now = new Date().toISOString();
    setScanStartedAt(now); setNewlyImportedStubs([]); setRefreshStubProgress(null);
  }

  // Returns the active rank limit (positive integer) if the toggle is on
  // and a valid value is set, otherwise null (= no limit).
  function activeRankLimit(){
    if (!limitRank) return null;
    const n = Math.floor(Number(rankLimit));
    return (Number.isFinite(n) && n > 0) ? n : null;
  }

  async function startScan({ resume=false, clearCache=false }={}){
    beginScan();
    const maxRank = activeRankLimit();
    try{
      await api.scanLeaderboardBoard?.({ entityType, gameMode, category, resume, importMissing:!!importMissing, clearCache:!!clearCache, refreshProfiles:!!refreshProfiles, ...(maxRank ? { maxRank } : {}) });
    }catch(e){ setRunning(false); setError(String(e?.message||e)); refreshState(); }
  }

  async function startScanAll(){
    beginScan(); setScanAllActive(true);
    const maxRank = activeRankLimit();
    try{
      const job = await api.startLeaderboardScanAllJob?.({ importMissing:!!importMissing, clearCache:false, refreshProfiles:!!refreshProfiles, ...(maxRank ? { maxRank } : {}) });
      if (job?.id){ setActiveJobId(job.id); setJobInfo(job); }
    }catch(e){ setRunning(false); setScanAllActive(false); setError(String(e?.message||e)); }
  }

  async function startCustomJob(){
    beginScan(); setScanAllActive(true);
    const types  = (Array.isArray(customEntityTypes)?customEntityTypes:[]).filter(Boolean);
    const modes  = (Array.isArray(customModes)?customModes:[]).filter(Boolean);
    const boards = (Array.isArray(customBoards)?customBoards:[]).filter(Boolean);
    const maxRank = activeRankLimit();
    const plan = [];
    for (const t of types) for (const gm of modes) for (const cat of boards){
      if (t==="pets"&&!SKILLS.includes(cat)) continue;
      plan.push({ entityType:t, gameMode:gm, category:cat, ...(maxRank ? { maxRank } : {}) });
    }
    if (!plan.length){ setRunning(false); setScanAllActive(false); setError("Nothing selected."); return; }
    const title = `Custom: ${types.map(prettyEntity).join(",")} • ${modes.map(prettyMode).join(",")} • ${boards.length} boards`
      + (maxRank ? ` • Top ${maxRank.toLocaleString()}` : "")
      + (refreshProfiles ? " • Full refresh" : "");
    try{
      const job = await api.startLeaderboardCustomJob?.({ title, plan, importMissing:!!importMissing, clearCache:false, refreshProfiles:!!refreshProfiles, ...(maxRank ? { maxRank } : {}) });
      if (job?.id){ setActiveJobId(job.id); setJobInfo(job); }
    }catch(e){ setRunning(false); setScanAllActive(false); setError(String(e?.message||e)); }
  }

  async function pauseScanAll(){ if (!activeJobId) return; try{ const j=await api.pauseLeaderboardJob?.(activeJobId); if(j)setJobInfo(j); }catch{} }
  async function resumeScanAll(){ if (!activeJobId) return; try{ const j=await api.resumeLeaderboardJob?.(activeJobId); if(j)setJobInfo(j); }catch(e){ setError(String(e?.message||e)); } }
  async function stopScan(){ try{ await api.cancelLeaderboardScan?.(); }catch{} }

  async function refreshStubProfiles(){
    if (refreshingStubs) return;
    const names = Array.isArray(newlyImportedStubs)?newlyImportedStubs:[];
    if (!names.length) return;
    setRefreshingStubs(true);
    setRefreshStubProgress({ done:0, total:names.length, current:null, errors:0 });
    let errors=0;
    for (let i=0;i<names.length;i++){
      const name=names[i];
      setRefreshStubProgress({ done:i, total:names.length, current:name, errors });
      try{
        if (entityType==="clans") await api.refreshClan?.(name);
        else await api.refreshPlayer?.(name);
      }catch{ errors++; }
    }
    setRefreshStubProgress({ done:names.length, total:names.length, current:null, errors });
    setRefreshingStubs(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const inserted    = Number(progress?.insertedEntities||0);
  const totalFetched= Number(progress?.totalFetched||0);
  const existing    = Math.max(0,totalFetched-inserted);

  const jobStatusLabel = jobInfo?.status ? (
    jobInfo.status==="running"  ? <span style={{color:"var(--success)",fontWeight:700}}>Running</span> :
    jobInfo.status==="paused"   ? <span style={{color:"var(--warning)",fontWeight:700}}>Paused</span>  :
    jobInfo.status==="queued"   ? <span style={{color:"var(--info)",fontWeight:700}}>Queued</span>  :
    <span style={{opacity:0.6}}>{jobInfo.status}</span>
  ) : null;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── SCANNER CARD ────────────────────────────────────────────────── */}
      <div className="card">
        <div className="cardHeader" style={{justifyContent:"space-between"}}>
          <div className="cardTitle">Leaderboard Scanner</div>
          <div style={{fontSize:12, opacity:0.45}}>
            Offline cache · resumable scans · imports names into your DB
          </div>
        </div>

        <div className="cardBody">

          {/* ── Board selector ─────────────────────────────────────────── */}
          <ScannerSection title="Board">
            <div style={{display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end"}}>
              {/* Entity type */}
              <div>
                <div style={{fontSize:11, opacity:0.5, marginBottom:5}}>Type</div>
                <div style={{display:"flex", gap:4}}>
                  {ENTITY_TYPES.map(t=>(
                    <SegButton key={t} active={entityType===t} disabled={running} onClick={()=>setEntityType(t)}>
                      {prettyEntity(t)}
                    </SegButton>
                  ))}
                </div>
              </div>

              {/* Game mode */}
              <div>
                <div style={{fontSize:11, opacity:0.5, marginBottom:5}}>Mode</div>
                <div style={{display:"flex", gap:4}}>
                  {GAME_MODES.map(m=>(
                    <SegButton key={m} active={gameMode===m} disabled={running} onClick={()=>setGameMode(m)}>
                      {prettyMode(m)}
                    </SegButton>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div style={{flex:1, minWidth:180}}>
                <div style={{fontSize:11, opacity:0.5, marginBottom:5}}>
                  Board <span style={{opacity:0.6}}>({availableCategories.length} available)</span>
                </div>
                <BoardSelect
                  value={category}
                  onChange={setCategory}
                  disabled={running}
                  groups={[
                    { label:"Skills",      options: SKILLS.filter(c=>availableCategories.includes(c)).map(c=>({ value:c, label:titleCase(c) })) },
                    { label:"Bosses",      options: BOSSES.filter(c=>availableCategories.includes(c)).map(c=>({ value:c, label:titleCase(c) })) },
                    { label:"Raids",       options: RAIDS.filter(c=>availableCategories.includes(c)).map(c=>({ value:c, label:titleCase(c) })) },
                    { label:"Clan Bosses", options: CLAN_BOSSES.filter(c=>availableCategories.includes(c)).map(c=>({ value:c, label:titleCase(c) })) },
                  ]}
                />
              </div>

              {/* Import missing toggle */}
              <CheckPill checked={importMissing} onChange={e=>setImportMissing(e.target.checked)} disabled={running}>
                Import missing into DB
              </CheckPill>

              {/* Full profile refresh toggle */}
              <CheckPill checked={refreshProfiles} onChange={e=>setRefreshProfiles(e.target.checked)} disabled={running}>
                Refresh full profiles
              </CheckPill>
            </div>

            {/* Board info strip */}
            <div style={{display:"flex", gap:16, marginTop:10, flexWrap:"wrap", fontSize:12, opacity:0.55}}>
              <span><b>Key:</b> {boardKey}</span>
              {lastUpdatedLabel
                ? <span><b>Cached:</b> {lastUpdatedLabel} · {fmtNum(cache.totalRows)} rows</span>
                : <span>Not yet cached</span>
              }
              {state?.status && (
                <span><b>Status:</b> {state.status}
                  {state.nextStartCount ? ` · next ${state.nextStartCount}–${state.nextMaxCount}` : ""}
                  {state.lastError ? ` · ${state.lastError}` : ""}
                </span>
              )}
            </div>
          </ScannerSection>

          {/* ── Scan Builder (primary) ───────────────────────────────────── */}
          <ScannerSection title="Scan">
            <div style={{display:"flex", gap:18, flexWrap:"wrap", alignItems:"flex-start", marginBottom:14}}>
              {/* Types */}
              <div style={{minWidth:160}}>
                <div style={{fontSize:11, opacity:0.5, marginBottom:6}}>Types</div>
                <div style={{display:"flex", flexDirection:"column", gap:5}}>
                  {ENTITY_TYPES.map(t=>(
                    <CheckPill key={t} checked={customEntityTypes.includes(t)} disabled={running}
                      onChange={e=>{
                        const on=e.target.checked;
                        setCustomEntityTypes(prev=>{ const a=Array.isArray(prev)?[...prev]:[]; if(on&&!a.includes(t))a.push(t); const n=on?a:a.filter(x=>x!==t); return n.length?n:["players"]; });
                      }}>
                      {prettyEntity(t)}
                    </CheckPill>
                  ))}
                </div>
              </div>

              {/* Modes */}
              <div style={{minWidth:190}}>
                <div style={{fontSize:11, opacity:0.5, marginBottom:6}}>Modes</div>
                <div style={{display:"flex", flexDirection:"column", gap:5}}>
                  {GAME_MODES.map(m=>(
                    <CheckPill key={m} checked={customModes.includes(m)} disabled={running}
                      onChange={e=>{
                        const on=e.target.checked;
                        setCustomModes(prev=>{ const a=Array.isArray(prev)?[...prev]:[]; if(on&&!a.includes(m))a.push(m); const n=on?a:a.filter(x=>x!==m); return n.length?n:["default"]; });
                      }}>
                      {prettyMode(m)}
                    </CheckPill>
                  ))}
                  <div style={{display:"flex", gap:5, marginTop:2}}>
                    <button className="btn" style={{fontSize:11,padding:"2px 8px"}} disabled={running} onClick={()=>setCustomModes([...GAME_MODES])}>All</button>
                    <button className="btn" style={{fontSize:11,padding:"2px 8px"}} disabled={running} onClick={()=>setCustomModes(["default"])}>Normal only</button>
                  </div>
                </div>
              </div>

              {/* Boards */}
              <div style={{flex:1, minWidth:280}}>
                <div style={{fontSize:11, opacity:0.5, marginBottom:6}}>Boards</div>
                <div style={{maxHeight:190, overflowY:"auto", border:"1px solid rgba(255,255,255,0.07)", borderRadius:8, padding:"8px 10px", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", gap:5}}>
                  {customBoardOptions.map(b=>(
                    <CheckPill key={b} checked={customBoards.includes(b)} disabled={running}
                      onChange={e=>{
                        const on=e.target.checked;
                        setCustomBoards(prev=>{ const a=Array.isArray(prev)?[...prev]:[]; if(on&&!a.includes(b))a.push(b); const n=on?a:a.filter(x=>x!==b); return n.length?n:(customBoardOptions[0]?[customBoardOptions[0]]:["total_level"]); });
                      }}>
                      {titleCase(b)}
                    </CheckPill>
                  ))}
                </div>
                <div style={{display:"flex", gap:5, marginTop:5}}>
                  <button className="btn" style={{fontSize:11,padding:"2px 8px"}} disabled={running} onClick={()=>setCustomBoards([...customBoardOptions])}>All boards</button>
                  <button className="btn" style={{fontSize:11,padding:"2px 8px"}} disabled={running} onClick={()=>setCustomBoards(["total_level"])}>Total level only</button>
                </div>
              </div>
            </div>

            {/* Rank limit ("Top N") ─────────────────────────────────────── */}
            {/* The number field and presets are always editable — the checkbox
               only controls whether the limit is applied when scanning. */}
            <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:10}}>
              <CheckPill checked={limitRank} disabled={running} onChange={e=>setLimitRank(e.target.checked)}>
                Limit to top
              </CheckPill>
              <input
                type="number"
                className="input"
                style={{ width:120 }}
                min={1}
                max={1000000}
                step={1}
                disabled={running}
                value={rankLimit}
                onChange={e=>setRankLimit(e.target.value)}
                onFocus={()=>{ if (!limitRank) setLimitRank(true); }}
              />
              <span style={{fontSize:12, opacity:0.5}}>ranks</span>
              {/* Quick presets — clicking one also enables the limit */}
              <div style={{display:"flex", gap:4}}>
                {[100,500,1000,5000,10000].map(n=>(
                  <button key={n} className="btn" type="button"
                    style={{fontSize:11, padding:"2px 8px"}}
                    disabled={running}
                    onClick={()=>{ setRankLimit(n); setLimitRank(true); }}>
                    {n.toLocaleString()}
                  </button>
                ))}
              </div>
              <span style={{fontSize:12, opacity:0.5}}>
                {limitRank
                  ? `Stops at rank ${Math.max(1, Math.floor(Number(rankLimit)||0)).toLocaleString()}`
                  : "Scans full board until empty"}
              </span>
            </div>

            {/* Long-scan warning — shown for full (unlimited) scans, when the
               rank limit is large enough that a scan could take a while, or
               when full profile refresh is enabled (one API call per name —
               can take a very long time on large boards). */}
            {(!limitRank || (Number(rankLimit)||0) >= 1000 || refreshProfiles) && (
              <div style={{
                display:"flex", alignItems:"center", gap:8, marginBottom:10,
                padding:"6px 12px", borderRadius:8, fontSize:12,
                background:"rgba(var(--warning-rgb),0.10)",
                border:"1px solid rgba(var(--warning-rgb),0.25)",
                color:"var(--warning)",
              }}>
                <span>⚠️</span>
                <span>
                  This may take a while to complete.
                  {refreshProfiles && " Refreshing full profiles makes one extra API call per name on the board, on top of the leaderboard scan itself."}
                </span>
              </div>
            )}

            {/* Launch row */}
            <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.07)"}}>
              <button className="btn btnPrimary" disabled={running} onClick={startCustomJob}>
                Start scan
              </button>
              {running && <button className="btn btnDanger" onClick={stopScan}>Stop</button>}
              {activeJobId && (
                <>
                  <button className="btn" disabled={jobInfo?.status!=="running"} onClick={pauseScanAll}>Pause</button>
                  <button className="btn" disabled={jobInfo?.status!=="paused"&&jobInfo?.status!=="queued"} onClick={resumeScanAll}>Resume</button>
                </>
              )}
              {!running && canResume && (
                <button className="btn" onClick={()=>startScan({resume:true,clearCache:false})}>Resume last board</button>
              )}
              <button className="btn" disabled={running} onClick={async()=>{ await api.clearLeaderboardCache?.(boardKey); await refreshCache(true); }}>
                Clear cache
              </button>
              <span style={{fontSize:12, opacity:0.4, marginLeft:4}}>
                {customEntityTypes.length} type{customEntityTypes.length!==1?"s":""} · {customModes.length} mode{customModes.length!==1?"s":""} · {customBoards.length} board{customBoards.length!==1?"s":""}
              </span>
            </div>
          </ScannerSection>

          {/* ── Progress ────────────────────────────────────────────────── */}
          {(running || progress) && (
            <ScannerSection title="Progress">
              {/* Job status bar */}
              {activeJobId && jobInfo && (
                <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:10, padding:"8px 12px", borderRadius:8, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)"}}>
                  <span style={{fontSize:13}}>Job #{activeJobId}</span>
                  {jobStatusLabel}
                  {jobInfo.currentLabel && <span style={{fontSize:12, opacity:0.6}}>{jobInfo.currentLabel}</span>}
                  {progress?.overallTotal > 0 && (
                    <span style={{marginLeft:"auto", fontSize:12, opacity:0.7}}>
                      {fmtNum(progress.overallDone)} / {fmtNum(progress.overallTotal)} ({fmtNum(progress.overallPct)}%)
                    </span>
                  )}
                </div>
              )}

              {/* Progress bar */}
              {progress?.overallTotal > 0 && (
                <div style={{marginBottom:8}}>
                  <div style={{height:6, background:"rgba(255,255,255,0.1)", borderRadius:999, overflow:"hidden"}}>
                    <div style={{
                      width:`${Math.min(100,(Number(progress.overallPct)||0))}%`,
                      height:"100%", background:"rgba(120,255,190,0.85)",
                      borderRadius:999, transition:"width 0.3s ease",
                    }}/>
                  </div>
                </div>
              )}

              {/* Profile-refresh phase — shown after the leaderboard portion
                 finishes, while refreshProfiles is doing one API call per
                 cached name. Distinct progress bar since it tracks a
                 different total (names on the board, not pages). */}
              {progress?.phase === "refreshing" && (
                <div style={{marginBottom:8}}>
                  <div style={{display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4}}>
                    <span style={{fontWeight:700}}>Refreshing profiles…</span>
                    <span style={{opacity:0.7}}>
                      {fmtNum(progress.current)} / {fmtNum(progress.total)}
                      {progress.name && <> · {progress.name}</>}
                    </span>
                  </div>
                  <div style={{height:6, background:"rgba(255,255,255,0.1)", borderRadius:999, overflow:"hidden"}}>
                    <div style={{
                      width:`${Math.min(100, progress.total ? (progress.current/progress.total)*100 : 0)}%`,
                      height:"100%", background:"rgba(120,190,255,0.85)",
                      borderRadius:999, transition:"width 0.2s ease",
                    }}/>
                  </div>
                  <div style={{display:"flex", gap:16, marginTop:4, fontSize:12, opacity:0.6}}>
                    <span style={{color:"var(--success)"}}>{fmtNum(progress.refreshed)} refreshed</span>
                    {progress.failed > 0 && <span style={{color:"#f87171"}}>{fmtNum(progress.failed)} failed</span>}
                  </div>
                </div>
              )}

              {/* Detail row */}
              {progress && progress.phase !== "refreshing" && (
                <div style={{display:"flex", gap:16, flexWrap:"wrap", fontSize:13}}>
                  <span style={{fontWeight:700}}>
                    {progress.status==="running" ? "Scanning…" : titleCase(progress.status||"done")}
                  </span>
                  {progress.status==="running" && (
                    <>
                      <span style={{opacity:0.6}}>Page {fmtNum(progress.page)} · range {progress.startCount}–{progress.maxCount}</span>
                      <span style={{opacity:0.6}}>Fetched {fmtNum(progress.totalFetched)}</span>
                    </>
                  )}
                  {!running && (
                    <span style={{opacity:0.6}}>Pages {fmtNum(progress.pages)} · fetched {fmtNum(totalFetched)}</span>
                  )}
                  <span style={{color:"var(--success)"}}>+{fmtNum(inserted)} new</span>
                  <span style={{opacity:0.5}}>{fmtNum(existing)} existing</span>
                  {!importMissing && <span style={{opacity:0.4, fontSize:12}}>Import disabled</span>}
                  {progress.rankLimitReached && (
                    <span style={{opacity:0.6}}>Stopped at top {fmtNum(rankLimit)} (limit reached)</span>
                  )}
                  {progress.refreshResult?.refreshed > 0 && (
                    <span style={{color:"var(--success)"}}>{fmtNum(progress.refreshResult.refreshed)} profiles refreshed</span>
                  )}
                  {progress.refreshResult?.failed > 0 && (
                    <span style={{color:"#f87171"}}>{fmtNum(progress.refreshResult.failed)} refresh failures</span>
                  )}
                  {progress.refreshResult?.aborted && (
                    <span style={{opacity:0.6}}>Profile refresh stopped early</span>
                  )}
                </div>
              )}
            </ScannerSection>
          )}

          {/* ── New stubs ───────────────────────────────────────────────── */}
          {importMissing && !running && newlyImportedStubs.length > 0 && (
            <ScannerSection title="New profiles imported">
              <div style={{display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
                <span style={{fontSize:13}}>
                  <b style={{color:"var(--info)"}}>{fmtNum(newlyImportedStubs.length)}</b> new stubs added — refresh to get full profiles
                </span>
                <button className="btn btnPrimary" disabled={refreshingStubs} onClick={refreshStubProfiles}>
                  {refreshingStubs ? "Refreshing…" : "Refresh profiles"}
                </button>
                {refreshStubProgress && (
                  <span style={{fontSize:12, opacity:0.6}}>
                    {fmtNum(refreshStubProgress.done)}/{fmtNum(refreshStubProgress.total)}
                    {refreshStubProgress.current ? ` · ${refreshStubProgress.current}` : ""}
                    {refreshStubProgress.errors ? ` · ${fmtNum(refreshStubProgress.errors)} errors` : ""}
                  </span>
                )}
              </div>
            </ScannerSection>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {error && (
            <div style={{padding:"10px 14px", borderRadius:8, background:"rgba(var(--danger-rgb),0.1)", border:"1px solid rgba(var(--danger-rgb),0.25)", color:"var(--danger)", fontSize:13, marginTop:4}}>
              {error}
            </div>
          )}



        </div>
      </div>

      {/* ── CACHED TABLE CARD ────────────────────────────────────────────── */}
      <div className="card">
        <div className="cardHeader" style={{justifyContent:"space-between", flexWrap:"wrap", gap:10}}>
          <div className="cardTitle">
            Cached leaderboard
            {lastUpdatedLabel && <span style={{fontSize:12, fontWeight:400, opacity:0.45, marginLeft:10}}>Updated {lastUpdatedLabel}</span>}
          </div>

          {/* Controls inline in header */}
          <div style={{display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
            <input
              className="input"
              placeholder="Search names…"
              value={nameQuery}
              onChange={e=>setNameQuery(e.target.value)}
              style={{width:200}}
            />
            {nameQuery && <button className="btn" style={{fontSize:12,padding:"3px 8px"}} onClick={()=>setNameQuery("")}>✕</button>}

            <select className="select" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))} style={{width:90}}>
              {[100,250,500,1000].map(n=><option key={n} value={n}>{n} / page</option>)}
            </select>

            {/* Page nav */}
            <div style={{display:"flex", alignItems:"center", gap:4}}>
              <button className="btn" style={{padding:"4px 8px"}} disabled={page<=1}
                onClick={()=>{ const p=clampPage(page-1); setPage(p); setGotoPage(String(p)); setTimeout(()=>refreshCache(false),0); }}>
                ‹
              </button>
              <input
                className="input"
                value={gotoPage}
                onChange={e=>setGotoPage(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); const p=clampPage(gotoPage); setPage(p); setGotoPage(String(p)); setTimeout(()=>refreshCache(false),0); } }}
                style={{width:55, textAlign:"center"}}
                inputMode="numeric"
              />
              <span style={{fontSize:12, opacity:0.45, whiteSpace:"nowrap"}}>/ {totalPages?fmtNum(totalPages):"—"}</span>
              <button className="btn" style={{padding:"4px 8px"}} disabled={!!totalPages&&page>=totalPages}
                onClick={()=>{ const p=clampPage(page+1); setPage(p); setGotoPage(String(p)); setTimeout(()=>refreshCache(false),0); }}>
                ›
              </button>
            </div>

            <span style={{fontSize:12, opacity:0.45, whiteSpace:"nowrap"}}>
              {cache?.totalRows ? `${fmtNum(cache.totalRows)} total` : "—"}
            </span>
            <button className="btn" onClick={()=>refreshCache(false)} style={{fontSize:12, padding:"4px 10px"}}>Refresh</button>
          </div>
        </div>

        <div className="cardBody" style={{padding:0}}>
          <div style={{overflowX:"auto"}}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{width:70}}>Rank</th>
                  <th>Name</th>
                  <th style={{width:100}}>Level</th>
                  <th style={{width:140}}>Score</th>
                  <th style={{width:180}}>Exp cap</th>
                </tr>
              </thead>
              <tbody>
                {(cache.rows||[]).map(r=>(
                  <tr key={r.rank}>
                    <td style={{opacity:0.5, fontSize:13}}>{fmtNum(r.rank)}</td>
                    <td style={{fontWeight:600}}>
                      {(entityType==="players"||entityType==="pets") ? (
                        <Link to={`/players/${encodeURIComponent(String(r.name||"").trim())}`} style={{textDecoration:"none", color:"inherit"}}>
                          {r.name}
                        </Link>
                      ) : entityType==="clans" ? (
                        <Link to={`/clans/${encodeURIComponent(String(r.name||"").trim())}`} style={{textDecoration:"none", color:"inherit"}}>
                          {r.name}
                        </Link>
                      ) : r.name}
                    </td>
                    <td>{r.level!==null?fmtNum(r.level):""}</td>
                    <td>{r.score!==null?fmtNum(r.score):""}</td>
                    <td style={{fontSize:12, opacity:0.55}}>{fmtExpCapDate(r.expCapDate)}</td>
                  </tr>
                ))}
                {(!cache.rows||cache.rows.length===0) && (
                  <tr><td colSpan={5} style={{textAlign:"center", opacity:0.35, padding:24}}>No cached rows for this board yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}
