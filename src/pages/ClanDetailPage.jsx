import React, { useEffect, useMemo, useState } from "react";
import * as ReactDOM from "react-dom";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, onScanProgress } from "../lib/bridge.js";
import SkillsGrid from "../components/SkillsGrid.jsx";
import ActivityLog from "../components/ActivityLog.jsx";
import HistoryTimeline from "../components/HistoryTimeline.jsx";
import MemberPills from "../components/MemberPills.jsx";
import { useToast } from "../components/Toast.jsx";
import { sortClanSkills } from "../lib/skills.js";
import OnlineHeatmap from "../components/OnlineHeatmap.jsx";
import { computeSimilarNameGroups } from "../lib/nameSimilarity.js";
import { modeLabel } from "../lib/format.js";


function agoFromIso(ts){
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "-";
  const mins = Math.floor((Date.now()-t)/60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins} min ago`;
  const hours = Math.floor(mins/60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours/24)} days ago`;
}

function titleCase(s){
  return String(s||"").split(/[_\s]+/g).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
}
function prettyMode(m){
  return m==="default" ? "Normal" : m==="ironman" ? "Ironman" : m==="groupironman" ? "Group Ironman" : titleCase(m);
}
function fmtNum(n){
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : "—";
}

// Renders a clan's cached leaderboard standings (rank/level/score per board)
function LeaderboardStandingsCard({ standings, lastUpdated }){
  if (!standings || standings.length === 0){
    return (
      <div className="card">
        <div className="cardHeader"><div className="cardTitle">Leaderboard standings</div></div>
        <div className="cardBody">
          <div style={{ opacity:0.35, fontSize:13 }}>
            No cached leaderboard data for this clan yet. Scan a clan leaderboard board on the Leaderboards page to populate this.
          </div>
        </div>
      </div>
    );
  }

  const byMode = {};
  for (const r of standings){
    const gm = r.gameMode || "default";
    (byMode[gm] = byMode[gm] || []).push(r);
  }

  return (
    <div className="card">
      <div className="cardHeader"><div className="cardTitle">Leaderboard standings</div></div>
      <div className="cardBody">
        {Object.entries(byMode).map(([gm, rows]) => (
          <div key={gm} style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase", opacity:0.4, marginBottom:6 }}>
              {prettyMode(gm)}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:"4px 16px" }}>
              {rows.map(r => (
                <React.Fragment key={r.boardKey}>
                  <span style={{ fontSize:13, opacity:0.85 }}>{titleCase(r.category)}</span>
                  <span style={{ fontSize:13, fontWeight:700, textAlign:"right" }}>#{fmtNum(r.rank)}</span>
                  <span style={{ fontSize:13, opacity:0.5, textAlign:"right" }}>
                    {r.level !== null ? `Lv ${fmtNum(r.level)}` : (r.score !== null ? fmtNum(r.score) : "—")}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
        <div style={{ fontSize:11, opacity:0.35, marginTop:4 }}>
          {lastUpdated && `Last synced ${agoFromIso(lastUpdated)} · `}From cached leaderboard scans · may not reflect the clan's very latest stats
        </div>
      </div>
    </div>
  );
}


function houseLabel(id){
  switch(Number(id)){
    case -1: return "None";     case 0: return "Tent";
    case 1:  return "Barn";     case 2: return "Windmill";
    case 3:  return "House";    case 4: return "Manor";
    case 5:  return "Castle";   default: return id ?? "-";
  }
}

function categoryLabel(id){
  switch(Number(id)){
    case 1: return "Casual";    case 2: return "Competitive";
    case 3: return "Hardcore";  default: return id ?? "-";
  }
}

function KV({ label, value, title }){
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      gap:12, padding:"6px 0", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize:13, opacity:0.5 }} title={title}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, opacity:0.9, textAlign:"right" }}>{value}</span>
    </div>
  );
}

