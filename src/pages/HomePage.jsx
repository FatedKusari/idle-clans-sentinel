import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, onBulkScanProgress, onImportProgress } from "../lib/bridge.js";
import { useToast } from "../components/Toast.jsx";
import { modeLabel, formatAgo, formatBytes } from "../lib/format.js";

// ── tiny shared pieces ────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, onClick, accent }){
  return (
    <div onClick={onClick} style={{
      background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:12, padding:"16px 18px", cursor: onClick?"pointer":undefined,
      transition:"background 0.1s",
      ...(accent ? { borderColor:`${accent}30`, background:`${accent}08` } : {}),
    }}
      onMouseEnter={e=>{ if(onClick) e.currentTarget.style.background=accent?`${accent}12`:"rgba(255,255,255,0.05)"; }}
      onMouseLeave={e=>{ if(onClick) e.currentTarget.style.background=accent?`${accent}08`:"rgba(255,255,255,0.03)"; }}
    >
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", opacity:0.45 }}>{label}</span>
      </div>
      <div style={{ fontSize:26, fontWeight:800, lineHeight:1, color: accent||"inherit" }}>{value}</div>
      {sub && <div style={{ fontSize:12, opacity:0.4, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }){
  return (
    <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase", opacity:0.35, marginBottom:10 }}>
      {children}
    </div>
  );
}

function KV({ label, value, mono, titleText }){
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:12, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize:12, opacity:0.5 }} title={titleText}>{label}</span>
      <span style={{ fontSize:12, fontWeight:600, fontFamily: mono?"ui-monospace,monospace":undefined, opacity:0.85, textAlign:"right", maxWidth:"60%", wordBreak:"break-all" }}>{value}</span>
    </div>
  );
}

function Divider(){ return <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"12px 0" }} />; }

// ── helpers ───────────────────────────────────────────────────────────────────


function formatDuration(ms){
  if (!isFinite(ms)||ms<0) return "—";
  const s=Math.round(ms/1000), hh=Math.floor(s/3600), mm=Math.floor((s%3600)/60), ss=s%60;
  if (hh>0) return `${hh}h ${mm.toString().padStart(2,"0")}m`;
  if (mm>0) return `${mm}m ${ss.toString().padStart(2,"0")}s`;
  return `${ss}s`;
}




// ── Game events ───────────────────────────────────────────────────────────────
//
// Static display metadata (name + icon) keyed by the game's EventType id.
// Dates, durations, and XP bonuses come from idleclans-game-data.json
// (HolidayEvents) via gameData:getEvents, refreshed hourly. The hardcoded
// month/day/duration values below are only a fallback for the (unlikely)
// case the game data hasn't loaded yet.
const EVENT_META = {
  3: { key:"valentine", name:"Valentine's",  img:"events/valentines.png", fallback:{ month:2,  day:11, durationDays:14, bonus:"+25% XP" } },
  4: { key:"birthday",  name:"Anniversary",  img:"events/birthday.png",   fallback:{ month:4,  day:7,  durationDays:7,  bonus:"+25% XP" } },
  5: { key:"beach",     name:"Beach Party",  img:"events/beach.png",      fallback:{ month:7,  day:25, durationDays:14, bonus:"+25% XP" } },
  1: { key:"halloween", name:"Halloween",    img:"events/halloween.png",  fallback:{ month:10, day:24, durationDays:14, bonus:"+25% XP" } },
  2: { key:"christmas", name:"Christmas",    img:"events/christmas.png",  fallback:{ month:12, day:17, durationDays:14, bonus:"+25% XP" } },
};

// Static fallback list, used only until live event data arrives (or if it
// never does). Mirrors the previous hardcoded behaviour.
const FALLBACK_EVENTS = Object.entries(EVENT_META).map(([eventType, m]) => ({
  key: m.key, name: m.name, img: m.img,
  month: m.fallback.month, day: m.fallback.day, hour: 10, minute: 0,
  durationDays: m.fallback.durationDays, bonus: m.fallback.bonus,
}));

// Converts a raw HolidayEvents entry (from gameData:getEvents) into the
// shape the pill/tooltip rendering expects. Falls back to EVENT_META's
// static values for fields not present in game data.
function normalizeLiveEvent(raw){
  const meta = EVENT_META[raw.eventType];
  if (!meta) return null; // unknown event type — skip rather than show garbage

  const start = new Date(0, raw.startMonth - 1, raw.startDay, raw.startHour ?? 10, raw.startMinute ?? 0);
  const end   = new Date(0, raw.endMonth   - 1, raw.endDay,   raw.endHour   ?? 10, raw.endMinute   ?? 0);
  let durationDays = Math.round((end - start) / 86400000);
  if (!Number.isFinite(durationDays) || durationDays <= 0) durationDays = meta.fallback.durationDays;

  const bonus = raw.maxXpBoost > 0 ? `+${raw.maxXpBoost}% XP` : meta.fallback.bonus;

  return {
    key: meta.key, name: meta.name, img: meta.img,
    month: raw.startMonth, day: raw.startDay,
    hour: raw.startHour ?? 10, minute: raw.startMinute ?? 0,
    durationDays, bonus,
  };
}

// Computes the active or next-upcoming event from a list of { month, day, hour, minute, durationDays, ... }.
function getNextEvent(events) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const upcoming = [];
  for (const ev of events) {
    for (const yr of [thisYear, thisYear + 1]) {
      const start = new Date(yr, ev.month - 1, ev.day, ev.hour ?? 10, ev.minute ?? 0);
      const end   = new Date(start.getTime() + ev.durationDays * 86400000);
      upcoming.push({ ...ev, start, end, isActive: now >= start && now < end });
    }
  }
  upcoming.sort((a, b) => a.start - b.start);
  const active = upcoming.find(e => e.isActive);
  if (active) return { ...active, status:"active" };
  const next = upcoming.find(e => e.start > now);
  return next ? { ...next, status:"upcoming" } : null;
}

