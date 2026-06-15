import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, onBackupExportProgress, onBackupImportProgress } from "../lib/bridge";
import { useToast } from "../components/Toast.jsx";
import { modeLabel } from "../lib/format.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtIso(iso){
  if (!iso) return "—";
  try{ return new Date(iso).toLocaleString(); }catch{ return String(iso); }
}
function fmtNum(n){ return Number(n||0).toLocaleString(); }
function clampNum(v,lo,hi){ const x=Number(v); return Number.isFinite(x)?Math.max(lo,Math.min(hi,x)):lo; }
function downloadName(prefix,ext){
  const d=new Date();
  return `${prefix}_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}.${ext}`;
}
function pct(a,b){ return b>0?`${Math.round((a/b)*100)}%`:"—"; }


function TabBar({ tabs, active, onChange }){
  return (
    <div style={{ display:"flex", gap:0, borderBottom:"1px solid rgba(255,255,255,0.08)", marginBottom:24 }}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)} style={{
          background:"none", border:"none", cursor:"pointer",
          padding:"9px 18px", fontSize:13,
          fontWeight: active===t.id ? 700 : 500,
          color: active===t.id ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
          borderBottom: active===t.id ? "2px solid var(--accent,#60a5fa)" : "2px solid transparent",
          marginBottom:-1, transition:"color 0.12s", whiteSpace:"nowrap",
        }}>
          {t.label}
          {t.count!=null && (
            <span style={{
              marginLeft:6, fontSize:11, fontWeight:700,
              background: active===t.id?"var(--accent,#2563eb)":"rgba(255,255,255,0.1)",
              color: active===t.id?"#fff":"rgba(255,255,255,0.5)",
              borderRadius:8, padding:"1px 6px",
            }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, accent }){
  return (
    <div style={{
      background:"rgba(255,255,255,0.03)", border:`1px solid ${accent?accent+"30":"rgba(255,255,255,0.07)"}`,
      borderRadius:10, padding:"14px 16px",
      ...(accent?{background:`${accent}08`}:{}),
    }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", opacity:0.4, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:800, lineHeight:1, color:accent||"inherit" }}>{value}</div>
      {sub && <div style={{ fontSize:12, opacity:0.4, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }){
  return <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase", opacity:0.35, marginBottom:10, marginTop:20 }}>{children}</div>;
}

function EmptyState({ message }){
  return <div style={{ textAlign:"center", padding:"32px 0", opacity:0.35, fontSize:14 }}>{message}</div>;
}

function Paginator({ total, page, pageSize, onChange }){
  if (total <= pageSize) return null;
  const totalPages = Math.ceil(total / pageSize);
  const from = page * pageSize + 1;
  const to   = Math.min(total, (page + 1) * pageSize);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:14, fontSize:12, opacity:0.65 }}>
      <button className="btn" disabled={page===0} onClick={()=>onChange(0)}
        style={{ fontSize:11, padding:"3px 8px" }}>«</button>
      <button className="btn" disabled={page===0} onClick={()=>onChange(page-1)}
        style={{ fontSize:11, padding:"3px 8px" }}>‹</button>
      <span style={{ minWidth:130, textAlign:"center" }}>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <button className="btn" disabled={page>=totalPages-1} onClick={()=>onChange(page+1)}
        style={{ fontSize:11, padding:"3px 8px" }}>›</button>
      <button className="btn" disabled={page>=totalPages-1} onClick={()=>onChange(totalPages-1)}
        style={{ fontSize:11, padding:"3px 8px" }}>»</button>
    </div>
  );
}

function EntityLink({ type, name }){
  if (!name) return <span>—</span>;
  return <Link to={`/${type==="clan"?"clans":"players"}/${encodeURIComponent(name)}`} style={{ fontWeight:600 }}>{name}</Link>;
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function ReportsPage(){
  const toast = useToast();
  const [tab, setTab] = useState("overview");

  // Overview
  const [summary, setSummary]   = useState(null);
  const [sumBusy, setSumBusy]   = useState(false);

  // Alerts
  const [alerts, setAlerts]           = useState([]);
  const [unreadOnly, setUnreadOnly]   = useState(true);

  // Analytics
  const [inactiveDays,  setInactiveDays]  = useState(7);
  const [trackedOnly,   setTrackedOnly]   = useState(true);
  const [inactiveRows,  setInactiveRows]  = useState([]);
  const [inactiveBusy,  setInactiveBusy]  = useState(false);

  // Integrity
  const [integrity, setIntegrity]   = useState(null);

  // Export
  const [exportKind,   setExportKind]   = useState("players");
  const [exportJsonKind, setExportJsonKind] = useState("players");
  const [exportLimit,  setExportLimit]  = useState(50000);
  const [exportBusy,   setExportBusy]   = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  // Full backup / restore
  const [backupBusy,    setBackupBusy]    = useState(false);
  const [backupStatus,  setBackupStatus]  = useState(null);
  const [backupProgress, setBackupProgress] = useState(null); // { table, tableRows, totalRows }
  const [importBusy,     setImportBusy]     = useState(false);
  const [importStatus,   setImportStatus]   = useState(null);
  const [importProgress, setImportProgress] = useState(null); // { table, tableRows, totalInserted }

  // Banned / Flagged
  const [bannedRows,  setBannedRows]  = useState([]);
  const [flaggedRows, setFlaggedRows] = useState([]);
  const [flaggedClanRows, setFlaggedClanRows] = useState([]);
  const [flaggedKind, setFlaggedKind] = useState("players"); // "players" | "clans"

  // Not Found
  const [notFoundData, setNotFoundData] = useState(null); // { players, clans }
  const [notFoundBusy, setNotFoundBusy] = useState({});
  const [notFoundKind, setNotFoundKind] = useState("players");
  const [notFoundPage, setNotFoundPage] = useState(0);

  // Dormant (auto-excluded from scans due to long inactivity)
  const [dormantRows,   setDormantRows]   = useState(null);
  const [dormantBusy,   setDormantBusy]   = useState({});
  const [dormantScanProgress, setDormantScanProgress] = useState({ running:false, done:0, total:0 });
  const [dormantPage,   setDormantPage]   = useState(0);

  const PAGE_SIZE = 50;

  async function loadSummary(){
    setSumBusy(true);
    try{
      const s = await api.getAnalyticsSummary?.();
      if (s) setSummary(s);
    }catch(e){ console.error(e); }
    finally{ setSumBusy(false); }
  }

  async function loadAlerts(){ const r=await api.getAlerts({unreadOnly,limit:500}); setAlerts(Array.isArray(r?.rows)?r.rows:[]); }
  async function loadInactive(){
    setInactiveBusy(true);
    try{ const r=await api.getInactiveReport({days:clampNum(inactiveDays,1,365),trackedOnly,limit:500}); setInactiveRows(Array.isArray(r?.rows)?r.rows:[]); }
    finally{ setInactiveBusy(false); }
  }
  async function loadIntegrity(){ setIntegrity(await api.runIntegrityCheck()||null); }
  async function loadBanned(){ try{ const r=await api.listBannedPlayers(2000); setBannedRows(Array.isArray(r)?r:(Array.isArray(r?.rows)?r.rows:[])); }catch{ setBannedRows([]); } }
  async function loadFlagged(){
    try{ const r=await api.listFlaggedPlayers(2000); setFlaggedRows(Array.isArray(r)?r:(Array.isArray(r?.rows)?r.rows:[])); }catch{ setFlaggedRows([]); }
    try{ const r=await api.listFlaggedClans?.(2000); setFlaggedClanRows(Array.isArray(r)?r:(Array.isArray(r?.rows)?r.rows:[])); }catch{ setFlaggedClanRows([]); }
  }
  async function loadNotFound(){
    try{
      const r = await api.listNotFoundEntities?.({ limit:2000 });
      setNotFoundData({
        players: Array.isArray(r?.players) ? r.players : [],
        clans:   Array.isArray(r?.clans)   ? r.clans   : [],
      });
    }catch{ setNotFoundData({ players:[], clans:[] }); }
  }
  async function loadDormant(){
    try{ const r = await api.listDormantPlayers?.({ limit:200000 }); setDormantRows(Array.isArray(r)?r:[]); }
    catch{ setDormantRows([]); }
  }

  useEffect(()=>{
    if (tab==="overview")   loadSummary();
    if (tab==="alerts")     loadAlerts();
    if (tab==="analytics")  {} // user triggers manually
    if (tab==="integrity")  {} // user triggers manually
    if (tab==="banned")     loadBanned();
    if (tab==="flagged")    loadFlagged();
    if (tab==="notFound")   { setNotFoundPage(0); loadNotFound(); }
    if (tab==="dormant")    { setDormantPage(0);  loadDormant(); }
  }, [tab, unreadOnly]); // eslint-disable-line

  const unreadCount = useMemo(()=>alerts.filter(a=>!a.readAt).length,[alerts]);
  const notFoundCount = useMemo(()=>
    (notFoundData?.players?.length||0) + (notFoundData?.clans?.length||0),
  [notFoundData]);

  const TABS = [
    { id:"overview",  label:"Overview" },
    { id:"alerts",    label:"Alerts",     count:unreadCount||undefined },
    { id:"banned",    label:"Banned",     count:bannedRows.length||undefined },
    { id:"flagged",   label:"Flagged",    count:(flaggedRows.length+flaggedClanRows.length)||undefined },
    { id:"notFound",  label:"Not Found",  count:notFoundCount||undefined },
    { id:"dormant",   label:"Dormant",    count:dormantRows?.length||undefined },
    { id:"analytics", label:"Analytics" },
    { id:"integrity", label:"Integrity" },
    { id:"export",    label:"Export" },
    { id:"backup",    label:"Backup & Restore" },
  ];

  return (
    <div style={{ maxWidth:960 }}>
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* ── OVERVIEW ───────────────────────────────────────────────────── */}
      {tab==="overview" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <span style={{ fontSize:13, opacity:0.5 }}>A snapshot of everything stored locally.</span>
            <button className="btn" onClick={loadSummary} disabled={sumBusy}>{sumBusy?"Loading…":"Refresh"}</button>
          </div>
          {!summary ? (
            <EmptyState message="Loading summary…" />
          ) : (
            <>
              {/* Top stat grid */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:20 }}>
                <StatCard label="Players"      value={fmtNum(summary.players)} />
                <StatCard label="Clans"        value={fmtNum(summary.clans)} />
                <StatCard label="Banned"       value={fmtNum(summary.banned)}   accent="#ef4444" />
                <StatCard label="Flagged"      value={fmtNum(summary.flagged)}  accent="#60a5fa"
                  sub={summary.flaggedClans>0?`+${fmtNum(summary.flaggedClans)} clans`:null} />
                <StatCard label="Chat messages" value={fmtNum(summary.chatMessages)} />
                <StatCard label="Clan moves"   value={fmtNum(summary.totalMoves)}
                  sub={`${fmtNum(summary.moves7)} last 7d`} />
              </div>

              {/* Scan coverage */}
              <SectionLabel>Scan coverage</SectionLabel>
              <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, padding:"14px 16px", marginBottom:20 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12 }}>
                  {[
                    ["Scanned in last 7 days",  summary.scanned7,      summary.players],
                    ["Scanned in last 30 days", summary.scanned30,     summary.players],
                    ["Never scanned",           summary.neverScanned,  summary.players],
                  ].map(([label,n,total])=>(
                    <div key={label}>
                      <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>{label}</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                        <span style={{ fontSize:20, fontWeight:800 }}>{fmtNum(n)}</span>
                        <span style={{ fontSize:12, opacity:0.4 }}>{pct(n,total)} of players</span>
                      </div>
                      <div style={{ height:4, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden", marginTop:6 }}>
                        <div style={{ width:pct(n,total), height:"100%", borderRadius:999,
                          background: label.includes("Never")?"var(--danger)":"var(--success)", transition:"width 0.4s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Game mode breakdown */}
              <SectionLabel>Players by game mode</SectionLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:20 }}>
                {Object.entries(summary.byMode||{})
                  .sort((a,b)=>b[1]-a[1])
                  .map(([mode,n])=>{
                    const w = pct(n, summary.players);
                    return (
                      <div key={mode} style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <span style={{ width:130, fontSize:13, opacity:0.7, flexShrink:0 }}>{modeLabel(mode)}</span>
                        <div style={{ flex:1, height:6, background:"rgba(255,255,255,0.07)", borderRadius:999, overflow:"hidden" }}>
                          <div style={{ width:w, height:"100%", background:"rgba(var(--info-rgb),0.6)", borderRadius:999 }} />
                        </div>
                        <span style={{ fontSize:13, fontWeight:700, minWidth:60, textAlign:"right" }}>{fmtNum(n)}</span>
                        <span style={{ fontSize:12, opacity:0.4, minWidth:44, textAlign:"right" }}>{w}</span>
                      </div>
                    );
                  })}
              </div>

              {/* Recently banned */}
              {summary.recentBanned?.length>0 && (
                <>
                  <SectionLabel>Recently banned</SectionLabel>
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    {summary.recentBanned.map(r=>(
                      <div key={r.username} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 12px", borderRadius:8,
                        background:"rgba(var(--danger-rgb),0.05)", border:"1px solid rgba(var(--danger-rgb),0.15)" }}>
                        <Link to={`/players/${encodeURIComponent(r.username)}`} style={{ fontWeight:700, flex:1 }}>{r.username}</Link>
                        <span style={{ fontSize:12, opacity:0.5 }}>{r.guildName||"No clan"}</span>
                        <span style={{ fontSize:12, opacity:0.4 }}>{fmtIso(r.bannedAt)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ALERTS ─────────────────────────────────────────────────────── */}
      {tab==="alerts" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:14, cursor:"pointer" }}>
              <input type="checkbox" checked={unreadOnly} onChange={e=>setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
            <div style={{ display:"flex", gap:8, marginLeft:"auto" }}>
              <button className="btn" onClick={loadAlerts}>Refresh</button>
              <button className="btn" onClick={async()=>{ await api.clearAlerts({mode:"read"}); await loadAlerts(); }}>Clear read</button>
              <button className="btn btnDanger" onClick={async()=>{ if(!confirm("Clear all alerts?")) return; await api.clearAlerts({mode:"all"}); await loadAlerts(); }}>Clear all</button>
            </div>
          </div>
          {alerts.length===0 ? <EmptyState message="No alerts." /> : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {alerts.map(a=>(
                <div key={a.id} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"10px 14px", borderRadius:10,
                  background: a.readAt?"rgba(255,255,255,0.03)":"rgba(var(--info-rgb),0.07)",
                  border: a.readAt?"1px solid rgba(255,255,255,0.06)":"1px solid rgba(var(--info-rgb),0.2)" }}>
                  {!a.readAt && <div style={{ width:6,height:6,borderRadius:"50%",background:"var(--info)",marginTop:5,flexShrink:0 }} />}
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:3 }}>
                      <span style={{ fontSize:11,fontWeight:700,opacity:0.5,textTransform:"uppercase",letterSpacing:"0.06em" }}>{a.type}</span>
                      <EntityLink type={a.entityType} name={a.entityName} />
                    </div>
                    <div style={{ fontSize:14 }}>{a.message}</div>
                    <div style={{ fontSize:11,opacity:0.4,marginTop:3 }}>{fmtIso(a.createdAt)}</div>
                  </div>
                  {!a.readAt && (
                    <button className="btn" style={{ fontSize:12,padding:"3px 10px",flexShrink:0 }}
                      onClick={async()=>{ await api.markAlertRead(a.id); await loadAlerts(); }}>
                      Mark read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BANNED ─────────────────────────────────────────────────────── */}
      {tab==="banned" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
            <span style={{ opacity:0.5,fontSize:13 }}>{bannedRows.length.toLocaleString()} players marked as rule-breakers</span>
            <button className="btn" onClick={loadBanned} style={{ marginLeft:"auto" }}>Refresh</button>
          </div>
          {bannedRows.length===0 ? <EmptyState message="No banned players yet." /> : (
            <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
              {bannedRows.map(r=>{
                const key=r.lowerName||r.playerLower||r.username;
                return (
                  <div key={key} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,
                    background:"rgba(var(--danger-rgb),0.05)",border:"1px solid rgba(var(--danger-rgb),0.15)" }}>
                    <div style={{ flex:1,minWidth:0 }}>
                      <Link to={`/players/${encodeURIComponent(r.username)}`} style={{ fontWeight:700 }}>{r.username}</Link>
                      <div style={{ fontSize:12,opacity:0.5,marginTop:2 }}>
                        {r.guildName||"No clan"} · {modeLabel(r.gameMode)}
                      </div>
                    </div>
                    <span style={{ fontSize:12,opacity:0.45,whiteSpace:"nowrap" }}>{fmtIso(r.bannedAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FLAGGED ────────────────────────────────────────────────────── */}
      {tab==="flagged" && (
        <div>
          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
            {/* Kind toggle */}
            <div style={{ display:"flex", borderRadius:8, overflow:"hidden", border:"1px solid rgba(255,255,255,0.1)", flexShrink:0 }}>
              {[["players","Players",flaggedRows.length],["clans","Clans",flaggedClanRows.length]].map(([id,label,count])=>(
                <button key={id} onClick={()=>setFlaggedKind(id)} style={{
                  padding:"6px 16px", border:"none", cursor:"pointer", fontSize:13, fontWeight:600,
                  background: flaggedKind===id ? "rgba(var(--info-rgb),0.18)" : "transparent",
                  color: flaggedKind===id ? "var(--info)" : "rgba(255,255,255,0.45)",
                  borderRight: id==="players" ? "1px solid rgba(255,255,255,0.1)" : "none",
                }}>
                  {label}
                  <span style={{ marginLeft:6, fontSize:11, opacity:0.7,
                    background:"rgba(255,255,255,0.08)", borderRadius:10, padding:"1px 6px" }}>
                    {count}
                  </span>
                </button>
              ))}
            </div>
            <span style={{ opacity:0.45, fontSize:13 }}>
              {flaggedKind==="players"
                ? `${flaggedRows.length.toLocaleString()} player${flaggedRows.length!==1?"s":""} being tracked`
                : `${flaggedClanRows.length.toLocaleString()} clan${flaggedClanRows.length!==1?"s":""} being tracked`}
            </span>
            <button className="btn" onClick={loadFlagged} style={{ marginLeft:"auto" }}>Refresh</button>
          </div>

          {/* Players list */}
          {flaggedKind==="players" && (
            flaggedRows.length===0
              ? <EmptyState message="No flagged players yet." />
              : (
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {flaggedRows.map(r=>{
                    const key=r.lowerName||r.entityLower||r.username;
                    const name=r.username||r.entityName||r.entityLower;
                    return (
                      <div key={key} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,
                        background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <Link to={`/players/${encodeURIComponent(name)}`} style={{ fontWeight:700 }}>{name}</Link>
                          <div style={{ fontSize:12,opacity:0.5,marginTop:2 }}>
                            {r.guildName||"No clan"} · {modeLabel(r.gameMode)}
                          </div>
                          <div style={{ fontSize:11,opacity:0.4,marginTop:2 }}>Next refresh: {fmtIso(r.nextRunAt)}</div>
                        </div>
                        <button className="btn" style={{ fontSize:12,padding:"4px 12px",flexShrink:0 }}
                          onClick={async()=>{ await api.setTracked("player",name,false); await loadFlagged(); }}>
                          Unflag
                        </button>
                      </div>
                    );
                  })}
                </div>
              )
          )}

          {/* Clans list */}
          {flaggedKind==="clans" && (
            flaggedClanRows.length===0
              ? <EmptyState message="No flagged clans yet." />
              : (
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {flaggedClanRows.map(r=>{
                    const key=r.lowerName||r.entityLower;
                    const name=r.clanName||r.entityName||r.entityLower;
                    return (
                      <div key={key} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,
                        background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <Link to={`/clans/${encodeURIComponent(name)}`} style={{ fontWeight:700 }}>{name}</Link>
                            {r.tag && (
                              <span style={{ fontSize:11, fontWeight:700, padding:"1px 7px", borderRadius:5,
                                background:"rgba(255,255,255,0.07)", opacity:0.7 }}>{r.tag}</span>
                            )}
                          </div>
                          <div style={{ fontSize:12,opacity:0.5,marginTop:2 }}>
                            {modeLabel(r.gameMode)}
                            {r.memberCount>0 && ` · ${r.memberCount} members`}
                          </div>
                          <div style={{ fontSize:11,opacity:0.4,marginTop:2 }}>Next refresh: {fmtIso(r.nextRunAt)}</div>
                        </div>
                        <button className="btn" style={{ fontSize:12,padding:"4px 12px",flexShrink:0 }}
                          onClick={async()=>{ await api.setTracked("clan",name,false); await loadFlagged(); }}>
                          Unflag
                        </button>
                      </div>
                    );
                  })}
                </div>
              )
          )}
        </div>
      )}

      {/* ── ANALYTICS ──────────────────────────────────────────────────── */}
      {tab==="analytics" && (
        <div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:12, marginBottom:20, flexWrap:"wrap",
            padding:"14px 16px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10 }}>
            <div>
              <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Inactive for at least (days)</div>
              <input className="input" type="number" min={1} max={365} value={inactiveDays}
                onChange={e=>setInactiveDays(e.target.value)} style={{ width:100 }} />
            </div>
            <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer", paddingBottom:2 }}>
              <input type="checkbox" checked={trackedOnly} onChange={e=>setTrackedOnly(e.target.checked)} />
              Flagged players only
            </label>
            <button className="btn btnPrimary" onClick={loadInactive} disabled={inactiveBusy}>
              {inactiveBusy?"Running…":"Run report"}
            </button>
          </div>

          {inactiveRows.length===0 ? (
            <EmptyState message="Configure filters above and click Run report." />
          ) : (
            <>
              <div style={{ fontSize:13, opacity:0.5, marginBottom:12 }}>
                {inactiveRows.length.toLocaleString()} player{inactiveRows.length!==1?"s":""} offline for {inactiveDays}+ days
              </div>
              <div style={{ overflowX:"auto", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, overflow:"hidden" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Player</th><th>Clan</th>
                      <th style={{ textAlign:"right" }}>Days offline</th>
                      <th>Last online</th><th>Last scanned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inactiveRows.map(r=>(
                      <tr key={r.playerLower}>
                        <td><Link to={`/players/${encodeURIComponent(r.playerName)}`} style={{ fontWeight:600 }}>{r.playerName}</Link></td>
                        <td style={{ opacity:0.65 }}>{r.guildName||"—"}</td>
                        <td style={{ textAlign:"right", fontWeight:700,
                          color: r.daysOffline>30?"var(--danger)":r.daysOffline>14?"var(--warning)":"inherit" }}>
                          {Number(r.daysOffline).toFixed(1)}
                        </td>
                        <td style={{ fontSize:12, opacity:0.65 }}>{fmtIso(r.lastOnlineAt)}</td>
                        <td style={{ fontSize:12, opacity:0.65 }}>{fmtIso(r.scannedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── INTEGRITY ──────────────────────────────────────────────────── */}
      {tab==="integrity" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", marginBottom:16 }}>
            <span style={{ opacity:0.5,fontSize:13 }}>Basic consistency checks on stored data.</span>
            <button className="btn btnPrimary" onClick={loadIntegrity} style={{ marginLeft:"auto" }}>Run check</button>
          </div>
          {!integrity ? <EmptyState message="Click 'Run check' to inspect the database." /> : (
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {[
                ["Logs with missing parent entity",              integrity.orphanLogs,          "Orphaned log rows that reference a player/clan no longer in the DB."],
                ["History rows where player record is missing",  integrity.orphanHistoryPlayers, "Clan travel history referencing players that were deleted."],
                ["Tracked rows where entity record is missing",  integrity.orphanTracked,        "Flagged entities that no longer have a corresponding player/clan row."],
                ["Clan members where clan record is missing",    integrity.orphanClanMembers,    "Members referencing a clan that has been removed."],
              ].map(([label,value,hint])=>{
                const n = Number(value);
                const bad = n>0;
                return (
                  <div key={label} style={{ padding:"12px 16px", borderRadius:10,
                    background: bad?"rgba(var(--danger-rgb),0.07)":"rgba(255,255,255,0.03)",
                    border: bad?"1px solid rgba(var(--danger-rgb),0.2)":"1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                      <span style={{ fontSize:14, fontWeight:600 }}>{label}</span>
                      <span style={{ fontWeight:800, fontSize:16, color:bad?"var(--danger)":"var(--success)", flexShrink:0 }}>
                        {value??"—"}
                      </span>
                    </div>
                    <div style={{ fontSize:12, opacity:0.4, marginTop:3 }}>{hint}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EXPORT ─────────────────────────────────────────────────────── */}
      {tab==="export" && (
        <div style={{ maxWidth:520 }}>
          <div style={{ opacity:0.5, fontSize:13, marginBottom:20 }}>
            Export data from your local database. CSV for analysis, or a shareable JSON that other Sentinel users can import directly.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

            {/* ── CSV Export ─────────────────────────────────────── */}
            <div style={{ padding:"14px 16px", borderRadius:10,
              background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>CSV Export</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Export type</div>
                  <select className="input" value={exportKind} onChange={e=>setExportKind(e.target.value)} style={{ width:"100%" }}>
                    <option value="players">Players — name, clan, mode, updated</option>
                    <option value="clans">Clans — name, tag, mode, updated</option>
                    <option value="history">Clan movement history — player, from, to, timestamp</option>
                    <option value="alerts">Alerts — type, entity, message, timestamps</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Row limit</div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <input className="input" type="number" min={1} max={500000} value={exportLimit}
                      onChange={e=>setExportLimit(e.target.value)} style={{ width:160 }} />
                    <span style={{ fontSize:12, opacity:0.4 }}>rows max</span>
                  </div>
                </div>
                <button className="btn btnPrimary" disabled={exportBusy} onClick={async()=>{
                  setExportBusy(true); setExportStatus("");
                  try{
                    const res=await api.exportCsv({kind:exportKind,limit:clampNum(exportLimit,1,500000)});
                    if (!res?.ok){ setExportStatus("Export failed."); return; }
                    const s=await api.saveTextFile(downloadName(`idleclans_${exportKind}`,"csv"), res.csv||"");
                    setExportStatus(s?.ok?`✓ Saved: ${s.path}`:"Save cancelled.");
                  }catch(e){ setExportStatus(String(e?.message||e)); }
                  finally{ setExportBusy(false); }
                }}>
                  {exportBusy?"Exporting…":"Export CSV"}
                </button>
              </div>
            </div>

            {/* ── Shareable JSON Export ───────────────────────────── */}
            <div style={{ padding:"14px 16px", borderRadius:10,
              background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontWeight:700, fontSize:14, marginBottom:2 }}>Shareable JSON</div>
              <div style={{ fontSize:12, opacity:0.4, marginBottom:10 }}>
                Exports a .json file other Sentinel users can import directly via the homepage uploader.
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Dataset</div>
                  <select className="input" value={exportJsonKind} onChange={e=>setExportJsonKind(e.target.value)} style={{ width:"100%" }}>
                    <option value="players">All players (names only)</option>
                    <option value="clans">All clans (names + tags)</option>
                    <option value="all">All players + clans combined</option>
                    <option value="flaggedPlayers">Flagged/tracked players only</option>
                    <option value="flaggedClans">Flagged/tracked clans only</option>
                    <option value="banned">Banned players only</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Row limit</div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <input className="input" type="number" min={1} max={500000} value={exportLimit}
                      onChange={e=>setExportLimit(e.target.value)} style={{ width:160 }} />
                    <span style={{ fontSize:12, opacity:0.4 }}>rows max</span>
                  </div>
                </div>
                <button className="btn btnPrimary" disabled={exportBusy} onClick={async()=>{
                  setExportBusy(true); setExportStatus("");
                  try{
                    const res=await api.exportShareableJson({kind:exportJsonKind,limit:clampNum(exportLimit,1,500000)});
                    if (!res?.ok){ setExportStatus(`Export failed: ${res?.error||"unknown"}`); return; }
                    const label = exportJsonKind==="all" ? "players_and_clans" : exportJsonKind;
                    const s=await api.saveTextFile(downloadName(`sentinel_${label}`,"json"), res.json||"");
                    setExportStatus(s?.ok?`✓ Saved: ${s.path}`:"Save cancelled.");
                  }catch(e){ setExportStatus(String(e?.message||e)); }
                  finally{ setExportBusy(false); }
                }}>
                  {exportBusy?"Exporting…":"Export JSON"}
                </button>
              </div>
            </div>
            {exportStatus && (
              <div style={{ fontSize:13, padding:"8px 12px", borderRadius:8,
                background: exportStatus.startsWith("✓")?"rgba(var(--success-rgb),0.1)":"rgba(255,255,255,0.05)",
                border: exportStatus.startsWith("✓")?"1px solid rgba(var(--success-rgb),0.25)":"1px solid rgba(255,255,255,0.08)",
                opacity:0.85 }}>
                {exportStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── NOT FOUND ──────────────────────────────────────────────────── */}
      {tab==="notFound" && (
        <div>
          {/* Header */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:20, flexWrap:"wrap",
            padding:"14px 16px", borderRadius:10,
            background:"rgba(var(--warning2-rgb),0.06)", border:"1px solid rgba(var(--warning2-rgb),0.18)" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:14, color:"var(--warning2)", marginBottom:4 }}>
                ⚠ Not Found (API 404)
              </div>
              <div style={{ fontSize:13, opacity:0.75, lineHeight:1.5 }}>
                These players and clans returned a 404 from the game API — they may have been deleted or renamed.
                They are automatically skipped by full scans and stale refresh. Use <b>Re-check</b> to test if they've
                come back (e.g. after a rename), or <b>Clear</b> to restore them to normal scanning.
              </div>
            </div>
            <button className="btn" onClick={loadNotFound} style={{ flexShrink:0 }}>Refresh</button>
          </div>

          {/* Kind toggle */}
          {notFoundData && (
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
              <div style={{ display:"flex", borderRadius:8, overflow:"hidden", border:"1px solid rgba(255,255,255,0.1)", flexShrink:0 }}>
                {[["players","Players",(notFoundData?.players||[]).length],["clans","Clans",(notFoundData?.clans||[]).length]].map(([id,label,count])=>(
                  <button key={id} onClick={()=>{ setNotFoundKind(id); setNotFoundPage(0); }} style={{
                    padding:"6px 16px", border:"none", cursor:"pointer", fontSize:13, fontWeight:600,
                    background: notFoundKind===id ? "rgba(var(--warning2-rgb),0.15)" : "transparent",
                    color: notFoundKind===id ? "var(--warning2)" : "rgba(255,255,255,0.45)",
                    borderRight: id==="players" ? "1px solid rgba(255,255,255,0.1)" : "none",
                  }}>
                    {label}
                    <span style={{ marginLeft:6, fontSize:11, opacity:0.7,
                      background:"rgba(255,255,255,0.08)", borderRadius:10, padding:"1px 6px" }}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
              <span style={{ fontSize:12, opacity:0.4 }}>
                Entities marked not-found are excluded from all automatic scanning until cleared or re-found.
              </span>
            </div>
          )}

          {/* Loading state */}
          {!notFoundData && <EmptyState message="Loading…" />}

          {/* Players list */}
          {notFoundData && notFoundKind==="players" && (
            (notFoundData.players||[]).length === 0
              ? <EmptyState message="No players marked as not found." />
              : (() => {
                  const all = notFoundData.players||[];
                  const page = notFoundPage;
                  const slice = all.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
                  return (
                    <>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {slice.map(r => {
                          const key = r.lowerName || r.entityLower;
                          const name = r.entityName || r.username || key;
                          const rowBusy = !!notFoundBusy[key];
                          return (
                            <div key={key} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px",
                              borderRadius:10, background:"rgba(var(--warning2-rgb),0.04)",
                              border:"1px solid rgba(var(--warning2-rgb),0.14)" }}>
                              <span style={{ fontSize:18, opacity:0.6, flexShrink:0 }}>👤</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  <Link to={`/players/${encodeURIComponent(name)}`} style={{ fontWeight:700 }}>{name}</Link>
                                  <span style={{ fontSize:11, fontWeight:700, padding:"1px 6px", borderRadius:4,
                                    background:"rgba(var(--warning2-rgb),0.15)", color:"var(--warning2)" }}>player</span>
                                  {r.gameMode && <span style={{ fontSize:11, opacity:0.5 }}>{modeLabel(r.gameMode)}</span>}
                                  {r.guildName && <span style={{ fontSize:11, opacity:0.5 }}>· {r.guildName}</span>}
                                </div>
                                <div style={{ fontSize:11, opacity:0.4, marginTop:3 }}>
                                  Marked not found: {fmtIso(r.notFoundAt)}
                                  {r.updatedAt && <> · Last good scan: {fmtIso(r.updatedAt)}</>}
                                </div>
                              </div>
                              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                                <button className="btn" disabled={rowBusy}
                                  style={{ fontSize:12, padding:"4px 10px" }}
                                  onClick={async()=>{
                                    setNotFoundBusy(b=>({...b,[key]:true}));
                                    try{
                                      const res = await api.recheckNotFoundEntity?.({ entityType:"player", name });
                                      await loadNotFound();
                                      if (res?.ok) toast.success(`${name} is back! Not-found mark cleared.`);
                                      else if (res?.notFound) toast.warning(`${name} still not found on the API.`);
                                    }catch(e){ toast.error(`Error: ${e?.message||e}`); }
                                    finally{ setNotFoundBusy(b=>({...b,[key]:false})); }
                                  }}>
                                  {rowBusy ? "Checking…" : "Re-check"}
                                </button>
                                <button className="btn" disabled={rowBusy}
                                  style={{ fontSize:12, padding:"4px 10px", opacity:0.7 }}
                                  onClick={async()=>{
                                    if (!confirm(`Clear not-found mark for ${name}?`)) return;
                                    setNotFoundBusy(b=>({...b,[key]:true}));
                                    try{
                                      await api.clearNotFoundEntity?.({ entityType:"player", name });
                                      await loadNotFound();
                                    }finally{ setNotFoundBusy(b=>({...b,[key]:false})); }
                                  }}>
                                  Clear
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <Paginator total={all.length} page={page} pageSize={PAGE_SIZE} onChange={setNotFoundPage} />
                    </>
                  );
                })()
          )}

          {/* Clans list */}
          {notFoundData && notFoundKind==="clans" && (
            (notFoundData.clans||[]).length === 0
              ? <EmptyState message="No clans marked as not found." />
              : (() => {
                  const allClans = notFoundData.clans||[];
                  const page = notFoundPage;
                  const slice = allClans.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);
                  return (
                    <>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {slice.map(r => {
                          const key = r.lowerName || r.entityLower;
                          const name = r.entityName || r.clanName || key;
                          const rowBusy = !!notFoundBusy[key];
                          return (
                            <div key={key} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px",
                              borderRadius:10, background:"rgba(var(--warning2-rgb),0.04)",
                              border:"1px solid rgba(var(--warning2-rgb),0.14)" }}>
                              <span style={{ fontSize:18, opacity:0.6, flexShrink:0 }}>🏰</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  <Link to={`/clans/${encodeURIComponent(name)}`} style={{ fontWeight:700 }}>{name}</Link>
                                  <span style={{ fontSize:11, fontWeight:700, padding:"1px 6px", borderRadius:4,
                                    background:"rgba(var(--warning2-rgb),0.15)", color:"var(--warning2)" }}>clan</span>
                                  {r.tag && <span style={{ fontSize:11, opacity:0.6, padding:"1px 6px",
                                    borderRadius:4, background:"rgba(255,255,255,0.07)" }}>{r.tag}</span>}
                                  {r.gameMode && <span style={{ fontSize:11, opacity:0.5 }}>{modeLabel(r.gameMode)}</span>}
                                </div>
                                <div style={{ fontSize:11, opacity:0.4, marginTop:3 }}>
                                  Marked not found: {fmtIso(r.notFoundAt)}
                                  {r.updatedAt && <> · Last good scan: {fmtIso(r.updatedAt)}</>}
                                </div>
                              </div>
                              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                                <button className="btn" disabled={rowBusy}
                                  style={{ fontSize:12, padding:"4px 10px" }}
                                  onClick={async()=>{
                                    setNotFoundBusy(b=>({...b,[key]:true}));
                                    try{
                                      const res = await api.recheckNotFoundEntity?.({ entityType:"clan", name });
                                      await loadNotFound();
                                      if (res?.ok) toast.success(`${name} is back! Not-found mark cleared.`);
                                      else if (res?.notFound) toast.warning(`${name} still not found on the API.`);
                                    }catch(e){ toast.error(`Error: ${e?.message||e}`); }
                                    finally{ setNotFoundBusy(b=>({...b,[key]:false})); }
                                  }}>
                                  {rowBusy ? "Checking…" : "Re-check"}
                                </button>
                                <button className="btn" disabled={rowBusy}
                                  style={{ fontSize:12, padding:"4px 10px", opacity:0.7 }}
                                  onClick={async()=>{
                                    if (!confirm(`Clear not-found mark for ${name}?`)) return;
                                    setNotFoundBusy(b=>({...b,[key]:true}));
                                    try{
                                      await api.clearNotFoundEntity?.({ entityType:"clan", name });
                                      await loadNotFound();
                                    }finally{ setNotFoundBusy(b=>({...b,[key]:false})); }
                                  }}>
                                  Clear
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <Paginator total={allClans.length} page={page} pageSize={PAGE_SIZE} onChange={setNotFoundPage} />
                    </>
                  );
                })()
          )}
        </div>
      )}

      {/* ── DORMANT ────────────────────────────────────────────────────────── */}
      {tab==="dormant" && (
        <div>
          <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:20, flexWrap:"wrap",
            padding:"14px 16px", borderRadius:10,
            background:"rgba(var(--warning2-rgb),0.06)", border:"1px solid rgba(var(--warning2-rgb),0.18)" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:14, color:"var(--warning2)", marginBottom:4 }}>
                💤 Dormant Players
              </div>
              <div style={{ fontSize:13, opacity:0.75, lineHeight:1.5 }}>
                These players were found offline for longer than the dormant threshold (set in <b>Settings → Automation</b>).
                They are <b>excluded from full scans and stale refresh</b> automatically.
                Use <b>Re-scan</b> to check if they've come back — if active again they return to normal scanning.
                Use <b>Clear</b> to manually restore without re-scanning.
              </div>
            </div>
            <div style={{ display:"flex", gap:8, flexShrink:0, alignItems:"flex-start" }}>
              <button className="btn" onClick={loadDormant}>Refresh</button>
              {(dormantRows||[]).length > 0 && (
                <button className="btn" disabled={dormantScanProgress.running}
                  onClick={async()=>{
                    const rows = dormantRows||[];
                    if (!confirm(`Re-scan all ${rows.length} dormant players?\n\nThis will use ${rows.length} API calls and may take a while.`)) return;
                    setDormantScanProgress({ running:true, done:0, total:rows.length });
                    try{
                      for (let i = 0; i < rows.length; i++){
                        const r = rows[i];
                        const ln = r.lowerName || r.username?.toLowerCase();
                        setDormantBusy(b=>({...b,[ln]:true}));
                        try{ await api.recheckDormantPlayer?.(r.username); }catch{}
                        setDormantBusy(b=>({...b,[ln]:false}));
                        setDormantScanProgress(p=>({ ...p, done: i + 1 }));
                      }
                      await loadDormant();
                    }finally{ setDormantScanProgress({ running:false, done:0, total:0 }); }
                  }}>
                  {dormantScanProgress.running
                    ? `Scanning ${dormantScanProgress.done} / ${dormantScanProgress.total}…`
                    : `Re-scan all (${dormantRows.length})`}
                </button>
              )}
            </div>
          </div>

          {dormantScanProgress.running && (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, opacity:0.6, marginBottom:5 }}>
                <span>Re-scanning dormant players…</span>
                <span>{dormantScanProgress.done.toLocaleString()} / {dormantScanProgress.total.toLocaleString()} ({Math.round((dormantScanProgress.done/Math.max(1,dormantScanProgress.total))*100)}%)</span>
              </div>
              <div style={{ height:6, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden" }}>
                <div style={{ width:`${Math.round((dormantScanProgress.done/Math.max(1,dormantScanProgress.total))*100)}%`,
                  height:"100%", background:"rgba(120,255,190,0.85)", borderRadius:999, transition:"width 0.3s ease" }} />
              </div>
              <div style={{ fontSize:11, opacity:0.35, marginTop:4 }}>
                Players that are active again will be removed from this list automatically.
              </div>
            </div>
          )}
          {dormantRows !== null && dormantRows.length === 0 && (
            <EmptyState message="No dormant players. Players are marked dormant automatically during scans when offline time exceeds the threshold." />
          )}
          {dormantRows !== null && dormantRows.length > 0 && (() => {
            const slice = dormantRows.slice(dormantPage*PAGE_SIZE, (dormantPage+1)*PAGE_SIZE);
            return (
              <>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {slice.map(r => {
                    const ln = r.lowerName || r.username?.toLowerCase();
                    const rowBusy = !!dormantBusy[ln];
                    const daysOff = Number(r.daysOffline);
                    return (
                      <div key={ln} style={{ display:"flex", alignItems:"center", gap:12,
                        padding:"11px 14px", borderRadius:10,
                        background:"rgba(var(--warning2-rgb),0.04)", border:"1px solid rgba(var(--warning2-rgb),0.14)" }}>
                        <span style={{ fontSize:18, opacity:0.6, flexShrink:0 }}>💤</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                            <Link to={`/players/${encodeURIComponent(r.username)}`} style={{ fontWeight:700 }}>{r.username}</Link>
                            {r.guildName && <span style={{ fontSize:11, opacity:0.5 }}>{r.guildName}</span>}
                            {Number.isFinite(daysOff) && (
                              <span style={{ fontSize:11, fontWeight:700, padding:"1px 7px", borderRadius:4,
                                background: daysOff>60?"rgba(var(--danger-rgb),0.15)":"rgba(var(--warning2-rgb),0.15)",
                                color:      daysOff>60?"var(--danger)":"var(--warning2)" }}>
                                {daysOff.toFixed(0)}d offline
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize:11, opacity:0.4, marginTop:3 }}>
                            Marked dormant: {fmtIso(r.dormantAt)}
                            {r.lastOnlineAt && <> · Last online: {fmtIso(r.lastOnlineAt)}</>}
                            {r.updatedAt    && <> · Last scanned: {fmtIso(r.updatedAt)}</>}
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          <button className="btn" disabled={rowBusy || dormantScanProgress.running}
                            style={{ fontSize:12, padding:"4px 10px" }}
                            onClick={async()=>{
                              setDormantBusy(b=>({...b,[ln]:true}));
                              try{
                                const res = await api.recheckDormantPlayer?.(r.username);
                                await loadDormant();
                                if (res?.ok) toast.success(`${r.username} is active again — restored to normal scanning.`);
                                else         toast.warning(`${r.username} is still offline.`);
                              }catch(e){ toast.error(`Error: ${e?.message||e}`); }
                              finally{ setDormantBusy(b=>({...b,[ln]:false})); }
                            }}>
                            {rowBusy ? "Scanning…" : "Re-scan"}
                          </button>
                          <button className="btn" disabled={rowBusy || dormantScanProgress.running}
                            style={{ fontSize:12, padding:"4px 10px", opacity:0.7 }}
                            onClick={async()=>{
                              if (!confirm(`Restore ${r.username} to normal scanning?`)) return;
                              setDormantBusy(b=>({...b,[ln]:true}));
                              try{
                                await api.clearDormantPlayer?.(r.username);
                                await loadDormant();
                              }finally{ setDormantBusy(b=>({...b,[ln]:false})); }
                            }}>
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Paginator total={dormantRows.length} page={dormantPage} pageSize={PAGE_SIZE} onChange={setDormantPage} />
              </>
            );
          })()}
        </div>
      )}

      {/* ── BACKUP & RESTORE ───────────────────────────────────────────── */}
      {tab==="backup" && (
        <div style={{ maxWidth:580 }}>
          <div style={{ padding:"10px 14px", marginBottom:20, borderRadius:8,
            background:"rgba(var(--warning2-rgb),0.07)", border:"1px solid rgba(var(--warning2-rgb),0.2)",
            fontSize:13, lineHeight:1.6 }}>
            <strong>Full database backup &amp; restore.</strong> Export saves every table to a single JSON file.
            Import loads it into the current database. Use this to recover from corruption or move data between machines.
            Tables that cannot be read due to corruption are skipped and listed in the results.
          </div>

          {/* Export */}
          <div style={{ padding:"16px 18px", borderRadius:10, marginBottom:16,
            background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>Export full backup</div>
            <div style={{ fontSize:12, opacity:0.45, marginBottom:14 }}>
              Reads every table and writes a single .json file. Corrupt tables are skipped automatically.
            </div>
            <button className="btn btnPrimary" disabled={backupBusy} style={{ minWidth:160 }}
              onClick={async()=>{
                setBackupBusy(true); setBackupStatus(null); setBackupProgress(null);
                const unsub = onBackupExportProgress(p => setBackupProgress(p));
                try{
                  const res = await api.exportFullBackup?.();
                  if (!res) return;
                  if (res.canceled){ return; }
                  if (!res.ok){ setBackupStatus({ ok:false, message: res?.error||"Export failed." }); return; }
                  setBackupStatus({
                    ok:true, message:`✓ Saved to ${res.destPath}`,
                    counts:res.counts, failedTables:res.failedTables, totalRows:res.totalRows,
                  });
                }catch(e){ setBackupStatus({ ok:false, message:String(e?.message||e) }); }
                finally{ unsub(); setBackupBusy(false); setBackupProgress(null); }
              }}>
              {backupBusy ? "Exporting..." : "Export full backup"}
            </button>

            {backupBusy && backupProgress && (
              <div style={{ marginTop:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, opacity:0.65, marginBottom:5 }}>
                  <span>Exporting <strong>{backupProgress.table}</strong>…</span>
                  <span>{(backupProgress.totalRows||0).toLocaleString()} rows written</span>
                </div>
                <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:999, background:"var(--accent,#60a5fa)",
                    width:"100%", opacity:0.7,
                    animation:"pulse 1.5s ease-in-out infinite",
                  }}/>
                </div>
                <div style={{ fontSize:11, opacity:0.35, marginTop:4 }}>
                  The app stays fully usable while the export runs in the background.
                </div>
              </div>
            )}
            {backupBusy && !backupProgress && (
              <div style={{ marginTop:10, fontSize:12, opacity:0.45 }}>Starting export…</div>
            )}
            {backupStatus && (
              <div style={{ marginTop:12, padding:"10px 13px", borderRadius:8, fontSize:13,
                background:backupStatus.ok?"rgba(var(--success-rgb),0.08)":"rgba(var(--danger-rgb),0.08)",
                border:backupStatus.ok?"1px solid rgba(var(--success-rgb),0.2)":"1px solid rgba(var(--danger-rgb),0.2)" }}>
                <div style={{ fontWeight:600, marginBottom:backupStatus.counts?8:0 }}>{backupStatus.message}</div>
                {backupStatus.counts && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 14px", fontSize:12, opacity:0.75 }}>
                    {Object.entries(backupStatus.counts).filter(([,n])=>n>0).map(([t,n])=>(
                      <span key={t}><strong>{n.toLocaleString()}</strong> {t}</span>
                    ))}
                  </div>
                )}
                {backupStatus.failedTables?.length>0 && (
                  <div style={{ marginTop:6, fontSize:12, color:"var(--warning2)" }}>
                    Skipped (corrupt): {backupStatus.failedTables.join(", ")}
                  </div>
                )}
                {backupStatus.totalRows>0 && (
                  <div style={{ marginTop:4, fontSize:12, opacity:0.5 }}>
                    {backupStatus.totalRows.toLocaleString()} total rows exported
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Import */}
          <div style={{ padding:"16px 18px", borderRadius:10,
            background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>Import from backup</div>
            <div style={{ fontSize:12, opacity:0.45, marginBottom:6 }}>
              Loads a backup JSON into the current database using INSERT OR REPLACE.
              Safe to run on top of an existing DB — existing rows are updated, new ones added.
            </div>
            <div style={{ fontSize:12, marginBottom:14, padding:"8px 11px", borderRadius:6,
              background:"rgba(var(--danger-rgb),0.06)", border:"1px solid rgba(var(--danger-rgb),0.15)",
              color:"var(--danger)", fontWeight:600 }}>
              For a clean restore: use Delete all data in Settings first, then import here.
              Otherwise existing and restored data will be merged.
            </div>
            <button className="btn" disabled={importBusy} style={{ minWidth:180 }}
              onClick={async()=>{
                setImportBusy(true); setImportStatus(null); setImportProgress(null);
                const unsub = onBackupImportProgress(p => setImportProgress(p));
                try{
                  const file = await api.pickImportFile?.();
                  if (!file?.path){ return; }
                  const res = await api.importFullBackupFromPath?.({ path:file.path });
                  if (!res?.ok){ setImportStatus({ ok:false, message:res?.error||"Import failed." }); return; }
                  setImportStatus({
                    ok:true,
                    message:`Import complete — ${(res.totalInserted||0).toLocaleString()} rows restored`,
                    results:res.results, failedTables:res.failedTables, exportedAt:res.exportedAt,
                  });
                }catch(e){ setImportStatus({ ok:false, message:String(e?.message||e) }); }
                finally{ unsub(); setImportBusy(false); setImportProgress(null); }
              }}>
              {importBusy ? "Importing..." : "Pick backup file & import"}
            </button>

            {importBusy && importProgress && (
              <div style={{ marginTop:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, opacity:0.65, marginBottom:5 }}>
                  <span>Importing <strong>{importProgress.table}</strong>…</span>
                  <span>{(importProgress.totalInserted||0).toLocaleString()} rows inserted</span>
                </div>
                <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:999, background:"var(--accent,#60a5fa)",
                    width:"100%", opacity:0.7, animation:"pulse 1.5s ease-in-out infinite" }}/>
                </div>
                <div style={{ fontSize:11, opacity:0.35, marginTop:4 }}>
                  The app stays usable while the import runs.
                </div>
              </div>
            )}
            {importBusy && !importProgress && (
              <div style={{ marginTop:10, fontSize:12, opacity:0.45 }}>Starting import…</div>
            )}
            {importStatus && (
              <div style={{ marginTop:12, padding:"10px 13px", borderRadius:8, fontSize:13,
                background:importStatus.ok?"rgba(var(--success-rgb),0.08)":"rgba(var(--danger-rgb),0.08)",
                border:importStatus.ok?"1px solid rgba(var(--success-rgb),0.2)":"1px solid rgba(var(--danger-rgb),0.2)" }}>
                <div style={{ fontWeight:600, marginBottom:importStatus.results?8:0 }}>{importStatus.message}</div>
                {importStatus.exportedAt && (
                  <div style={{ fontSize:12, opacity:0.55, marginBottom:6 }}>Backup from: {fmtIso(importStatus.exportedAt)}</div>
                )}
                {importStatus.results && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 14px", fontSize:12, opacity:0.75 }}>
                    {Object.entries(importStatus.results).filter(([,n])=>n>0).map(([t,n])=>(
                      <span key={t}><strong>{n.toLocaleString()}</strong> {t}</span>
                    ))}
                  </div>
                )}
                {importStatus.failedTables?.length>0 && (
                  <div style={{ marginTop:6, fontSize:12, color:"var(--warning2)" }}>
                    Failed tables: {importStatus.failedTables.join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
