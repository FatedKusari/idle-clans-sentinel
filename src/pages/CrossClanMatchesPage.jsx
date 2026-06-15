import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, onScanProgress } from "../lib/bridge.js";
import { modeLabel } from "../lib/format.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function clampNum(v, min, max, fallback){
  const n = Number(v);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}


function nameStem(name, ignoreDigits){
  let t = String(name||"").toLowerCase().replace(/\s+/g,"").replace(/[_-]+/g,"");
  if (ignoreDigits) t = t.replace(/\d+/g,"");
  return t.replace(/[^a-z]/g,"") || t;
}

function computeCoreInfo(cluster, ignoreDigits){
  const members = Array.isArray(cluster?.members) ? cluster.members : [];
  const stemMap = new Map();
  for (const m of members){
    const stem = nameStem(m?.name, ignoreDigits);
    const entry = stemMap.get(stem) || { stem, count:0, clans:new Set() };
    entry.count += 1;
    if (m?.clanLower) entry.clans.add(m.clanLower);
    stemMap.set(stem, entry);
  }
  const stems = Array.from(stemMap.values())
    .map(e=>({ stem:e.stem, count:e.count, clanCount:e.clans.size }))
    .sort((a,b)=>(b.clanCount-a.clanCount)||(b.count-a.count)||a.stem.localeCompare(b.stem));
  const coreStemSet = new Set();
  for (const s of stems) if ((s.clanCount>=2&&s.count>=2)||s.count>=4) coreStemSet.add(s.stem);
  for (const s of stems.slice(0,2)) coreStemSet.add(s.stem);
  const topCoreStems = stems.filter(s=>coreStemSet.has(s.stem)).slice(0,3);
  let coreCount = 0;
  for (const m of members) if (coreStemSet.has(nameStem(m?.name,ignoreDigits))) coreCount++;
  return { coreStemSet, coreCount, satelliteCount:Math.max(0,members.length-coreCount), topCoreStems };
}

// ── sub-components ────────────────────────────────────────────────────────────

function FilterLabel({ children }){
  return <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", opacity:0.45, marginBottom:5 }}>{children}</div>;
}

function Seg({ value, current, onChange, children }){
  const active = value === current;
  return (
    <button onClick={()=>onChange(value)} style={{
      padding:"5px 12px", border:"none", cursor:"pointer", borderRadius:7, fontSize:13, fontWeight:600,
      background: active ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.07)",
      color: active ? "#fff" : "rgba(255,255,255,0.6)",
    }}>{children}</button>
  );
}