// Hook: fetches the holiday event schedule from game data on mount and
// refreshes it hourly. Falls back to FALLBACK_EVENTS until live data
// arrives or if the fetch fails / returns nothing usable.
function useGameEvents(){
  const [events, setEvents] = useState(FALLBACK_EVENTS);

  useEffect(() => {
    let cancelled = false;

    async function refresh(){
      try{
        const res = await api.getGameDataEvents?.();
        if (cancelled) return;
        const live = (res?.events || [])
          .map(normalizeLiveEvent)
          .filter(Boolean);
        if (live.length) setEvents(live);
        // If live data is empty/unavailable, keep showing FALLBACK_EVENTS
        // (already the initial state) rather than clearing the schedule.
      } catch {
        // Network/IPC error — keep current (fallback or last-known) events.
      }
    }

    refresh();
    const id = setInterval(refresh, 60 * 60 * 1000); // hourly
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return events;
}

function EventPill() {
  const events = useGameEvents();
  const ev = useMemo(() => getNextEvent(events), [events]);
  const [tooltip, setTooltip] = React.useState(false);
  if (!ev) return null;

  const isActive = ev.status === "active";
  const refDate  = isActive ? ev.end : ev.start;
  const diffDays = Math.ceil((refDate - Date.now()) / 86400000);
  const timeStr  = diffDays <= 1  ? "today"
    : diffDays <= 7  ? "in " + diffDays + "d"
    : diffDays <= 31 ? "in " + Math.round(diffDays / 7) + "wk"
    : ev.start.toLocaleDateString(undefined, { month:"short", day:"numeric" });

  const pillLabel = isActive
    ? ev.name + " — ends " + timeStr
    : ev.name + " — " + timeStr;

  return (
    <div style={{ position:"relative", display:"inline-block" }}
      onMouseEnter={() => setTooltip(true)}
      onMouseLeave={() => setTooltip(false)}
    >
      <div style={{
        display:"flex", alignItems:"center", gap:6,
        padding:"5px 10px", borderRadius:999,
        background: isActive ? "rgba(var(--warning2-rgb),0.15)" : "rgba(255,255,255,0.07)",
        border: isActive ? "1px solid rgba(var(--warning2-rgb),0.4)" : "1px solid rgba(255,255,255,0.12)",
        fontSize:12, fontWeight:600, cursor:"default",
        color: isActive ? "var(--warning2)" : "rgba(255,255,255,0.65)",
      }}>
        <img src={ev.img} alt={ev.name} style={{ width:16, height:16, objectFit:"contain" }} />
        <span>{pillLabel}</span>
        {isActive && (
          <span style={{ fontSize:10, fontWeight:700, background:"rgba(var(--warning2-rgb),0.3)", borderRadius:4, padding:"1px 5px" }}>
            LIVE
          </span>
        )}
      </div>
      {tooltip && (
        <div style={{
          position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:100,
          background:"#0f2d1f", border:"1px solid rgba(255,255,255,0.15)",
          borderRadius:10, padding:"10px 14px", width:280,
          boxShadow:"0 8px 24px rgba(0,0,0,0.5)",
          fontSize:12, lineHeight:1.6,
        }}>
          {/* Current / next event detail */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <img src={ev.img} alt={ev.name} style={{ width:28, height:28, objectFit:"contain" }} />
            <div>
              <div style={{ fontWeight:700, fontSize:13 }}>{ev.name}</div>
              <div style={{ opacity:0.5 }}>{isActive ? "Active now" : "Upcoming"}</div>
            </div>
            {isActive && <span style={{ marginLeft:"auto", fontSize:10, fontWeight:700, background:"rgba(var(--warning2-rgb),0.3)", borderRadius:4, padding:"1px 5px", color:"var(--warning2)" }}>LIVE</span>}
          </div>
          <div style={{ opacity:0.7, marginBottom:2 }}>Starts: {ev.start.toLocaleDateString(undefined, { month:"short", day:"numeric" })}</div>
          <div style={{ opacity:0.7, marginBottom:2 }}>Duration: {ev.durationDays} days · Bonus: {ev.bonus}</div>

          {/* All events schedule */}
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.08)", margin:"10px 0 8px", paddingTop:8 }}>
            <div style={{ fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
              All events
            </div>
            {events.map(e => {
              const now2 = new Date();
              const yr = now2.getFullYear();
              const s = new Date(yr, e.month - 1, e.day, e.hour ?? 10, e.minute ?? 0);
              const end2 = new Date(s.getTime() + e.durationDays * 86400000);
              const active2 = now2 >= s && now2 < end2;
              const upcoming2 = s > now2;
              const dateLabel = s.toLocaleDateString(undefined, { month:"short", day:"numeric" });
              return (
                <div key={e.key} style={{
                  display:"flex", alignItems:"center", gap:8, padding:"4px 0",
                  borderBottom:"1px solid rgba(255,255,255,0.04)",
                  opacity: active2 ? 1 : upcoming2 ? 0.8 : 0.4,
                }}>
                  <img src={e.img} alt={e.name} style={{ width:16, height:16, objectFit:"contain", flexShrink:0 }} />
                  <span style={{ flex:1, fontWeight: active2 ? 700 : 500 }}>{e.name}</span>
                  <span style={{ opacity:0.55, fontSize:11, whiteSpace:"nowrap" }}>
                    {active2 ? "Active" : dateLabel}
                  </span>
                  <span style={{ fontSize:10, opacity:0.45, whiteSpace:"nowrap" }}>{e.durationDays}d</span>
                </div>
              );
            })}
          </div>

          <div style={{ opacity:0.3, fontSize:11, paddingTop:4 }}>
            Dates are estimates · times around 10am
          </div>
        </div>
      )}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function HomePage(){
  const toast = useToast();
  const nav = useNavigate();

  const [counts,      setCounts]      = useState({ players:0, clans:0, bannedPlayers:0, playersByMode:{}, clansByMode:{} });
  const [serverInfo,  setServerInfo]  = useState({ loading:true, ok:false, data:null, error:null, lastAt:null });
  const [serverSettings,setServerSettings]=useState({ enabled:true, pollSeconds:60, showAddresses:false, newsPollHours:6 });
  const [serverPopStats,setServerPopStats]=useState({ loading:false, ok:false, data:null });
  const [showAllServers,setShowAllServers]=useState(false);
  const [dbInfo,      setDbInfo]      = useState({ path:"", sizeBytes:0 });
  const [showModes,   setShowModes]   = useState(false);
  const [openCases,   setOpenCases]   = useState(0);

  // ── scan state ─────────────────────────────────────────────────────────────
  const [bulk,        setBulk]        = useState({ running:false, done:0, total:0, current:null, canceled:false, error:null });
  const [bulkMeta,    setBulkMeta]    = useState({ startedAt:null, callsPerMin:null, minDelayMs:null });
  const [skipScanned, setSkipScanned] = useState(()=>{ try{return localStorage.getItem("scanAllSkipScanned")!=="0";}catch{return true;} });
  const [includeClanMembers,setIncludeClanMembers]=useState(()=>{ try{return localStorage.getItem("scanAllIncludeClanMembers")==="1";}catch{return false;} });
  const [staleDays,   setStaleDays]   = useState(()=>{ try{return Number(localStorage.getItem("scanStaleDays")||7);}catch{return 7;} });
  const [staleIncludeClans,setStaleIncludeClans]=useState(()=>{ try{return localStorage.getItem("scanStaleIncludeClans")!=="0";}catch{return true;} });
  const [staleCounts, setStaleCounts] = useState(null);
  const [staleCountLoading,setStaleCountLoading]=useState(false);
  const [newsLatest,    setNewsLatest]    = useState(null);
  const [newsAll,       setNewsAll]       = useState([]);
  const [newsIdx,       setNewsIdx]       = useState(0);
  const [newsOpen,      setNewsOpen]      = useState(false);
  const [newsLoading,   setNewsLoading]   = useState(false);

  // persist scan prefs
  useEffect(()=>{ try{localStorage.setItem("scanAllSkipScanned",skipScanned?"1":"0");}catch{} },[skipScanned]);
  useEffect(()=>{ try{localStorage.setItem("scanAllIncludeClanMembers",includeClanMembers?"1":"0");}catch{} },[includeClanMembers]);
  useEffect(()=>{ try{localStorage.setItem("scanStaleDays",String(staleDays));}catch{} },[staleDays]);
  useEffect(()=>{ try{localStorage.setItem("scanStaleIncludeClans",staleIncludeClans?"1":"0");}catch{} },[staleIncludeClans]);

  async function loadStaleCounts(){
    setStaleCountLoading(true);
    try{ const r=await api.getStaleEntities?.({staleDays,limit:999999}); if(r) setStaleCounts({players:r.players?.length||0,clans:r.clans?.length||0}); }
    catch{} finally{ setStaleCountLoading(false); }
  }

  // bulk scan progress
  useEffect(()=>{
    return onBulkScanProgress?.((p)=>{
      if (!p) return;
      setBulk(prev=>({ ...prev, running:!!p.running, done:Number(p.done||0), total:Number(p.total||0), current:p.current??null, canceled:!!p.canceled, error:p.error??null }));
      setBulkMeta(m=>({ startedAt:p.startedAt??m.startedAt, callsPerMin:p.callsPerMin??m.callsPerMin, minDelayMs:p.minDelayMs??m.minDelayMs }));
    });
  },[]);

  const bulkPct = useMemo(()=>{ const t=Number(bulk.total||0),d=Number(bulk.done||0); return t?Math.max(0,Math.min(100,Math.round((d/t)*100))):0; },[bulk.total,bulk.done]);

  const etaText = useMemo(()=>{
    if (!bulk.running||!bulk.total) return null;
    const remaining=Math.max(0,bulk.total-(bulk.done||0));
    if (!remaining) return "0s";
    if (bulkMeta.startedAt&&bulk.done>=5){ const avg=(Date.now()-bulkMeta.startedAt)/Math.max(1,bulk.done); return formatDuration(avg*remaining); }
    if (bulkMeta.minDelayMs) return formatDuration(remaining*2*bulkMeta.minDelayMs);
    return null;
  },[bulk.running,bulk.total,bulk.done,bulkMeta.startedAt,bulkMeta.minDelayMs]);

  const currentLabel = useMemo(()=>{
    const c=bulk.current; if (!c?.name) return null;
    if (c.entityType==="clan") return `Clan: ${c.name}`;
    return c.contextClan ? `${c.contextClan} › ${c.name}` : `Player: ${c.name}`;
  },[bulk.current]);

  // initial data — run everything in parallel instead of sequentially
  useEffect(()=>{
    (async()=>{
      // Fire all independent startup fetches concurrently
      const [countsRes, dbInfoRes, settingsRes] = await Promise.allSettled([
        api.getCounts(),
        api.getDbInfo(),
        api.getSettings(),
      ]);
      if (countsRes.status==="fulfilled" && countsRes.value) setCounts(countsRes.value);
      if (dbInfoRes.status==="fulfilled"  && dbInfoRes.value)  setDbInfo(dbInfoRes.value);
      if (settingsRes.status==="fulfilled" && settingsRes.value){
        const s = settingsRes.value;
        const showAddresses=("serverInfoShowAddresses" in (s||{}))?(String(s.serverInfoShowAddresses??"0")!=="0"):(String(s.serverInfoMaskIp??"1")==="0");
        setServerSettings({ enabled:String(s.serverInfoEnabled??"1")!=="0", pollSeconds:Math.max(10,Math.min(3600,Number(s.serverInfoPollSeconds??60)||60)), showAddresses, newsPollHours:Math.max(0,Number(s.newsPollHours??6)) });
      }

      // Lower priority: open cases, stale counts, news — don't block the UI
      Promise.allSettled([
        (window?.idleclans?.listCases?.()??Promise.resolve([])).then(list=>{
          setOpenCases(Array.isArray(list)?list.filter(c=>c.status==="open").length:0);
        }),
        loadStaleCounts(),
        (async()=>{
          try{
            setNewsLoading(true);
            const [r, stored] = await Promise.all([
              api.newsFetchLatest?.(),
              api.newsList?.(100, 0),
            ]);
            if (r?.latest) setNewsLatest(r.latest);
            if (stored?.rows?.length){ setNewsAll(stored.rows); setNewsIdx(0); }
          }finally{ setNewsLoading(false); }
        })(),
      ]);
    })();
  },[]);

  // server polling
  useEffect(()=>{
    let alive=true, timer=null;
    async function tick(){
      if (!serverSettings.enabled) return;
      try{
        setServerInfo(s=>({...s,loading:true}));
        const data=await api.getServerInfo?.();
        if (!alive) return;
        setServerInfo({loading:false,ok:true,data,error:null,lastAt:new Date().toISOString()});
        try{
          const stats=await api.getServerPopulationStats?.({days:60});
          if (!alive) return;
          setServerPopStats({loading:false,ok:true,data:stats});
        }catch{ if(!alive) return; setServerPopStats({loading:false,ok:false,data:null}); }
      }catch(e){ if(!alive) return; setServerInfo({loading:false,ok:false,data:null,error:String(e?.message||e),lastAt:new Date().toISOString()}); }
    }
    tick();
    if (serverSettings.enabled) timer=setInterval(tick,Math.max(10,Number(serverSettings.pollSeconds||60))*1000);
    return ()=>{ alive=false; if(timer) clearInterval(timer); };
  },[serverSettings.enabled,serverSettings.pollSeconds]);

  // news polling — interval driven by Settings → newsPollHours (0 = manual only)
  useEffect(()=>{
    if (!serverSettings.newsPollHours || serverSettings.newsPollHours <= 0) return;
    const ms = serverSettings.newsPollHours * 60 * 60 * 1000;
    const timer = setInterval(async()=>{
      try{
        const r = await api.newsFetchLatest?.();
        if (r?.latest) setNewsLatest(r.latest);
        const stored = await api.newsList?.(100, 0);
        if (stored?.rows?.length){ setNewsAll(stored.rows); setNewsIdx(0); }
      }catch{}
    }, ms);
    return ()=>clearInterval(timer);
  }, [serverSettings.newsPollHours]); // eslint-disable-line

  // refresh counts after scan
  useEffect(()=>{
    if (!bulk.running&&bulk.total>0){ (async()=>{ try{setCounts(await api.getCounts());}catch{} })(); }
  },[bulk.running,bulk.total]);

  // live-refresh dbInfo every 10s so "last write" / "last backup" stay current without navigating away.
  // getCountsFast only re-reads 3 indexed counts (players/clans/banned) — avoids the expensive
  // GROUP BY gameMode scans that getCounts does. Full getCounts is done once on mount + after scans.
  useEffect(()=>{
    const t = setInterval(async()=>{
      try{
        const [dbInfoRes, fastCounts] = await Promise.allSettled([
          api.getDbInfo(),
          api.getCountsFast?.(),
        ]);
        if (dbInfoRes.status==="fulfilled")  setDbInfo(dbInfoRes.value);
        if (fastCounts.status==="fulfilled" && fastCounts.value){
          // Merge fast counts into existing counts (preserve playersByMode/clansByMode)
          setCounts(prev => prev ? { ...prev, ...fastCounts.value } : fastCounts.value);
        }
      }catch{}
    }, 10000);
    return ()=> clearInterval(t);
  },[]);

  // ── scan helpers ───────────────────────────────────────────────────────────
  async function doScanAll(){ try{ setBulk({running:true,done:0,total:0,current:null}); await api.scanAll({includePlayers:true,includeClans:true,includeClanMembers:!!includeClanMembers,skipPreviouslyScanned:!!skipScanned}); }catch(e){toast.error(String(e?.message||e));} }
  async function doScanPlayers(){ try{ setBulk({running:true,done:0,total:0,current:null}); await api.scanPlayersOnly({skipPreviouslyScanned:!!skipScanned}); }catch(e){toast.error(String(e?.message||e));} }
  async function doScanClans(){ try{ setBulk({running:true,done:0,total:0,current:null}); await api.scanClansWithMembers({skipPreviouslyScanned:!!skipScanned}); }catch(e){toast.error(String(e?.message||e));} }
  async function doScanStale(){ try{ setBulk({running:true,done:0,total:0,current:null,canceled:false,error:null}); await api.scanStale({staleDays:Number(staleDays)||7,includeClans:!!staleIncludeClans,limit:999999}); setStaleCounts(null); }catch(e){toast.error(String(e?.message||e));} }
  async function doCancel(){ try{await api.cancelScanAll();}catch{} }

  // ── server info helpers ────────────────────────────────────────────────────
  const serverData = useMemo(()=>{
    const startup=serverInfo.data||null;
    const si=startup?.serverInfo??startup;
    const bvi=startup?.buildVersionInfo??null;
    const all=Array.isArray(si?.allServers)?si.allServers:[];
    const recAddr=String(si?.recommendedServerAddress||"");
    const recServer=all.find(s=>String(s?.address||"")==recAddr)||null;
    return { si, bvi, all, recAddr, recServer };
  },[serverInfo.data]);

  // ── graph export (unchanged logic) ────────────────────────────────────────
  async function exportPopGraph(){
    try{
      const st=serverPopStats?.data;
      const daily=Array.isArray(st?.daily)?st.daily:[];
      if (!daily.length) return;
      const last=daily.slice(-90).map(d=>({day:String(d.day||""),avg:Number(d.avgPlayers||0)})).filter(d=>d.day);
      const fmt=(iso)=>new Date(iso+"T00:00:00Z").toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"});
      const rangeText=last.length?`${fmt(last[0].day)} – ${fmt(last[last.length-1].day)}`:"";
      const W=1360,H=560,M={l:80,r:40,t:30,b:70};
      const innerW=W-M.l-M.r,innerH=H-M.t-M.b;
      const vals=last.map(d=>d.avg),vMin=Math.min(...vals),vMax=Math.max(...vals);
      const pad=(vMax-vMin)===0?Math.max(10,vMax*0.05):(vMax-vMin)*0.08;
      const yMin=Math.max(0,vMin-pad),yMax=vMax+pad;
      const xFor=(i)=>M.l+(last.length===1?innerW/2:(i/(last.length-1))*innerW);
      const yFor=(v)=>M.t+(1-((v-yMin)/(yMax-yMin)))*innerH;
      const path=last.map((d,i)=>`${i===0?"M":"L"}${xFor(i).toFixed(2)} ${yFor(d.avg).toFixed(2)}`).join(" ");
      const ticks=Array.from({length:6},(_,i)=>yMin+(i/5)*(yMax-yMin));
      const every=Math.max(1,Math.round(last.length/6));
      const svg=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="clip"><rect x="${M.l}" y="${M.t}" width="${innerW}" height="${innerH}" rx="8"/></clipPath></defs>
  ${ticks.map(t=>`<line x1="${M.l}" y1="${yFor(t).toFixed(2)}" x2="${M.l+innerW}" y2="${yFor(t).toFixed(2)}" stroke="#e9edf1" stroke-width="1"/>
  <text x="${M.l-12}" y="${(yFor(t)+4).toFixed(2)}" text-anchor="end" font-size="12" fill="#44505c">${Math.round(t).toLocaleString()}</text>`).join("")}
  <line x1="${M.l}" y1="${(M.t+innerH).toFixed(2)}" x2="${M.l+innerW}" y2="${(M.t+innerH).toFixed(2)}" stroke="#dfe6ee" stroke-width="1"/>
  ${last.map((d,i)=>{ if(i%every!==0&&i!==last.length-1) return ""; const dt=new Date(d.day+"T00:00:00Z"); return `<text x="${xFor(i).toFixed(2)}" y="${(M.t+innerH+36).toFixed(2)}" text-anchor="middle" font-size="12" fill="#44505c">${dt.toLocaleDateString(undefined,{day:"2-digit",month:"short"})}</text>`; }).join("")}
  <g clip-path="url(#clip)"><path d="${path}" fill="none" stroke="#0b6b3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
  ${last.length?`<circle cx="${xFor(last.length-1).toFixed(2)}" cy="${yFor(last[last.length-1].avg).toFixed(2)}" r="5" fill="#0b6b3a"/>`:""}</svg>`;
      const html=`<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;padding:0;width:1600px;height:900px;overflow:hidden;background:#fff;font-family:system-ui,sans-serif}.page{width:1600px;height:900px;box-sizing:border-box;padding:56px 72px 44px;background:#fff;color:#101418;position:relative}.header{display:flex;align-items:center;gap:18px}.logo{width:64px;height:64px;border-radius:16px;overflow:hidden}.logo img{width:64px;height:64px;object-fit:contain}.hgroup{display:flex;flex-direction:column;gap:6px}.title{font-size:34px;font-weight:850;margin:0}.sub{font-size:14px;color:#5a6672}.panel{margin-top:26px;border:1px solid #e7edf3;border-radius:18px;padding:22px;background:#f7f9fb}.footer{position:absolute;right:72px;bottom:22px;font-size:12px;color:#8a96a3}</style></head><body><div class="page"><div class="header"><div class="logo"><!--LOGO--></div><div class="hgroup"><h1 class="title">IdleClans – Daily Average Online Players</h1><div class="sub">${rangeText}</div></div></div><div class="panel">${svg}</div><div class="footer">Generated by IdleClans Sentinel</div></div></body></html>`;
      const res=await api.exportHtml?.("idleclans-daily-average-players.png",html,"png");
      if (!res?.ok&&!res?.canceled) toast.error(res?.error||"Export failed");
    }catch(err){ toast.error(String(err?.message||err)); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── NEWS OVERLAY ─────────────────────────────────────────────────── */}
      {newsOpen && (newsAll[newsIdx] || newsLatest) && (()=>{
        const item = (()=>{
          const raw = newsAll[newsIdx] || newsLatest;
          if (!raw) return raw;
          // Parse linkUrl from rawJson if not directly available
          let linkUrl = raw.linkUrl || null;
          if (!linkUrl && raw.rawJson){
            try{ const p=JSON.parse(raw.rawJson); linkUrl = p?.linkUrl||p?.link||p?.url||null; }catch{}
          }
          return { ...raw, linkUrl: linkUrl||null };
        })();
        function fmtNewsDate(ts){ if(!ts) return ""; const d=new Date(ts); return isFinite(d)?d.toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}):ts; }
        return (
          <div style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,0.6)",
            display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
            onClick={e=>{ if(e.target===e.currentTarget) setNewsOpen(false); }}>
            <div style={{ width:"min(680px,100%)", background:"linear-gradient(180deg,#0d2a1d,#071810)",
              border:"1px solid rgba(255,255,255,0.12)", borderRadius:18,
              boxShadow:"0 24px 64px rgba(0,0,0,0.55)", overflow:"hidden" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"14px 20px", borderBottom:"1px solid rgba(255,255,255,0.08)",
                background:"rgba(0,0,0,0.2)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:11, fontWeight:700, opacity:0.45, textTransform:"uppercase", letterSpacing:"0.07em" }}>Game News</span>
                  {item.category && <span style={{ fontSize:11, padding:"2px 8px", borderRadius:5, fontWeight:700, background:"rgba(var(--info-rgb),0.15)", color:"var(--info)" }}>{item.category}</span>}
                  {newsAll.length > 1 && <span style={{ fontSize:11, opacity:0.35 }}>{newsIdx+1} / {newsAll.length}</span>}
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  {newsAll.length > 1 && <>
                    <button onClick={()=>setNewsIdx(i=>Math.min(newsAll.length-1,i+1))} disabled={newsIdx>=newsAll.length-1}
                      style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6, padding:"3px 10px", cursor:"pointer", color:"inherit", opacity:newsIdx>=newsAll.length-1?0.3:0.8 }}>‹ Older</button>
                    <button onClick={()=>setNewsIdx(i=>Math.max(0,i-1))} disabled={newsIdx<=0}
                      style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6, padding:"3px 10px", cursor:"pointer", color:"inherit", opacity:newsIdx<=0?0.3:0.8 }}>Newer ›</button>
                  </>}
                  <button onClick={()=>setNewsOpen(false)}
                    style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, opacity:0.5, lineHeight:1, padding:"0 4px", color:"inherit" }}>×</button>
                </div>
              </div>
              <div style={{ padding:"20px 24px", maxHeight:"60vh", overflowY:"auto" }}>
                <div style={{ fontWeight:800, fontSize:18, marginBottom:8, lineHeight:1.3 }}>{item.title||"News"}</div>
                {(item.publishedAt||item.fetchedAt) && <div style={{ fontSize:12, opacity:0.4, marginBottom:14 }}>{fmtNewsDate(item.publishedAt||item.fetchedAt)}</div>}
                {item.body
                  ? <div style={{ fontSize:14, lineHeight:1.7, opacity:0.85 }}>
                      {item.body
                        .replace(/<br\s*\/?>/gi, "\n")   // convert <br> tags to newlines
                        .replace(/&amp;/g, "&")
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">")
                        .replace(/&quot;/g, "\"")
                        .split("\n")
                        .map((line, i) => (
                          <span key={i}>
                            {line}
                            {i < item.body.replace(/<br\s*\/?>/gi,"\n").split("\n").length - 1 && <br />}
                          </span>
                        ))
                      }
                    </div>
                  : item.rawJson
                    ? <pre style={{ fontSize:12, opacity:0.6, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{JSON.stringify(JSON.parse(item.rawJson),null,2)}</pre>
                    : <div style={{ opacity:0.4, fontSize:13 }}>No content available.</div>
                }
                {item.linkUrl && (
                  <div style={{ marginTop:14 }}>
                    <a href={item.linkUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize:13, color:"var(--info)", textDecoration:"underline", opacity:0.85 }}>
                      Read more ›
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PAGE HEADER ──────────────────────────────────────────────────── */}
      <div style={{ position:"relative", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4, minHeight:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:11, opacity:0.35, letterSpacing:"0.05em", textTransform:"uppercase" }}>Dashboard</div>
        </div>
        {/* News pill — absolutely centred independent of left/right content */}
        <div style={{ position:"absolute", left:"50%", transform:"translateX(-50%)" }}>
          {(newsAll[0]||newsLatest) && (
            <button onClick={()=>{ setNewsIdx(0); setNewsOpen(true); }}
              style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 14px",
                borderRadius:999, border:"1px solid rgba(var(--info-rgb),0.3)",
                background:"rgba(var(--info-rgb),0.08)", cursor:"pointer", color:"inherit",
                fontSize:12, fontWeight:600, maxWidth:380, whiteSpace:"nowrap" }}>
              <span style={{ fontSize:11, color:"var(--info)" }}>📰</span>
              <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>
                {(newsAll[0]||newsLatest).title || "Game news"}
              </span>
              {newsAll.length > 1 && <span style={{ fontSize:10, opacity:0.45, flexShrink:0, marginLeft:2 }}>{newsAll.length}</span>}
            </button>
          )}
          {newsLoading && !newsLatest && !newsAll.length && <span style={{ fontSize:11, opacity:0.3 }}>Loading news…</span>}
        </div>
        <EventPill />
      </div>

      {/* ── STAT ROW ─────────────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10 }}>
        <StatCard icon="👤" label="Players" value={counts.players.toLocaleString()}
          sub={counts.bannedPlayers ? `${counts.bannedPlayers} banned` : null}
          onClick={()=>nav("/players")} />
        <StatCard icon="🏰" label="Clans" value={counts.clans.toLocaleString()}
          onClick={()=>nav("/clans")} />
        <StatCard icon="📁" label="Open cases" value={openCases}
          onClick={()=>nav("/cases?status=open")} accent="#60a5fa" />

        {serverInfo.ok && serverData.all.length > 0 && (()=>{
          const total=serverData.all.reduce((a,s)=>a+Number(s.currentPlayers||0),0);
          return <StatCard icon="🌐" label="Players online" value={total.toLocaleString()} sub={formatAgo(serverInfo.lastAt)} />;
        })()}
      </div>

      {/* ── MAIN GRID ────────────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

        {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* Scanning card */}
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">Scanning</div>
            </div>
            <div className="cardBody">

              {/* Full scan section */}
              <SectionLabel>Full scan</SectionLabel>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {bulk.running
                  ? <button className="btn btnDanger" style={{fontSize:13}} onClick={doCancel}>Cancel</button>
                  : <>
                      <button className="btn btnPrimary" style={{fontSize:13}} disabled={bulk.running} onClick={doScanAll}>Scan all</button>
                      <button className="btn" style={{fontSize:13}} disabled={bulk.running} onClick={doScanPlayers}>Players only</button>
                      <button className="btn" style={{fontSize:13}} disabled={bulk.running} onClick={doScanClans}>Clans only</button>
                    </>
                }
              </div>
              <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
                <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={!!skipScanned} onChange={e=>setSkipScanned(e.target.checked)} />
                  Skip already scanned
                </label>
                <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={!!includeClanMembers} onChange={e=>setIncludeClanMembers(e.target.checked)} />
                  Include clan members
                </label>
              </div>

              <Divider />

              {/* Stale scan section */}
              <SectionLabel>Stale / unscanned</SectionLabel>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {bulk.running
                  ? <button className="btn btnDanger" style={{fontSize:13}} onClick={doCancel}>Cancel</button>
                  : <button className="btn btnPrimary" style={{fontSize:13}} disabled={bulk.running} onClick={doScanStale}>Scan stale</button>
                }
              </div>
              <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"flex-end" }}>
                <div>
                  <div style={{ fontSize:11, opacity:0.5, marginBottom:4 }}>Threshold (days)</div>
                  <input className="input" type="number" min={1} max={365} value={staleDays} style={{width:90}}
                    onChange={e=>{ setStaleDays(Math.max(1,Number(e.target.value)||7)); setStaleCounts(null); }} />
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}>
                  <input type="checkbox" checked={!!staleIncludeClans} onChange={e=>{ setStaleIncludeClans(e.target.checked); setStaleCounts(null); }} />
                  Include stale clans
                </label>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {staleCounts !== null ? (
                    <span style={{ fontSize:13 }}>
                      <b style={{ color:(staleCounts.players+(staleIncludeClans?staleCounts.clans:0))>0?"var(--warning)":"var(--success)" }}>
                        {(staleCounts.players+(staleIncludeClans?staleCounts.clans:0)).toLocaleString()}
                      </b>
                      <span style={{ opacity:0.45, marginLeft:4 }}>
                        ({staleCounts.players.toLocaleString()} Players{staleIncludeClans?`, ${staleCounts.clans.toLocaleString()} Clans`:""})
                      </span>
                    </span>
                  ) : (
                    <span style={{ fontSize:12, opacity:0.35 }}>not counted</span>
                  )}
                  <button className="btn" style={{fontSize:12,padding:"3px 10px"}} disabled={staleCountLoading||bulk.running} onClick={loadStaleCounts}>
                    {staleCountLoading?"Counting…":"Check count"}
                  </button>
                </div>
              </div>

              {/* Progress bar — shown for both scan types */}
              {(bulk.running || bulk.total > 0) && (
                <div style={{ marginTop:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, opacity:0.6, marginBottom:5 }}>
                    <span>{currentLabel || (bulk.running ? "Scanning…" : "Done")}</span>
                    <span>{bulk.done.toLocaleString()} / {bulk.total.toLocaleString()} ({bulkPct}%){etaText ? ` · ETA ${etaText}` : ""}</span>
                  </div>
                  <div style={{ height:6, background:"rgba(255,255,255,0.1)", borderRadius:999, overflow:"hidden" }}>
                    <div style={{ width:`${bulkPct}%`, height:"100%", background: bulk.canceled ? "var(--danger)" : "rgba(120,255,190,0.85)", borderRadius:999, transition:"width 0.3s ease" }} />
                  </div>
                  {(bulk.totalClans>0||bulk.totalMembers>0||bulk.totalPlayers>0) && (
                    <div style={{ fontSize:11, opacity:0.4, marginTop:4, display:"flex", gap:10 }}>
                      {bulk.totalPlayers>0 && <span>Players {bulk.donePlayers}/{bulk.totalPlayers}</span>}
                      {bulk.totalClans>0   && <span>Clans {bulk.doneClans}/{bulk.totalClans}</span>}
                      {bulk.totalMembers>0 && <span>Members {bulk.doneMembers}/{bulk.totalMembers}</span>}
                    </div>
                  )}
                  {bulk.error && <div style={{ fontSize:12, color:"var(--danger)", marginTop:4 }}>{bulk.error}</div>}
                </div>
              )}
            </div>
          </div>

          {/* Database card */}
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">Database</div>
              <span style={{ fontSize:12, opacity:0.35 }}>
                {dbInfo.readOnly ? "Read-only" : dbInfo.degraded ? "⚠ Degraded" : "● Healthy"}
              </span>
            </div>
            <div className="cardBody">
              <KV label="Size" value={formatBytes(dbInfo.sizeBytes)} />
              <KV label="Last write" value={formatAgo(dbInfo.lastSaveAt)} />
              <KV label="Last backup" value={formatAgo(dbInfo.lastBackupAt)} />
              {/* Backup location + count row */}
              <div style={{ padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:12, opacity:0.5, flexShrink:0 }}>Backups</span>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                    <span style={{ fontSize:12, fontWeight:600, opacity:0.85, whiteSpace:"nowrap" }}>
                      {typeof dbInfo.backupCount==="number" ? `${dbInfo.backupCount} file${dbInfo.backupCount!==1?"s":""}` : "—"}
                    </span>
                    {typeof dbInfo.backupCount==="number" && dbInfo.backupCount > 6 && (
                      <button className="btn" style={{ fontSize:11, padding:"2px 8px" }}
                        title="Remove backup files beyond the current retention limits"
                        onClick={async()=>{
                          try{
                            const res = await api.pruneBackups({ keepNumbered:3, keepDays:3 });
                            if (res?.ok) setDbInfo(await api.getDbInfo());
                          }catch{}
                        }}>
                        Prune
                      </button>
                    )}
                  </div>
                </div>
                {dbInfo.backupsDir && (
                  <div style={{ fontSize:11, opacity:0.35, marginTop:3, fontFamily:"ui-monospace,monospace", wordBreak:"break-all", lineHeight:1.4 }}>
                    {dbInfo.backupsDir}
                  </div>
                )}
              </div>
              {dbInfo.lastRecoveryPath && <KV label="Recovery" value={dbInfo.lastRecoveryPath} mono />}
              {dbInfo.degraded && dbInfo.lastError && (
                <div style={{ marginTop:8, fontSize:12, color:"var(--danger)" }}>{dbInfo.lastError}</div>
              )}
              <Divider />
              <button style={{ background:"none", border:"none", padding:0, fontSize:13, fontWeight:600, opacity:0.65, cursor:"pointer", color:"inherit" }} onClick={()=>setShowModes(v=>!v)}>
                {showModes?"▲ Hide":"▼ Show"} player & clan breakdown
              </button>
              {showModes && (
                <div style={{ marginTop:8, display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {["Players","Clans"].map(type=>{
                    const data=type==="Players"?counts.playersByMode:counts.clansByMode;
                    return (
                      <div key={type}>
                        <div style={{ fontSize:11, fontWeight:700, opacity:0.4, marginBottom:4, textTransform:"uppercase" }}>{type}</div>
                        {Object.entries(data||{}).sort(([a],[b])=>a.localeCompare(b)).map(([mode,n])=>(
                          <div key={mode} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"2px 0" }}>
                            <span style={{ opacity:0.55 }}>{modeLabel(mode)}</span>
                            <span style={{ fontWeight:600 }}>{Number(n||0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* Server status card */}
          <div className="card">
            <div className="cardHeader" style={{ justifyContent:"space-between" }}>
              <div className="cardTitle">Server Status</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {serverInfo.lastAt && <span style={{ fontSize:12, opacity:0.35 }}>{formatAgo(serverInfo.lastAt)}</span>}
                <button className="btn" style={{fontSize:12,padding:"3px 10px"}}
                  disabled={!serverPopStats?.ok||!(Array.isArray(serverPopStats.data?.daily)&&serverPopStats.data.daily.length>0)}
                  onClick={exportPopGraph}
                >
                  Export graph
                </button>
              </div>
            </div>
            <div className="cardBody">
              {!serverSettings.enabled ? (
                <div style={{ fontSize:13, opacity:0.4 }}>Disabled in Settings.</div>
              ) : !serverInfo.ok && !serverInfo.data ? (
                serverInfo.loading
                  ? <div style={{ fontSize:13, opacity:0.4 }}>Fetching server info…</div>
                  : <div style={{ fontSize:13, color:"var(--danger)" }}>Failed to fetch status{serverInfo.error?`: ${serverInfo.error}`:""}</div>
              ) : (()=>{
                // Render with current data even while refreshing — opacity signals loading state
                const { bvi, all, recServer } = serverData;
                const recLabel = recServer?.displayName||(serverSettings.showAddresses&&serverData.recAddr?serverData.recAddr:"—");
                const toShow = showAllServers ? all : (recServer?[recServer]:all.slice(0,1));

                return (
                  <div style={{ opacity: serverInfo.loading ? 0.6 : 1, transition:"opacity 0.35s ease" }}>
                    {bvi && (
                      <div style={{ fontSize:12, opacity:0.45, marginBottom:10 }}>
                        Build <b style={{opacity:1}}>{String(bvi.latestBuildVersion??"—")}</b>
                        {bvi.requiredBuildVersion && <span> · Required <b style={{opacity:1}}>{String(bvi.requiredBuildVersion)}</b></span>}
                      </div>
                    )}

                    {/* Population mini chart */}
                    {serverPopStats.ok && serverPopStats.data && (()=>{
                      const st=serverPopStats.data;
                      const ath=st.allTimeHigh!=null?Number(st.allTimeHigh):null;
                      const daily=Array.isArray(st.daily)?st.daily:[];
                      const last=daily.slice(-30);
                      const max=Math.max(1,...last.map(d=>Number(d.avgPlayers||0)));
                      const W=220,H=40;
                      const barW=last.length?W/last.length:W;
                      return (
                        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:12, padding:"10px 12px", background:"rgba(255,255,255,0.03)", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)" }}>
                          {ath!=null && (
                            <div>
                              <div style={{ fontSize:11, opacity:0.4 }}>All-time high</div>
                              <div style={{ fontSize:16, fontWeight:800 }}>{ath.toLocaleString()}</div>
                              {st.allTimeHighAt && <div style={{ fontSize:11, opacity:0.35 }}>{new Date(st.allTimeHighAt).toLocaleDateString()}</div>}
                            </div>
                          )}
                          {last.length > 0 && (
                            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex:1, opacity:0.7 }}>
                              {last.map((d,i)=>{
                                const v=Math.max(0,Number(d.avgPlayers||0));
                                const bh=Math.max(1,(v/max)*(H-4));
                                return <rect key={d.day} x={i*barW+0.2} y={H-4-bh} width={Math.max(0.5,barW-0.5)} height={bh} rx="1" fill="currentColor" opacity="0.4" />;
                              })}
                            </svg>
                          )}
                        </div>
                      );
                    })()}

                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <span style={{ fontSize:12, opacity:0.5 }}>Recommended: <b style={{opacity:1}}>{recLabel}</b></span>
                      {all.length > 1 && (
                        <button className="btn" style={{fontSize:11,padding:"2px 8px"}} onClick={()=>setShowAllServers(v=>!v)}>
                          {showAllServers?`Show less`:`All servers (${all.length})`}
                        </button>
                      )}
                    </div>

                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {toShow.map((s,idx)=>{
                        const cur=Number(s.currentPlayers||0), max=Number(s.maxPlayers||0);
                        const pct=s.loadPercentage!=null?Number(s.loadPercentage):max>0?(cur/max)*100:null;
                        const avail=s.isAvailable==null?null:!!s.isAvailable;
                        const fillColor = pct!=null&&pct>=80?"var(--warning)":pct!=null&&pct>=50?"var(--info)":"var(--success)";
                        return (
                          <div key={`${s.displayName||idx}`} style={{ padding:"10px 12px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10 }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                              <span style={{ fontWeight:700, fontSize:13 }}>{String(s.displayName||s.name||`Server ${idx+1}`)}</span>
                              {avail!=null && (
                                <span style={{ fontSize:11, fontWeight:700, color:avail?"var(--success)":"var(--danger)" }}>{avail?"Available":"Unavailable"}</span>
                              )}
                            </div>
                            <div style={{ fontSize:12, opacity:0.6 }}>
                              {cur.toLocaleString()}{max?` / ${max.toLocaleString()} players`:""}{pct!=null&&isFinite(pct)?` · ${pct.toFixed(0)}% load`:""}
                            </div>
                            {pct!=null && isFinite(pct) && (
                              <div style={{ marginTop:6, height:3, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden" }}>
                                <div style={{ width:`${Math.min(100,pct)}%`, height:"100%", background:fillColor, borderRadius:999, transition:"width 0.4s ease" }} />
                              </div>
                            )}
                            {serverSettings.showAddresses && s.address && (
                              <div style={{ fontSize:11, opacity:0.35, marginTop:3, fontFamily:"monospace" }}>{s.address}</div>
                            )}
                          </div>
                        );
                      })}
                      {all.length===0 && <div style={{ fontSize:13, opacity:0.4 }}>No servers returned.</div>}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Import card */}
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">Import data</div>
            </div>
            <div className="cardBody">
              <div style={{ fontSize:13, opacity:0.5, marginBottom:12 }}>
                Import a JSON export (players + clans) or a plain text list.
              </div>
              <ImportButton onImported={async()=>setCounts(await api.getCounts())} />
            </div>
          </div>

          {/* ── QR Code panel removed — now a global modal triggered by keyword ── */}

        </div>
        {/* ── END RIGHT COLUMN ──────────────────────────────────────────── */}

      </div>
    </div>
  );
}

// ── ImportButton ──────────────────────────────────────────────────────────────

function ImportButton({ onImported }){
  const toast = useToast();
  const [open,    setOpen]    = useState(false);
  const [mode,    setMode]    = useState("auto");
  const [fileName,setFileName]= useState("");
  const [filePath,setFilePath]= useState("");
  const [fileSize,setFileSize]= useState(0);
  const [busy,    setBusy]    = useState(false);
  const [progress,setProgress]= useState({ phase:"", bytesRead:0, totalBytes:0, playersImported:0, clansImported:0 });
  const [importId,setImportId]= useState("");

  useEffect(()=>{
    const off=onImportProgress?.((p)=>{
      if (!p) return;
      if (importId&&p.importId&&p.importId!==importId) return;
      setProgress(prev=>({...prev,...p}));
      if (p.done) setBusy(false);
    });
    return ()=>{ try{off?.();}catch{} };
  },[importId]);

  async function chooseFile(){
    try{ const picked=await api.pickImportFile(); if (!picked?.path) return; setFileName(picked.name||""); setFilePath(picked.path||""); setFileSize(Number(picked.sizeBytes||0)); setOpen(true); }
    catch(err){ toast.error(String(err?.message||err)); }
  }

  async function run(){
    try{
      setBusy(true);
      const id=`imp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      setImportId(id);
      setProgress({phase:"starting",bytesRead:0,totalBytes:fileSize||0,playersImported:0,clansImported:0});
      if (!filePath){ toast.warning("No file selected."); return; }
      await api.importData({mode,path:filePath,fileName,importId:id});
      await onImported?.();
      setOpen(false);
    }catch(err){ toast.error(String(err?.message||err)); }
    finally{ setBusy(false); }
  }

  async function cancel(){ try{ if(importId) await api.cancelImport(importId); }catch{} setBusy(false); }

  const total=Number(progress.totalBytes||0), done=Number(progress.bytesRead||0);
  const pct=total?Math.max(0,Math.min(100,Math.round((done/total)*100))):0;

  return (
    <>
      <button className="btn" onClick={chooseFile}>Choose file…</button>

      {open && (
        <div style={{ marginTop:12 }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, opacity:0.5, marginBottom:4 }}>Mode</div>
              <select className="select" value={mode} onChange={e=>setMode(e.target.value)} style={{width:"100%"}}>
                <option value="auto">Auto-detect</option>
                <option value="playersText">Players only (text list)</option>
                <option value="clansText">Clans only (text list)</option>
                <option value="exportJson">Export JSON (players + clans)</option>
              </select>
            </div>
            <div style={{ flex:2 }}>
              <div style={{ fontSize:11, opacity:0.5, marginBottom:4 }}>File</div>
              <input className="input" value={fileName} readOnly style={{width:"100%"}} />
              {fileSize>0 && <div style={{ fontSize:11, opacity:0.35, marginTop:3 }}>{(fileSize/1024/1024).toFixed(1)} MB</div>}
            </div>
          </div>

          {busy && (
            <div style={{ marginBottom:10 }}>
              <div style={{ height:5, background:"rgba(255,255,255,0.1)", borderRadius:999, overflow:"hidden", marginBottom:5 }}>
                <div style={{ width:`${pct}%`, height:"100%", background:"rgba(120,255,190,0.85)", borderRadius:999 }} />
              </div>
              <div style={{ fontSize:12, opacity:0.55 }}>
                {pct}%{progress.phase?` · ${progress.phase}`:""}
                {typeof progress.playersImported==="number"?` · Players: ${progress.playersImported}`:""}
                {typeof progress.clansImported==="number"?` · Clans: ${progress.clansImported}`:""}
                {progress.error?` · Error: ${progress.error}`:""}
              </div>
            </div>
          )}

          <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
            <button className="btn" onClick={()=>setOpen(false)} disabled={busy}>Close</button>
            <button className="btn" onClick={cancel} disabled={!busy}>Cancel</button>
            <button className="btn btnPrimary" onClick={run} disabled={busy}>{busy?"Importing…":"Import"}</button>
          </div>
        </div>
      )}
    </>
  );
}