function TabBar({ tabs, active, onChange }){
  return (
    <div style={{ display:"flex", gap:0, borderBottom:"1px solid rgba(255,255,255,0.08)", marginBottom:18 }}>
      {tabs.map(({ id, label, icon }) => (
        <button key={id} onClick={()=>onChange(id)} style={{
          display:"flex", alignItems:"center", gap:6,
          padding:"10px 18px", background:"none", border:"none", cursor:"pointer",
          fontSize:13, fontWeight: active===id ? 700 : 500,
          color: active===id ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
          borderBottom: active===id ? "2px solid var(--accent,#60a5fa)" : "2px solid transparent",
          marginBottom:-1, transition:"color 0.12s",
        }}>
          {icon && <span style={{ fontSize:14 }}>{icon}</span>}
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Vault helpers ─────────────────────────────────────────────────────────────

const GOLD_NAMES = new Set(["gold","coins","coin","gold coins"]);
function isGold(itemName){
  return GOLD_NAMES.has(String(itemName||"").toLowerCase().trim());
}

function fmtGold(n){
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000_000) return (n/1_000_000_000).toFixed(2).replace(/\.?0+$/,"") + "B";
  if (n >= 1_000_000)     return (n/1_000_000).toFixed(2).replace(/\.?0+$/,"") + "M";
  if (n >= 1_000)         return (n/1_000).toFixed(1).replace(/\.?0+$/,"") + "K";
  return n.toLocaleString();
}

function itemImageUrl(snakeName){
  if (!snakeName) return null;
  const packaged = window.location.protocol === "file:";
  return packaged
    ? `asset://gameimages/${snakeName}.png`
    : `/gameimages/${snakeName}.png`;
}


// Portal tooltip -- injects handlers via cloneElement so getBoundingClientRect
// always measures the actual slot element, not a wrapper.
function VaultTooltip({ children, content }){
  const [pos, setPos] = useState(null);
  function show(e){
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }
  function hide(){ setPos(null); }
  const portal = pos ? ReactDOM.createPortal(
    <div style={{
      position:"fixed", left:pos.x, top:pos.y, transform:"translateX(-50%)",
      background:"rgba(12,22,12,0.97)", border:"1px solid rgba(255,255,255,0.18)",
      borderRadius:7, padding:"8px 12px", whiteSpace:"nowrap",
      boxShadow:"0 4px 18px rgba(0,0,0,0.65)", pointerEvents:"none", zIndex:99999,
    }}>{content}</div>,
    document.body
  ) : null;
  const child = React.Children.only(children);
  return <>
    {React.cloneElement(child, { onMouseEnter: show, onMouseLeave: hide })}
    {portal}
  </>;
}

// ── VaultItemSlot — game-style slot with image + tooltip ──────────────────────
function VaultItemSlot({ name, snakeName, qty }){
  const [imgFail, setImgFail] = useState(false);
  const src = !imgFail ? itemImageUrl(snakeName) : null;
  return (
    <VaultTooltip content={<>
      <div style={{ fontSize:13, fontWeight:700, color:"#fde68a", marginBottom:3 }}>{name}</div>
      <div style={{ fontSize:12, opacity:0.55 }}>Qty: <span style={{ color:"#fff", fontWeight:600 }}>{qty.toLocaleString()}</span></div>
    </>}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end",
        width:72, height:80, borderRadius:8,
        background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.10)",
        cursor:"default", userSelect:"none" }}>
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", width:"100%", paddingTop:6 }}>
          {src
            ? <img src={src} alt={name} onError={()=>setImgFail(true)}
                style={{ width:44, height:44, objectFit:"contain", imageRendering:"pixelated" }} />
            : <span style={{ fontSize:28, opacity:0.45 }}>📦</span>
          }
        </div>
        <div style={{ fontSize:11, fontWeight:700, padding:"2px 0 5px",
          color:"rgba(255,220,100,0.95)", textShadow:"0 1px 2px rgba(0,0,0,0.8)", lineHeight:1 }}>
          {qty >= 1_000_000_000 ? (qty/1_000_000_000).toFixed(1)+"B"
            : qty >= 1_000_000 ? (qty/1_000_000).toFixed(1)+"M"
            : qty >= 10_000    ? (qty/1_000).toFixed(0)+"K"
            : qty.toLocaleString()}
        </div>
      </div>
    </VaultTooltip>
  );
}

// ── GoldSlot ──────────────────────────────────────────────────────────────────
function GoldSlot({ amount }){
  return (
    <VaultTooltip content={<>
      <div style={{ fontSize:13, fontWeight:700, color:"var(--warning2)", marginBottom:3 }}>Gold</div>
      <div style={{ fontSize:12, opacity:0.55 }}>Amount: <span style={{ color:"#fff", fontWeight:600 }}>{amount.toLocaleString()}</span></div>
    </>}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end",
        width:72, height:80, borderRadius:8,
        background:"rgba(var(--warning2-rgb),0.08)", border:"1px solid rgba(var(--warning2-rgb),0.35)",
        cursor:"default", userSelect:"none" }}>
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", paddingTop:6 }}>
          <span style={{ fontSize:32 }}>🪙</span>
        </div>
        <div style={{ fontSize:11, fontWeight:700, padding:"2px 0 5px", color:"var(--warning2)", lineHeight:1 }}>
          {fmtGold(amount)}
        </div>
      </div>
    </VaultTooltip>
  );
}


function StaleBadge({ updatedAt }){
  if (!updatedAt) return <span style={{ fontSize:11, color:"var(--danger)", fontWeight:700 }}>⚠ Never refreshed</span>;
  const ageMs   = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000*60*60*24);
  if (ageDays > 7) return (
    <span style={{ fontSize:11, color:"var(--warning)", fontWeight:700 }}
      title={`Last updated: ${new Date(updatedAt).toLocaleString()}`}>
      ⚠ Stale — {Math.floor(ageDays)}d ago
    </span>
  );
  return <span style={{ fontSize:11, opacity:0.45 }}
    title={`Last updated: ${new Date(updatedAt).toLocaleString()}`}>
    Updated {agoFromIso(updatedAt)}
  </span>;
}