function PresetBtn({ onClick, children, title }){
  return (
    <button onClick={onClick} title={title} style={{
      padding:"4px 12px", border:"1px solid rgba(255,255,255,0.12)", borderRadius:7,
      background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.65)",
      fontSize:12, fontWeight:600, cursor:"pointer",
    }}>{children}</button>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function CrossClanMatchesPage(){
  const nav = useNavigate();

  const [similarity,       setSimilarity]       = useState(()=>clampNum(localStorage.getItem("ccm_similarity"),0,100,90));
  const [mode,             setMode]             = useState(()=>localStorage.getItem("ccm_mode")||"any");
  const [ignoreDigits,     setIgnoreDigits]     = useState(()=>(localStorage.getItem("ccm_ignoreDigits")??"1")==="1");
  const [minClusterSize,   setMinClusterSize]   = useState(()=>clampNum(localStorage.getItem("ccm_minClusterSize"),2,200,6));
  const [minDistinctClans, setMinDistinctClans] = useState(()=>clampNum(localStorage.getItem("ccm_minDistinctClans"),1,50,2));
  const [maxOfflineDays,   setMaxOfflineDays]   = useState(()=>clampNum(localStorage.getItem("ccm_maxOfflineDays"),0,365,14));
  const [activityDays,     setActivityDays]     = useState(()=>clampNum(localStorage.getItem("ccm_activityDays"),0,365,14));
  const [minActiveMembers, setMinActiveMembers] = useState(()=>clampNum(localStorage.getItem("ccm_minActiveMembers"),0,200,3));
  const [excludeGuest,     setExcludeGuest]     = useState(()=>(localStorage.getItem("ccm_excludeGuest")??"1")==="1");
  const [sortBy,           setSortBy]           = useState(()=>localStorage.getItem("ccm_sortBy")||"suspicion");
  const [useCache,         setUseCache]         = useState(()=>(localStorage.getItem("ccm_useCache")??"1")==="1");
  const [perPage,          setPerPage]          = useState(()=>clampNum(localStorage.getItem("ccm_perPage"),10,50,10));
  const [page,             setPage]             = useState(1);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [expanded, setExpanded] = useState(()=>new Set());
  const [coreOnly, setCoreOnly] = useState(()=>new Set());
  const [scanState, setScanState] = useState({ running:false, stopping:false, clans:[], index:0, currentClan:"", memberDone:0, memberTotal:0 });
  const scanLoopRef = useRef({ stopRequested:false });

  useEffect(()=>{ setActivityDays(prev=>{ const n=Number(maxOfflineDays)||0; return prev===n?prev:n; }); }, [maxOfflineDays]);

  // Persist
  useEffect(()=>{ try{localStorage.setItem("ccm_similarity",String(similarity));}catch{} },[similarity]);
  useEffect(()=>{ try{localStorage.setItem("ccm_mode",String(mode));}catch{} },[mode]);
  useEffect(()=>{ try{localStorage.setItem("ccm_ignoreDigits",ignoreDigits?"1":"0");}catch{} },[ignoreDigits]);
  useEffect(()=>{ try{localStorage.setItem("ccm_minClusterSize",String(minClusterSize));}catch{} },[minClusterSize]);
  useEffect(()=>{ try{localStorage.setItem("ccm_minDistinctClans",String(minDistinctClans));}catch{} },[minDistinctClans]);
  useEffect(()=>{ try{localStorage.setItem("ccm_activityDays",String(activityDays));}catch{} },[activityDays]);
  useEffect(()=>{ try{localStorage.setItem("ccm_minActiveMembers",String(minActiveMembers));}catch{} },[minActiveMembers]);
  useEffect(()=>{ try{localStorage.setItem("ccm_maxOfflineDays",String(maxOfflineDays));}catch{} },[maxOfflineDays]);
  useEffect(()=>{ try{localStorage.setItem("ccm_excludeGuest",excludeGuest?"1":"0");}catch{} },[excludeGuest]);
  useEffect(()=>{ try{localStorage.setItem("ccm_sortBy",String(sortBy));}catch{} },[sortBy]);
  useEffect(()=>{ try{localStorage.setItem("ccm_useCache",useCache?"1":"0");}catch{} },[useCache]);
  useEffect(()=>{ try{localStorage.setItem("ccm_perPage",String(perPage));}catch{} },[perPage]);

  const buildParams = useMemo(()=>({ similarityThreshold:Number(similarity)/100, ignoreDigits:!!ignoreDigits, mode:String(mode||"any").toLowerCase() }), [similarity,ignoreDigits,mode]);
  const viewParams  = useMemo(()=>({ minClusterSize,minDistinctClans,maxOfflineDays,activityDays,minActiveMembers,excludeGuest,sortBy,page,perPage }), [minClusterSize,minDistinctClans,maxOfflineDays,activityDays,minActiveMembers,excludeGuest,sortBy,page,perPage]);
  const totalPages  = data?.totalPages || 1;

  async function load({ forceRebuild=false }={}){
    setLoading(true); setError("");
    try{
      const res = await api.getCrossClanMatches({ build:buildParams, view:viewParams, useCache:!!useCache, forceRebuild:!!forceRebuild });
      setData(res);
      if (res?.totalPages && page>res.totalPages) setPage(res.totalPages);
    }catch(e){ setError(String(e?.message||e)); setData(null); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); }, []); // eslint-disable-line
  useEffect(()=>{ load(); }, [similarity,mode,ignoreDigits,minClusterSize,minDistinctClans,maxOfflineDays,activityDays,minActiveMembers,excludeGuest,sortBy,page,perPage,useCache]); // eslint-disable-line

  function collectClans(){ const m=new Map(); for(const c of (data?.clusters||[])) for(const mb of (c?.members||[])){ const cn=String(mb?.clanName||"").trim(); if(cn) m.set(cn.toLowerCase(),cn); } return Array.from(m.values()).sort((a,b)=>a.localeCompare(b)); }

  async function startOrResumeRescan(){
    const clans=(scanState.clans?.length?scanState.clans:collectClans()); if(!clans.length) return;
    scanLoopRef.current.stopRequested=false;
    const startIdx = scanState.clans?.length ? scanState.index : 0;
    setScanState(prev=>({...prev,running:true,stopping:false,clans,index:startIdx,currentClan:clans[startIdx]||"",memberDone:0,memberTotal:0}));
    for(let i=startIdx;i<clans.length;i++){
      if(scanLoopRef.current.stopRequested) break;
      const clanName=clans[i];
      setScanState(prev=>({...prev,running:true,stopping:false,clans,index:i,currentClan:clanName,memberDone:0,memberTotal:0}));
      const res=await api.scanClanMembers(clanName);
      if(res?.canceled) break;
    }
    setScanState(prev=>({...prev,running:false,stopping:false}));
    await load({ forceRebuild:true });
  }

  async function stopRescan(){
    scanLoopRef.current.stopRequested=true;
    setScanState(prev=>({...prev,stopping:true}));
    try{ await api.cancelScanClanMembers?.(); }catch{}
  }

  useEffect(()=>{
    const off=onScanProgress((payload)=>{
      if(!payload||!payload.clanName) return;
      setScanState(prev=>{
        if(prev.currentClan&&String(payload.clanName)!==String(prev.currentClan)) return prev;
        const next={...prev,memberDone:Number(payload.done||0),memberTotal:Number(payload.total||0)};
        if(payload.running===false){ next.stopping=false; setTimeout(()=>load({forceRebuild:true}),50); }
        return next;
      });
    });
    return ()=>{ try{off&&off();}catch{} };
  }, []); // eslint-disable-line

  function applyPreset(kind){
    const p={tight:{similarity:92,minClusterSize:8,minDistinctClans:3,activityDays:7,minActiveMembers:5,maxOfflineDays:14},default:{similarity:90,minClusterSize:6,minDistinctClans:2,activityDays:14,minActiveMembers:3,maxOfflineDays:14},broad:{similarity:82,minClusterSize:4,minDistinctClans:2,activityDays:30,minActiveMembers:2,maxOfflineDays:30},alltime:{similarity:90,minClusterSize:6,minDistinctClans:2,activityDays:0,minActiveMembers:0,maxOfflineDays:365}}[kind];
    if(!p) return;
    setSimilarity(p.similarity); setMinClusterSize(p.minClusterSize); setMinDistinctClans(p.minDistinctClans);
    setActivityDays(p.activityDays); setMinActiveMembers(p.minActiveMembers); setMaxOfflineDays(p.maxOfflineDays);
    setExcludeGuest(true); setSortBy("suspicion"); setPage(1);
  }

  function sendToInspector(cluster){
    const names=Array.from(new Set((cluster?.members||[]).map(m=>String(m.name||"").trim()).filter(Boolean)));
    try{ localStorage.setItem("idleclans_inspect_players_v1",JSON.stringify(names)); }catch{}
    nav("/player-inspector");
  }

  function toggleExpanded(id){ setExpanded(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; }); }
  function toggleCoreOnly(id){ setCoreOnly(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; }); }

  const builtAtLabel = useMemo(()=>{ if(!data?.builtAt) return "Not built yet"; try{ const d=new Date(data.builtAt); return Number.isFinite(d.getTime())?d.toLocaleString():String(data.builtAt); }catch{ return String(data.builtAt); } }, [data?.builtAt]);

  return (
    <div className="page">

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:20, marginBottom:2 }}>Cross-Clan Name Matches</div>
          <div style={{ fontSize:13, opacity:0.45 }}>
            Clusters of similar player names spanning multiple clans — potential alt networks.
          </div>
          <div style={{ fontSize:12, opacity:0.35, marginTop:2 }}>Last built: {builtAtLabel}</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          {scanState.running ? (
            <button className="btn btnDanger" onClick={stopRescan} disabled={scanState.stopping}>
              {scanState.stopping?"Stopping…":"Stop scan"}
            </button>
          ) : (
            <button className="btn" onClick={startOrResumeRescan} disabled={loading}>
              Rescan clans in results
            </button>
          )}
          <button className="btn btnPrimary" onClick={()=>load({forceRebuild:true})} disabled={loading}>
            {loading ? "Building…" : "Rebuild clusters"}
          </button>
        </div>
      </div>

      {/* Scan progress */}
      {scanState.running && (
        <div style={{ marginBottom:12, padding:"8px 14px", borderRadius:8, background:"rgba(var(--info-rgb),0.08)", border:"1px solid rgba(var(--info-rgb),0.2)", fontSize:13 }}>
          Scanning clan <b>{scanState.index+1}</b> / <b>{scanState.clans.length}</b> — <b>{scanState.currentClan}</b>
          {scanState.memberTotal > 0 && <> · Members: <b>{scanState.memberDone}/{scanState.memberTotal}</b></>}
        </div>
      )}

      {/* ── Filters card ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom:14 }}>
        <div className="cardBody">
          <div style={{ display:"flex", gap:20, flexWrap:"wrap", alignItems:"flex-start" }}>

            {/* Match rules */}
            <div style={{ minWidth:220 }}>
              <FilterLabel>Match rules</FilterLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Similarity threshold</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <input className="input" type="number" min={0} max={100} value={similarity} style={{width:80}}
                      onChange={e=>{ setSimilarity(clampNum(e.target.value,0,100,90)); setPage(1); }} />
                    <span style={{ fontSize:13, opacity:0.5 }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Game mode</div>
                  <select className="select" value={mode} style={{width:160}} onChange={e=>{ setMode(e.target.value); setPage(1); }}>
                    <option value="any">Any</option>
                    <option value="default">Normal</option>
                    <option value="ironman">Ironman</option>
                    <option value="groupironman">Group Ironman</option>
                  </select>
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={!!ignoreDigits} onChange={e=>{ setIgnoreDigits(e.target.checked); setPage(1); }} />
                  Ignore trailing digits
                </label>
              </div>
            </div>

            {/* Activity scope */}
            <div style={{ minWidth:200 }}>
              <FilterLabel>Activity scope</FilterLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Max offline (days)</div>
                  <input className="input" type="number" min={0} max={365} value={maxOfflineDays} style={{width:90}}
                    onChange={e=>{ setMaxOfflineDays(clampNum(e.target.value,0,365,14)); setPage(1); }} />
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Min active members</div>
                  <input className="input" type="number" min={0} max={200} value={minActiveMembers} style={{width:90}}
                    onChange={e=>{ setMinActiveMembers(clampNum(e.target.value,0,200,3)); setPage(1); }} />
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={!!excludeGuest} onChange={e=>{ setExcludeGuest(e.target.checked); setPage(1); }} />
                  Exclude guest clan
                </label>
              </div>
            </div>

            {/* Results view */}
            <div style={{ minWidth:200 }}>
              <FilterLabel>Results view</FilterLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Min cluster size</div>
                  <input className="input" type="number" min={2} max={200} value={minClusterSize} style={{width:90}}
                    onChange={e=>{ setMinClusterSize(clampNum(e.target.value,2,200,6)); setPage(1); }} />
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Min distinct clans</div>
                  <input className="input" type="number" min={1} max={50} value={minDistinctClans} style={{width:90}}
                    onChange={e=>{ setMinDistinctClans(clampNum(e.target.value,1,50,2)); setPage(1); }} />
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Sort by</div>
                  <select className="select" value={sortBy} style={{width:180}} onChange={e=>{ setSortBy(e.target.value); setPage(1); }}>
                    <option value="suspicion">Suspicion score</option>
                    <option value="spread">Spread score</option>
                    <option value="size">Cluster size</option>
                    <option value="clans">Distinct clans</option>
                    <option value="maxsim">Max similarity</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Presets + options */}
            <div style={{ minWidth:200 }}>
              <FilterLabel>Presets</FilterLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <PresetBtn onClick={()=>applyPreset("tight")} title="92% similarity — highest confidence">Tight (92%)</PresetBtn>
                <PresetBtn onClick={()=>applyPreset("default")} title="90% similarity — balanced">Default (90%)</PresetBtn>
                <PresetBtn onClick={()=>applyPreset("broad")} title="82% similarity — wider net">Broad (82%)</PresetBtn>
                <PresetBtn onClick={()=>applyPreset("alltime")} title="No activity time filter">All-time</PresetBtn>
              </div>
              <div style={{ marginTop:12 }}>
                <FilterLabel>Options</FilterLabel>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  <div>
                    <div style={{ fontSize:12, opacity:0.55, marginBottom:4 }}>Per page</div>
                    <select className="select" value={perPage} style={{width:100}} onChange={e=>{ setPerPage(clampNum(e.target.value,10,50,10)); setPage(1); }}>
                      {[10,20,30,50].map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer" }}>
                    <input type="checkbox" checked={!!useCache} onChange={e=>setUseCache(e.target.checked)} />
                    Use cached clusters
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Summary sentence */}
          <div style={{ marginTop:14, paddingTop:12, borderTop:"1px solid rgba(255,255,255,0.07)", fontSize:12, opacity:0.5 }}>
            Matching names ≥ <b style={{opacity:1}}>{similarity}%</b> similar{ignoreDigits?" (digits ignored)":""} · mode <b style={{opacity:1}}>{modeLabel(mode)}</b> · ≥ <b style={{opacity:1}}>{minDistinctClans}</b> clan(s) · cluster ≥ <b style={{opacity:1}}>{minClusterSize}</b> · active within <b style={{opacity:1}}>{maxOfflineDays}d</b>
          </div>
        </div>
      </div>

      {/* ── Results header ─────────────────────────────────────────────── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <div style={{ fontSize:13, opacity:0.6 }}>
          {loading ? "Loading…" : (
            <><b style={{opacity:1, color:"rgba(255,255,255,0.9)"}}>{data?.totalClusters??0}</b> clusters
            {data?.stats && <> · <b style={{opacity:1}}>{data.stats.representedPlayers??0}</b> players · <b style={{opacity:1}}>{data.stats.representedClans??0}</b> clans</>}</>
          )}
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button className="btn" style={{padding:"4px 8px"}} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹</button>
          <span style={{ fontSize:12, opacity:0.5 }}>Page {page} / {totalPages}</span>
          <button className="btn" style={{padding:"4px 8px"}} disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>›</button>
        </div>
      </div>

      {error && <div style={{ padding:"10px 14px", borderRadius:8, background:"rgba(var(--danger-rgb),0.1)", color:"var(--danger)", fontSize:13, marginBottom:12 }}>{error}</div>}

      {/* ── Cluster cards ──────────────────────────────────────────────── */}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {(data?.clusters||[]).map(c=>{
          const coreInfo = computeCoreInfo(c, ignoreDigits);
          const coreOnlyOn = coreOnly.has(c.id);
          const isOpen = expanded.has(c.id);

          return (
            <div key={c.id} style={{
              background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:12, overflow:"hidden",
            }}>
              {/* Cluster header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"12px 16px", flexWrap:"wrap" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:4 }}>
                    <span style={{ fontWeight:800, fontSize:14 }}>Cluster #{c.id}</span>
                    <span style={{
                      fontSize:12, fontWeight:700, padding:"2px 10px", borderRadius:6,
                      background:"rgba(255,255,255,0.07)", color:"rgba(255,255,255,0.7)",
                    }}>{c.size} players</span>
                    <span style={{
                      fontSize:12, fontWeight:700, padding:"2px 10px", borderRadius:6,
                      background:"rgba(var(--info-rgb),0.12)", color:"var(--info)",
                    }}>{c.distinctClans} clans</span>
                    {c.suspicionScore != null && (
                      <span style={{
                        fontSize:12, fontWeight:700, padding:"2px 10px", borderRadius:6,
                        background: c.suspicionScore > 5 ? "rgba(var(--warning-rgb),0.12)" : "rgba(255,255,255,0.05)",
                        color: c.suspicionScore > 5 ? "var(--warning)" : "rgba(255,255,255,0.5)",
                      }}>
                        Score {c.suspicionScore.toFixed(1)}
                      </span>
                    )}
                    {c.maxSimPct && <span style={{ fontSize:12, opacity:0.45 }}>sim {c.maxSimPct}</span>}
                  </div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                    {(c.topClans||[]).map(tc=>(
                      <span key={tc.clanLower} style={{
                        fontSize:12, padding:"3px 10px", borderRadius:6,
                        background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)",
                      }}>
                        {tc.clanName} <span style={{opacity:0.45}}>({tc.count})</span>
                      </span>
                    ))}
                    {coreInfo.topCoreStems.length > 0 && (
                      <span style={{ fontSize:12, opacity:0.4 }}>
                        hubs: {coreInfo.topCoreStems.map(s=>s.stem).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  <button className="btn" style={{fontSize:12}} onClick={()=>sendToInspector(c)}>Inspect players</button>
                  <button className="btn" style={{fontSize:12}} onClick={()=>toggleCoreOnly(c.id)}>{coreOnlyOn?"All members":"Core only"}</button>
                  <button className="btn" style={{fontSize:12}} onClick={()=>toggleExpanded(c.id)}>{isOpen?"Collapse ▲":"Expand ▼"}</button>
                </div>
              </div>

              {/* Expanded member list */}
              {isOpen && (
                <div style={{ padding:"0 16px 14px", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ paddingTop:12, display:"flex", flexDirection:"column", gap:12 }}>
                    {(()=>{
                      const byClan=new Map();
                      for(const m of (c.members||[])){ const k=m.clanLower||""; if(!byClan.has(k)) byClan.set(k,{clanName:m.clanName||k,list:[]}); byClan.get(k).list.push(m); }
                      return Array.from(byClan.values()).sort((a,b)=>b.list.length-a.list.length).map(g=>(
                        <div key={g.clanName}>
                          <div style={{ fontSize:11, fontWeight:800, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>
                            {g.clanName} <span style={{fontWeight:400}}>({g.list.length})</span>
                          </div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 8px" }}>
                            {g.list.map(m=>{
                              const off=m.hoursOffline;
                              const label=off==null?"?":off<24?`${Math.round(off)}h`:`${Math.round(off/24)}d`;
                              const stem=nameStem(m.name,ignoreDigits);
                              const isCore=coreInfo.coreStemSet.has(stem);
                              if(coreOnlyOn&&!isCore) return null;
                              return (
                                <span key={m.clanLower+":"+m.name}
                                  onClick={()=>nav(`/players/${encodeURIComponent(m.name)}`)}
                                  style={{
                                    cursor:"pointer", fontSize:13, fontWeight: isCore?700:500,
                                    padding:"4px 10px", borderRadius:7,
                                    background: isCore ? "rgba(var(--info-rgb),0.12)" : "rgba(255,255,255,0.05)",
                                    border: isCore ? "1px solid rgba(var(--info-rgb),0.25)" : "1px solid rgba(255,255,255,0.07)",
                                    color: isCore ? "var(--info)" : "inherit",
                                  }}
                                  title={off==null?"Offline time unknown":`Offline ${label}`}
                                >
                                  {m.name}
                                  {isCore && <span style={{ fontSize:10, marginLeft:5, opacity:0.6 }}>CORE</span>}
                                  <span style={{ fontSize:11, opacity:0.4, marginLeft:5 }}>({label})</span>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!loading && (data?.clusters||[]).length===0 && (
          <div style={{ textAlign:"center", opacity:0.35, padding:40, fontSize:13 }}>
            No clusters match the current filters.
          </div>
        )}
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:16 }}>
          <button className="btn" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Prev</button>
          <span style={{ fontSize:12, opacity:0.5, alignSelf:"center" }}>Page {page} / {totalPages}</span>
          <button className="btn" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next ›</button>
        </div>
      )}
    </div>
  );
}