// ── Idle Clans rich-text renderer ─────────────────────────────────────────────
const COLOR_NAMES = {
  red:"var(--danger)", green:"var(--success)", blue:"var(--info)", yellow:"#fde047",
  white:"#ffffff", black:"#111827", orange:"#fb923c", purple:"#c084fc",
  cyan:"#22d3ee", pink:"#f472b6", grey:"#9ca3af", gray:"#9ca3af",
  silver:"#d1d5db", gold:"var(--warning2)",
};
function resolveColor(c){
  const s = String(c||"").toLowerCase().replace(/['"]/g,"");
  return COLOR_NAMES[s] || (s.startsWith("#") ? s : null);
}
function parseRichText(raw){
  const result = [];
  const stack  = [{ color:null, size:null, bold:false, italic:false, underline:false }];
  const cur    = () => stack[stack.length-1];
  const TOKEN  = /<(\/?)(\w+)(?:=["']?([^>"']+)["']?)?\s*\/?>/gi;
  let lastIndex = 0, match, key = 0;
  while ((match = TOKEN.exec(raw)) !== null){
    if (match.index > lastIndex){
      const text = raw.slice(lastIndex, match.index);
      if (text) result.push(styledSpan(text, cur(), key++));
    }
    lastIndex = match.index + match[0].length;
    const closing = match[1] === "/";
    const tag     = match[2].toLowerCase();
    const val     = match[3] || null;
    if (closing){ if (stack.length > 1) stack.pop(); }
    else if (tag === "br")    result.push(<br key={key++} />);
    else if (tag === "color") stack.push({ ...cur(), color: resolveColor(val) || cur().color });
    else if (tag === "size"){
      const em = Number.isFinite(Number(val)) ? Math.max(0.65, Math.min(2.2, Number(val)/40)) : 1;
      stack.push({ ...cur(), size: em });
    }
    else if (tag === "b") stack.push({ ...cur(), bold: true });
    else if (tag === "i") stack.push({ ...cur(), italic: true });
    else if (tag === "u") stack.push({ ...cur(), underline: true });
    // Unknown tags stripped
  }
  if (lastIndex < raw.length) result.push(styledSpan(raw.slice(lastIndex), cur(), key++));
  return result;
}
function styledSpan(text, frame, key){
  const s = {};
  if (frame.color)     s.color = frame.color;
  if (frame.size)      s.fontSize = `${frame.size}em`;
  if (frame.bold)      s.fontWeight = "800";
  if (frame.italic)    s.fontStyle = "italic";
  if (frame.underline) s.textDecoration = "underline";
  return <span key={key} style={s}>{text}</span>;
}
function RecruitmentMessage({ raw }){
  const [showRaw, setShowRaw] = React.useState(false);
  const hasMarkup = /<\/?[a-z][\w]*[\s=>]/i.test(raw||"");
  return (
    <div>
      {hasMarkup && (
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
          <button style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6,
            padding:"2px 10px", fontSize:11, cursor:"pointer", opacity:0.55, color:"inherit" }}
            onClick={()=>setShowRaw(v=>!v)}>
            {showRaw ? "Formatted" : "Raw"}
          </button>
        </div>
      )}
      {showRaw || !hasMarkup
        ? <pre style={{ margin:0, fontSize:12, opacity:0.7, whiteSpace:"pre-wrap", fontFamily:"ui-monospace,monospace" }}>{raw}</pre>
        : <div style={{ fontSize:14, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{parseRichText(raw)}</div>
      }
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id:"overview", label:"Overview",  icon:"🏰" },
  { id:"members",  label:"Members",   icon:"👥" },
  { id:"skills",   label:"Skills",    icon:"📊" },
  { id:"vault",    label:"Vault",     icon:"🏦" },
  { id:"pvm",      label:"PvM",       icon:"⚔" },
  { id:"logs",     label:"Logs",      icon:"📋" },
];

export default function ClanDetailPage(){
  const toast = useToast();
  const { name } = useParams();
  const decoded  = useMemo(()=>decodeURIComponent(name||""), [name]);
  const navigate = useNavigate();

  const [clan,         setClan]         = useState(null);
  const [members,      setMembers]      = useState([]);
  const [tracked,      setTracked]      = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [logsNonce,    setLogsNonce]    = useState(0);
  const [scan,         setScan]         = useState({ running:false, done:0, total:0, failed:0 });
  const [changes,      setChanges]      = useState([]);
  const [activity,     setActivity]     = useState([]);
  const [activityDays, setActivityDays] = useState(7);
  const [standings,    setStandings]    = useState([]); // leaderboard rows for this clan

  // Vault tab state — contents computed server-side (includes snakeName for images)
  const [vaultData,    setVaultData]    = useState(null); // { gold, items, eventCount, oldestEvent, newestEvent }
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultFilter,  setVaultFilter]  = useState("");
  const [vaultSort,    setVaultSort]    = useState("qty"); // "qty" | "name"
  // Vault storage tier (1-4). Items whose log messages carry a "(Tier N)"
  // qualifier (N=2-4) belong to that tier; everything else (no qualifier)
  // is a regular Tier 1 item — there's no separate "unsorted" bucket.
  const [vaultTier,    setVaultTier]    = useState(1);

  // PvM tab state
  const [pvmData,      setPvmData]      = useState(null); // { clanName, takenAt, pvm:{} } | null
  const [pvmLoading,   setPvmLoading]   = useState(false);
  const [pvmSnapBusy,  setPvmSnapBusy]  = useState(false);

  const [tab, setTab] = useState(()=>{
    try{ return localStorage.getItem("clanDetailTab_v1") || "overview"; }catch{ return "overview"; }
  });
  useEffect(()=>{
    try{ localStorage.setItem("clanDetailTab_v1", tab); }catch{}
    if (tab === "vault" && vaultData === null && !vaultLoading){
      loadVault();
    }
    if (tab === "pvm" && pvmData === null && !pvmLoading){
      loadPvm();
    }
  }, [tab]); // eslint-disable-line

  async function loadPvm(){
    setPvmLoading(true);
    try{
      const result = await api.getClanPvmSnapshot?.({ clanName: decoded });
      setPvmData(result || null);
    }catch{ setPvmData(null); }
    finally{ setPvmLoading(false); }
  }

  async function loadVault(){
    setVaultLoading(true);
    try{
      const result = await api.getVaultContents?.({ clanName: decoded }) || { gold:0, items:[], eventCount:0 };
      setVaultData(result);
    }catch(e){ setVaultData({ gold:0, items:[], eventCount:0 }); console.error("vault load error", e); }
    finally{ setVaultLoading(false); }
  }

  const { groupByLower:similarGroups, metaByLower:similarMeta } =
    useMemo(()=>computeSimilarNameGroups(members), [members]);

  async function load(){
    const c = await api.getClan(decoded);
    setClan(c);
    setMembers(c?.members || []);
    setTracked((await api.getTracked("clan", decoded))?.enabled || false);
    setChanges(await api.getClanMemberChanges(decoded, 200));
    setActivity(await api.getClanLastOnlineEvents(decoded, activityDays, 20000));
    try{
      // Prefer the standings baked onto the clan's profile (kept in sync
      // automatically whenever a leaderboard scan completes). Fall back to
      // a live cross-board lookup for clans not yet synced (e.g. cached from
      // a scan run before this feature existed).
      const fromProfile = c?.leaderboardStandings && typeof c.leaderboardStandings === "object"
        ? Object.values(c.leaderboardStandings)
        : [];
      if (fromProfile.length){
        setStandings(fromProfile);
      } else {
        const res = await api.getEntityLeaderboardStandings?.({ name: decoded, entityType: "clans" });
        setStandings(Array.isArray(res?.rows) ? res.rows : []);
      }
    }catch{ setStandings([]); }
  }

  useEffect(()=>{ load(); }, [decoded, activityDays]); // eslint-disable-line

  async function refresh(){
    setBusy(true);
    try{
      await api.refreshClan(decoded);
      await api.fetchClanLogs(decoded);
      setLogsNonce(n=>n+1);
      await load();
      // Always fetch fresh PvM snapshot from the leaderboard API
      try{
        const pvmResult = await api.fetchClanPvmProfile?.({ clanName: decoded });
        if (pvmResult?.ok){
          setPvmData({ clanName: decoded, takenAt: pvmResult.takenAt, pvm: pvmResult.pvm });
        } else {
          // Fetch may have failed — re-read whatever is stored in DB so the tab isn't blank
          const stored = await api.getClanPvmSnapshot?.({ clanName: decoded });
          if (stored) setPvmData(stored);
        }
      }catch{
        // On any error, still try to show stored data
        try{
          const stored = await api.getClanPvmSnapshot?.({ clanName: decoded });
          if (stored) setPvmData(stored);
        }catch(e){ console.warn("[ClanDetail] getClanPvmSnapshot fallback failed", e?.message); }
      }
    } finally{ setBusy(false); }
  }

  async function toggleTracked(){
    const next = !tracked;
    setTracked(next);
    await api.setTracked("clan", decoded, next);
  }

  useEffect(()=>{
    return onScanProgress(evt=>{
      if (evt?.clanName?.toLowerCase() !== decoded.toLowerCase()) return;
      setScan({ running:evt.running, done:evt.done, total:evt.total, failed:evt.failed||0 });
      if (evt.done===evt.total && evt.total>0) load();
    });
  }, [decoded]); // eslint-disable-line

  // Must be before the early return — hooks cannot be conditional
  const vaultTierCounts = useMemo(()=>{
    const counts = { 1:0, 2:0, 3:0, 4:0 };
    for (const it of (vaultData?.items || [])){
      // Items with no tier qualifier in their log message are regular Tier 1
      // items — the (Tier N) qualifier was only added for tiers 2-4.
      const t = (it.tier >= 1 && it.tier <= 4) ? it.tier : 1;
      counts[t]++;
    }
    return counts;
  }, [vaultData]);

  const vaultItemList = useMemo(()=>{
    if (!vaultData?.items) return [];
    let list = [...vaultData.items].filter(it => {
      const t = (it.tier >= 1 && it.tier <= 4) ? it.tier : 1;
      return t === vaultTier;
    });
    const f = vaultFilter.trim().toLowerCase();
    if (f) list = list.filter(it => it.name.toLowerCase().includes(f));
    if (vaultSort === "name") list.sort((a,b) => a.name.localeCompare(b.name));
    return list;
  }, [vaultData, vaultFilter, vaultSort, vaultTier]);

  async function refreshMembers(){
    setScan({ running:true, done:0, total:members.length, failed:0 });
    await api.scanClanMembers(decoded);
  }

  if (!clan) return <div style={{ opacity:0.4, padding:24 }}>Loading…</div>;

  const membersWithNames = (members||[]).filter(m=>(m?.memberUsername||m?.memberName||m?.username||"").trim().length>0);
  const allMembersBanned = membersWithNames.length>0 && membersWithNames.every(m=>!!(m?.bannedAt??m?.playerBannedAt));
  const clanSkills  = sortClanSkills(clan.skills||{});
  const progressPct = scan.total ? Math.round((scan.done/scan.total)*100) : 0;

  const pushMembersToCompare = ()=>{
    try{
      const seen=new Set();
      const names=(members||[])
        .map(m=>m?.memberName||m?.name||m?.username||m?.playerName||"")
        .map(s=>String(s).trim())
        .filter(Boolean)
        .filter(n=>{ const l=n.toLowerCase(); if(seen.has(l)) return false; seen.add(l); return true; });
      localStorage.setItem("idleclans_compare_players_v1", JSON.stringify(names));
      navigate("/compare");
    }catch(e){ toast.error("Failed to send members to Compare: "+(e?.message||String(e))); }
  };

  // ── header ─────────────────────────────────────────────────────────────────
  const header = (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <Link className="btn" to="/clans">← Back</Link>
          <span style={{ fontWeight:800, fontSize:20 }}>{clan.clanName}</span>
          {clan.tag && (
            <span style={{ fontSize:13, fontWeight:600, padding:"3px 10px", borderRadius:8,
              background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)" }}>
              {clan.tag}
            </span>
          )}
          {allMembersBanned && (
            <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6,
              background:"rgba(var(--danger-rgb),0.15)", color:"var(--danger)" }}>All banned</span>
          )}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <button className="btn" onClick={toggleTracked} title="Flag for scheduled refreshes">
            <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%",
              background:tracked?"var(--success)":"rgba(255,255,255,0.25)", marginRight:6 }} />
            {tracked ? "Flagged" : "Flag"}
          </button>
          <button className="btn" disabled={!membersWithNames.length} title="Add all current members to the tracked refresh queue"
            onClick={async()=>{
              if (!window.confirm(`Flag all ${membersWithNames.length} members of ${clan.clanName} for scheduled refreshes?`)) return;
              await api.flagClanMembers(decoded, true);
              await load();
            }}>
            Flag all members ({membersWithNames.length})
          </button>
          <button
            className={allMembersBanned ? "btn" : "btn btnDanger"}
            onClick={async()=>{
              const action = allMembersBanned ? "unban" : "ban";
              if (!window.confirm(`${action==="ban"?"Mark":"Unmark"} ALL members of ${clan.clanName} as ${action==="ban"?"banned":"not banned"}?`)) return;
              await api.banClanMembers(decoded, !allMembersBanned);
              await load();
            }}>
            {allMembersBanned ? "Unban all members" : "Ban all members"}
          </button>
          <button className="btn" disabled={!members?.length} onClick={pushMembersToCompare}>
            Compare members ({members?.length||0})
          </button>
          <button className="btn btnPrimary" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh from API"}
          </button>
        </div>
      </div>
      <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:10, fontSize:12, opacity:0.5, flexWrap:"wrap" }}>
        <span>{membersWithNames.length} member{membersWithNames.length!==1?"s":""}</span>
        <span>·</span>
        <StaleBadge updatedAt={clan.updatedAt} />
      </div>
    </div>
  );

  // ── VAULT tab ─────────────────────────────────────────────────────────────
  const tabVault = (
    <div>
      {/* Disclaimer */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, opacity:0.4, lineHeight:1.6, flex:1 }}>
          Reconstructed from <b>{vaultData?.eventCount?.toLocaleString() ?? "…"}</b> vault log events.
          Quantities are <b>estimates</b> — only transactions observed during scans are captured.
          Items may have been moved between scans.
        </div>
        <button className="btn" style={{ flexShrink:0 }}
          onClick={()=>{ setVaultData(null); loadVault(); }}>
          Reload
        </button>
      </div>

      {vaultLoading && (
        <div style={{ opacity:0.4, fontSize:13, padding:"32px 0", textAlign:"center" }}>
          Loading vault events…
        </div>
      )}

      {!vaultLoading && vaultData && (
        <>
          {/* Stats bar */}
          <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
            <div style={{ padding:"12px 20px", borderRadius:10,
              background:"rgba(var(--warning2-rgb),0.07)", border:"1px solid rgba(var(--warning2-rgb),0.25)",
              display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:26 }}>🪙</span>
              <div>
                <div style={{ fontSize:11, opacity:0.5, fontWeight:600, letterSpacing:"0.05em",
                  textTransform:"uppercase", marginBottom:2 }}>Gold</div>
                <div style={{ fontSize:20, fontWeight:800, color:"var(--warning2)" }}>
                  {vaultData.gold > 0 ? vaultData.gold.toLocaleString() : "—"}
                </div>
              </div>
            </div>
            <div style={{ padding:"12px 20px", borderRadius:10,
              background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
              display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:22, opacity:0.7 }}>📦</span>
              <div>
                <div style={{ fontSize:11, opacity:0.5, fontWeight:600, letterSpacing:"0.05em",
                  textTransform:"uppercase", marginBottom:2 }}>Item types</div>
                <div style={{ fontSize:20, fontWeight:800 }}>
                  {vaultData.items.length.toLocaleString()}
                </div>
              </div>
            </div>
            <div style={{ padding:"12px 20px", borderRadius:10,
              background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
              display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:22, opacity:0.7 }}>📋</span>
              <div>
                <div style={{ fontSize:11, opacity:0.5, fontWeight:600, letterSpacing:"0.05em",
                  textTransform:"uppercase", marginBottom:2 }}>Log events</div>
                <div style={{ fontSize:20, fontWeight:800 }}>
                  {vaultData.eventCount.toLocaleString()}
                </div>
              </div>
            </div>
            {vaultData.newestEvent && (
              <div style={{ padding:"12px 20px", borderRadius:10,
                background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
                display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:22, opacity:0.7 }}>🕒</span>
                <div>
                  <div style={{ fontSize:11, opacity:0.5, fontWeight:600, letterSpacing:"0.05em",
                    textTransform:"uppercase", marginBottom:2 }}>Last event</div>
                  <div style={{ fontSize:13, fontWeight:700 }}>
                    {agoFromIso(vaultData.newestEvent)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Vault tier tabs — items are stored across 4 vault tiers in-game;
              this navigates between them like the in-game vault UI. */}
          <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
            {[1,2,3,4].map(t=>(
              <button key={t} onClick={()=>setVaultTier(t)} className="btn"
                style={{
                  fontWeight:700,
                  background: vaultTier===t ? "rgba(var(--info-rgb),0.18)" : undefined,
                  borderColor: vaultTier===t ? "rgba(var(--info-rgb),0.4)" : undefined,
                  color: vaultTier===t ? "var(--info)" : undefined,
                }}>
                Tier {t}
                <span style={{ marginLeft:6, fontSize:11, opacity:0.5, fontWeight:600 }}>
                  {vaultTierCounts[t]}
                </span>
              </button>
            ))}
          </div>

          {/* Filter + sort */}
          {vaultData.items.length > 0 && (
            <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"center", flexWrap:"wrap" }}>
              <input
                placeholder="Filter items…"
                value={vaultFilter}
                onChange={e=>setVaultFilter(e.target.value)}
                style={{ padding:"6px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,0.12)",
                  background:"rgba(0,0,0,0.2)", color:"inherit", fontSize:13, width:200 }} />
              <div style={{ display:"flex", borderRadius:7, overflow:"hidden",
                border:"1px solid rgba(255,255,255,0.1)" }}>
                {[["qty","Qty ↓"],["name","A–Z"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setVaultSort(v)} style={{
                    padding:"5px 14px", border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                    background: vaultSort===v ? "rgba(255,255,255,0.1)" : "transparent",
                    color: vaultSort===v ? "#fff" : "rgba(255,255,255,0.4)",
                  }}>{l}</button>
                ))}
              </div>
              <span style={{ fontSize:12, opacity:0.35 }}>
                {vaultItemList.length} item{vaultItemList.length!==1?"s":""} shown
              </span>
            </div>
          )}

          {/* Empty state — no vault data at all */}
          {vaultData.items.length === 0 && vaultData.gold === 0 ? (
            <div style={{ opacity:0.35, fontSize:13, padding:"24px 0" }}>
              No vault activity found in the stored logs for this clan.
              Try <b>Refresh from API</b> to fetch the latest logs first.
            </div>
          ) : vaultItemList.length === 0 && !(vaultTier === 1 && vaultData.gold > 0) ? (
            /* Empty state — data exists, but nothing in this tier */
            <div style={{ opacity:0.35, fontSize:13, padding:"24px 0" }}>
              No items observed in Tier {vaultTier} yet.
            </div>
          ) : (
            /* Item grid — game style */
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {vaultTier === 1 && vaultData.gold > 0 && <GoldSlot amount={vaultData.gold} />}
              {vaultItemList.map(it=>(
                <VaultItemSlot key={it.name} name={it.name} snakeName={it.snakeName} qty={it.qty} />
              ))}
            </div>
          )}
        </>
      )}

      {!vaultLoading && vaultData === null && (
        <div style={{ opacity:0.35, fontSize:13, padding:"24px 0" }}>
          Click Reload to compute vault contents from stored logs.
        </div>
      )}

      {!vaultLoading && vaultData && vaultData.eventCount > 0 && (
        <div style={{ marginTop:16, fontSize:12, opacity:0.35 }}>
          Full vault transaction history is available in the <b>Logs</b> tab.
        </div>
      )}
    </div>
  );

  // ── OVERVIEW tab ──────────────────────────────────────────────────────────
  const tabOverview = (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div className="card">
          <div className="cardHeader"><div className="cardTitle">Clan info</div></div>
          <div className="cardBody">
            <KV label="Game mode"       value={modeLabel(clan.gameMode)} />
            <KV label="Category"        value={categoryLabel(clan.category)} />
            <KV label="Activity score"  value={clan.activityScore ?? "—"} />
            <KV label="Min total level" value={clan.minimumTotalLevelRequired ?? "—"} />
            <KV label="Recruiting"      value={clan.isRecruiting ? "Yes" : "No"} />
            <KV label="Language"        value={clan.language || "—"} />
            <KV label="House"           value={houseLabel(clan.houseId)} />
          </div>
        </div>
        {clan?.recruitmentMessage?.trim() && (
          <div className="card">
            <div className="cardHeader"><div className="cardTitle">Recruitment message</div></div>
            <div className="cardBody">
              <RecruitmentMessage raw={clan.recruitmentMessage} />
            </div>
          </div>
        )}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div className="card">
          <div className="cardHeader" style={{ justifyContent:"space-between" }}>
            <div className="cardTitle">Member activity</div>
            <select className="select" value={activityDays} style={{ fontSize:12 }}
              onChange={e=>setActivityDays(Number(e.target.value))}>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          <div className="cardBody">
            <OnlineHeatmap events={activity} days={activityDays} binMinutes={15} />
          </div>
        </div>
        {changes.length > 0 && (
          <div className="card">
            <div className="cardHeader"><div className="cardTitle">Recent joins / leaves</div></div>
            <div className="cardBody">
              <HistoryTimeline items={changes} />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── MEMBERS tab ───────────────────────────────────────────────────────────
  const tabMembers = (
    <div className="card">
      <div className="cardHeader" style={{ justifyContent:"space-between" }}>
        <div className="cardTitle">Members ({members.length})</div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {scan.running && (
            <div style={{ fontSize:12, opacity:0.6 }}>
              Refreshing… {scan.done}/{scan.total} ({progressPct}%)
              {scan.failed > 0 && <span style={{ color:"#f87171" }}> · {scan.failed} failed</span>}
              <div style={{ height:3, background:"rgba(255,255,255,0.1)", borderRadius:999, overflow:"hidden", marginTop:4, width:120 }}>
                <div style={{ width:`${progressPct}%`, height:"100%", background:"rgba(120,255,190,0.8)", borderRadius:999, transition:"width 0.3s" }} />
              </div>
            </div>
          )}
          <button className="btn" onClick={refreshMembers} disabled={scan.running}
            title="Fully refreshes every member's profile, activity logs, and leaderboard PvM ranks — one API call set per member, so this can take a while for large clans.">
            {scan.running ? "Refreshing…" : "Refresh members"}
          </button>
        </div>
      </div>
      <div className="cardBody">
        <MemberPills members={members} similarGroups={similarGroups} similarMeta={similarMeta} />
      </div>
    </div>
  );

  // ── SKILLS tab ────────────────────────────────────────────────────────────
  const tabSkills = (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div className="card">
        <div className="cardHeader"><div className="cardTitle">Clan skills</div></div>
        <div className="cardBody">
          {clanSkills.length > 0
            ? <SkillsGrid items={clanSkills} />
            : <div style={{ opacity:0.35, fontSize:13 }}>No skills data stored yet.</div>
          }
        </div>
      </div>
      <LeaderboardStandingsCard standings={standings} lastUpdated={clan.leaderboardStandingsAt} />
    </div>
  );

  // ── PVM tab ───────────────────────────────────────────────────────────────
  const BOSS_LABEL = {
    chimera:"Chimera", devil:"Devil", griffin:"Griffin", hades:"Hades",
    medusa:"Medusa", zeus:"Zeus", sobek:"Sobek", kronos:"Kronos",
    reckoning_of_the_gods:"Reckoning of the Gods",
    guardians_of_the_citadel:"Guardians of the Citadel",
    malignant_spider:"Malignant Spider", skeleton_warrior:"Skeleton Warrior",
    otherworldly_golem:"Otherworldly Golem", bloodmoon_massacre:"Bloodmoon Massacre",
    mesines:"Mesines",
  };

  const tabPvm = (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div className="card">
        <div className="cardHeader" style={{ justifyContent:"space-between" }}>
          <div className="cardTitle">PvM Stats</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {pvmData?.takenAt && (
              <span style={{ fontSize:12, opacity:0.4 }}>
                Snapshot: {new Date(pvmData.takenAt).toLocaleString()}
              </span>
            )}
            <button className="btn" disabled={pvmSnapBusy} onClick={async()=>{
              setPvmSnapBusy(true);
              try{
                const result = await api.fetchClanPvmProfile?.({ clanName: decoded });
                if (result?.ok){
                  setPvmData({ clanName: decoded, takenAt: result.takenAt, pvm: result.pvm });
                } else {
                  toast.warning(result?.reason === "not_found"
                    ? `Clan "${decoded}" not found on the leaderboard.`
                    : `Failed to fetch PvM stats: ${result?.reason || "unknown error"}`);
                }
              }catch(e){ toast.error(String(e?.message||e)); }
              finally{ setPvmSnapBusy(false); }
            }}>
              {pvmSnapBusy ? "Fetching…" : pvmData ? "Refresh snapshot" : "Fetch PvM stats"}
            </button>
          </div>
        </div>
        <div className="cardBody">
          {pvmLoading ? (
            <div style={{ fontSize:13, opacity:0.4 }}>Loading…</div>
          ) : !pvmData ? (
            <div style={{ fontSize:13, opacity:0.4 }}>
              No PvM snapshot yet. Click <b>Fetch PvM stats</b> to pull data from the leaderboard API.
            </div>
          ) : (()=>{
            const entries = Object.entries(pvmData.pvm || {});
            if (!entries.length) return (
              <div style={{ fontSize:13, opacity:0.4 }}>No boss data returned for this clan.</div>
            );
            return (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px,1fr))", gap:2 }}>
                {entries.map(([k, v])=>{
                  const score = Number(v?.score ?? v ?? 0);
                  const rank  = v?.rank != null ? Number(v.rank) : null;
                  const label = BOSS_LABEL[k] || k.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());

                  // Rank badge — tiered colour: gold top 10, green 11-25, blue 26-50, muted 51-100, dim 100+
                  const rankBadge = rank != null ? (()=>{
                    const [bg, col, fw] =
                      rank <= 10  ? ["rgba(var(--warning2-rgb),0.15)",  "var(--warning2)", 800] :
                      rank <= 25  ? ["rgba(var(--success-rgb),0.12)",  "var(--success)", 700] :
                      rank <= 50  ? ["rgba(var(--info-rgb),0.12)",  "var(--info)", 700] :
                      rank <= 100 ? ["rgba(255,255,255,0.07)", "rgba(255,255,255,0.55)", 600] :
                                    ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.3)",  500];
                    return (
                      <span style={{
                        fontSize:11, fontWeight:fw, color:col,
                        background:bg, borderRadius:5,
                        padding:"1px 6px", marginLeft:8,
                        letterSpacing:"0.02em", whiteSpace:"nowrap",
                      }}>
                        #{rank}
                      </span>
                    );
                  })() : null;

                  return (
                    <div key={k} style={{
                      display:"flex", justifyContent:"space-between", alignItems:"center",
                      gap:12, padding:"7px 0", borderBottom:"1px solid rgba(255,255,255,0.05)"
                    }}>
                      <span style={{ fontSize:13, opacity:0.6 }}>{label}</span>
                      <span style={{ fontSize:13, fontWeight:600, display:"flex", alignItems:"center" }}>
                        {score.toLocaleString()}
                        {rankBadge}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  // ── LOGS tab ──────────────────────────────────────────────────────────────
  const tabLogs = (
    <ActivityLog entityType="clan" entityName={decoded} refreshNonce={logsNonce} />
  );

  return (
    <div style={{ maxWidth:1200 }}>
      {header}
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab==="overview" && tabOverview}
      {tab==="members"  && tabMembers}
      {tab==="skills"   && tabSkills}
      {tab==="vault"    && tabVault}
      {tab==="pvm"      && tabPvm}
      {tab==="logs"     && tabLogs}
    </div>
  );
}
