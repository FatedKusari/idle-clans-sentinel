import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/bridge.js";
import Collapsible from "../components/Collapsible.jsx";
import SkillsGrid from "../components/SkillsGrid.jsx";
import ActivityLog from "../components/ActivityLog.jsx";
import HistoryTimeline from "../components/HistoryTimeline.jsx";
import OnlineHeatmap from "../components/OnlineHeatmap.jsx";
import { sortPlayerSkills } from "../lib/skills.js";
import { useGameData } from "../lib/gameDataContext.jsx";
import { useToast } from "../components/Toast.jsx";
import { modeLabel } from "../lib/format.js";

// ── helpers ───────────────────────────────────────────────────────────────────


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

// Display labels for PvM boss/raid keys — matches the labels used on the
// clan PvM tab so player and clan pages read consistently.
const BOSS_LABEL = {
  chimera:"Chimera", devil:"Devil", griffin:"Griffin", hades:"Hades",
  medusa:"Medusa", zeus:"Zeus", sobek:"Sobek", kronos:"Kronos",
  reckoning_of_the_gods:"Reckoning of the Gods",
  guardians_of_the_citadel:"Guardians of the Citadel",
  malignant_spider:"Malignant Spider", skeleton_warrior:"Skeleton Warrior",
  otherworldly_golem:"Otherworldly Golem", bloodmoon_massacre:"Bloodmoon Massacre",
  mesines:"Mesines",
};

// Player pvmStats keys come back in PascalCase (e.g. "ReckoningOfTheGods",
// "MalignantSpider") rather than the snake_case category keys used by
// leaderboard boards ("reckoning_of_the_gods", "malignant_spider"). Convert
// so we can look up both the display label and any matching leaderboard
// standing for this boss.
function pascalToSnake(s){
  return String(s||"")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
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
        <button key={id} onClick={() => onChange(id)} style={{
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

function StaleBadge({ updatedAt }){
  if (!updatedAt) return <span style={{ fontSize:11, color:"var(--danger)", fontWeight:700 }}>⚠ Never refreshed</span>;
  const ageMs  = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000*60*60*24);
  if (ageDays >= 7) return (
    <span style={{ fontSize:11, color:"var(--warning)", fontWeight:700 }}
      title={`Last updated: ${new Date(updatedAt).toLocaleString()}`}>
      ⚠ Stale ({Math.floor(ageDays)}d old)
    </span>
  );
  return <span style={{ fontSize:11, opacity:0.45 }} title={`Last updated: ${new Date(updatedAt).toLocaleString()}`}>
    Updated {agoFromIso(updatedAt)}
  </span>;
}

// ── main ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id:"overview",  label:"Overview",  icon:"👤" },
  { id:"skills",    label:"Skills",    icon:"📊" },
  { id:"equipment", label:"Equipment", icon:"🛡" },
  { id:"pvm",       label:"PvM",       icon:"⚔" },
  { id:"logs",      label:"Logs",      icon:"📋" },
];

export default function PlayerDetailPage(){
  const { name } = useParams();
  const decoded  = useMemo(()=>decodeURIComponent(name||""), [name]);
  const { resolveItemName } = useGameData();
  const toast = useToast();

  const [player,       setPlayer]       = useState(null);
  const [loaded,       setLoaded]       = useState(false);
  const [tracked,      setTracked]      = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [logsNonce,    setLogsNonce]    = useState(0);
  const [bannedAt,     setBannedAt]     = useState(null);
  const [pvmDelta,     setPvmDelta]     = useState(null);
  const [pvmDeltaWindow, setPvmDeltaWindow] = useState("daily");
  const [pvmStatus,    setPvmStatus]    = useState(null);
  const [pvmSnapBusy,  setPvmSnapBusy]  = useState(false);

  // ── Leaderboard PvM profile ───────────────────────────────────────────────
  // Fetched from /Leaderboard/profile/players:{gameMode}/{name} — a single
  // call that returns ranks for every skill AND boss/raid for this player,
  // unlike clan-style leaderboard board scans which only cover one category
  // at a time. Cached locally; refreshed on demand via the button in the
  // PvM tab header.
  const [lbPvmFields,  setLbPvmFields]  = useState(null); // { [categoryKey]: {score, rank, expCapDate} }
  const [lbPvmTakenAt, setLbPvmTakenAt] = useState(null);
  const [lbPvmBusy,    setLbPvmBusy]    = useState(false);

  const [history,      setHistory]      = useState([]);
  const [onlineEvents, setOnlineEvents] = useState([]);
  const [chatRows,     setChatRows]     = useState([]);
  const [chatLoading,  setChatLoading]  = useState(false);
  const [chatFilter,   setChatFilter]   = useState("");
  const [chatBefore,   setChatBefore]   = useState(null);

  const [tab, setTab] = useState(()=>{
    try{ return localStorage.getItem("playerDetailTab_v1") || "overview"; }catch{ return "overview"; }
  });

  useEffect(()=>{
    try{ localStorage.setItem("playerDetailTab_v1", tab); }catch{}
  }, [tab]);

  async function load(){
    try{
      const p = await api.getPlayer(decoded);
      setPlayer(p);
      setBannedAt(p?.bannedAt || null);
      setTracked((await api.getTracked("player", decoded))?.enabled || false);
      setHistory(await api.getPlayerClanHistory(decoded, 200));
      setOnlineEvents(await api.getPlayerLastOnlineEvents(decoded, 7, 8000));
      try{
        if (pvmDeltaWindow === "daily"){
          setPvmDelta(await api.getPvmDelta24h(decoded));
        } else if (pvmDeltaWindow?.startsWith("h:")){
          setPvmDelta(await api.getPvmRollingDelta({ name:decoded, hours:Number(pvmDeltaWindow.slice(2))||1 }));
        }
      }catch{ setPvmDelta(null); }
      try{ setPvmStatus(await api.getPvmSnapshotStatus?.(decoded)); }catch{ setPvmStatus(null); }
      try{
        // Load any cached leaderboard PvM profile snapshot for this player's
        // game mode. This is a separate, on-demand fetch (see "Refresh
        // ranks" button in the PvM tab) — load() only reads what's cached
        // locally, it doesn't hit the API.
        const gm = (p?.gameMode === "ironman" || p?.gameMode === "groupironman") ? p.gameMode : "default";
        const snap = await api.getPlayerPvmLeaderboardSnapshot?.({ playerName: decoded, gameMode: gm });
        setLbPvmFields(snap?.fields || null);
        setLbPvmTakenAt(snap?.takenAt || null);
      }catch{ setLbPvmFields(null); setLbPvmTakenAt(null); }
    } finally { setLoaded(true); }
  }

  useEffect(()=>{ load(); }, [decoded]); // eslint-disable-line

  useEffect(()=>{
    (async()=>{
      if (!decoded) return;
      try{
        if (pvmDeltaWindow === "daily")
          setPvmDelta(await api.getPvmDelta24h(decoded));
        else if (pvmDeltaWindow?.startsWith("h:"))
          setPvmDelta(await api.getPvmRollingDelta({ name:decoded, hours:Number(pvmDeltaWindow.slice(2))||1 }));
      }catch(e){ console.warn("[PlayerDetail] failed to load PvM delta", e?.message); }
    })();
  }, [decoded, pvmDeltaWindow]); // eslint-disable-line

  async function refresh(){
    setBusy(true);
    try{
      await api.refreshPlayer(decoded);
      await api.fetchPlayerLogs(decoded);
      setLogsNonce(n=>n+1);
      await load();
      // Always fetch fresh leaderboard PvM ranks too, mirroring the clan
      // page's "Refresh from API" behaviour. Auto-falls-back across game
      // modes if the player's stored gameMode 404s on the leaderboard.
      // Re-fetch the player fresh here rather than using the `player` state
      // closure, since `load()` above updates state asynchronously and
      // `player` would still reflect the pre-refresh value at this point.
      try{
        const fresh = await api.getPlayer(decoded);
        const gm = (fresh?.gameMode === "ironman" || fresh?.gameMode === "groupironman") ? fresh.gameMode : "default";
        const result = await api.fetchPlayerPvmProfileAuto?.({ playerName: decoded, preferredGameMode: gm });
        if (result?.ok){
          setLbPvmFields(result.fields || null);
          setLbPvmTakenAt(result.takenAt || null);
        } else {
          // Fetch may have failed (e.g. not ranked on any board) — re-read
          // whatever is stored so the PvM tab isn't left blank.
          const snap = await api.getPlayerPvmLeaderboardSnapshot?.({ playerName: decoded, gameMode: gm });
          setLbPvmFields(snap?.fields || null);
          setLbPvmTakenAt(snap?.takenAt || null);
        }
      }catch(e){ console.warn("[PlayerDetail] fetchPlayerPvmProfileAuto during refresh failed:", e?.message); }
    } finally{ setBusy(false); }
  }

  async function toggleTracked(){
    const next = !tracked;
    setTracked(next);
    await api.setTracked("player", decoded, next);
  }

  async function toggleBanned(){
    const next = !bannedAt;
    const r = await api.setPlayerBanned(decoded, next);
    setBannedAt(r?.bannedAt || null);
    setPlayer(prev => prev ? { ...prev, bannedAt: r?.bannedAt || null } : prev);
  }

  async function loadChat({ reset=false }={}){
    if (!decoded) return;
    setChatLoading(true);
    try{
      const before = reset ? null : chatBefore;
      const rows = await api.getChatMessagesForPlayer({ playerName:decoded, limit:200, beforeTimestamp:before, q:chatFilter });
      if (reset) setChatRows(rows);
      else setChatRows(prev=>[...prev,...rows]);
      if (rows?.length) setChatBefore(rows[rows.length-1].timestamp);
    } finally{ setChatLoading(false); }
  }

  useEffect(()=>{
    setChatBefore(null); setChatRows([]);
    if (tab === "logs") loadChat({ reset:true });
  }, [decoded, chatFilter, tab]); // eslint-disable-line

  // ── not found ──────────────────────────────────────────────────────────────
  if (!player){
    if (!loaded) return <div style={{ opacity:0.4, padding:24 }}>Loading…</div>;
    return (
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:24 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>Player not in storage</div>
        <div style={{ fontSize:13, opacity:0.5, marginBottom:14 }}>
          This player hasn't been saved locally yet. Fetch their profile from the live API to store it.
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn btnPrimary" disabled={busy} onClick={async()=>{ setBusy(true); try{ await api.lookupPlayerLive(decoded); }finally{setBusy(false);} await load(); }}>
            Fetch from API
          </button>
          <Link className="btn" to={`/discover?mode=player&name=${encodeURIComponent(decoded)}`}>Open in Discover</Link>
        </div>
      </div>
    );
  }

  const skills = sortPlayerSkills(player.skillExperiences);

  // ── header ─────────────────────────────────────────────────────────────────
  const header = (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <Link className="btn" to="/players">← Back</Link>
          <span style={{ fontWeight:800, fontSize:20 }}>{player.username}</span>
          {!!player.chatModerator && <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6, background:"rgba(var(--info-rgb),0.15)", color:"var(--info)" }}>Mod</span>}
          {!!player.chatPremium   && <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6, background:"rgba(var(--warning2-rgb),0.15)", color:"var(--warning2)" }}>Premium</span>}
          {!!player.chatGilded    && <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6, background:"rgba(var(--warning-rgb),0.15)", color:"var(--warning)" }}>Gilded</span>}
          {!!bannedAt             && <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6, background:"rgba(var(--danger-rgb),0.15)", color:"var(--danger)" }}>Banned</span>}
          {player.guildName && (
            <Link to={`/clans/${encodeURIComponent(player.guildName)}`} style={{
              fontSize:13, fontWeight:600, padding:"3px 10px", borderRadius:8,
              background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)",
              textDecoration:"none", color:"inherit",
            }}>
              🏰 {player.guildName}
            </Link>
          )}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <button className="btn" onClick={toggleTracked} title="Flag for scheduled refreshes">
            <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background: tracked?"var(--success)":"rgba(255,255,255,0.25)", marginRight:6 }} />
            {tracked ? "Flagged" : "Flag"}
          </button>
          <button className={`btn${bannedAt?" btnDanger":""}`} onClick={toggleBanned}>
            {bannedAt ? "Unmark banned" : "Mark banned"}
          </button>
          <button className="btn btnPrimary" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh from API"}
          </button>
        </div>
      </div>
      <div style={{ marginTop:6, fontSize:12, opacity:0.5 }}>
        <StaleBadge updatedAt={player.updatedAt} />
      </div>
    </div>
  );

  // ── tabs ───────────────────────────────────────────────────────────────────

  // OVERVIEW
  const tabOverview = (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div className="card">
          <div className="cardHeader"><div className="cardTitle">Profile</div></div>
          <div className="cardBody">
            <KV label="Game mode"      value={modeLabel(player.gameMode)} />
            <KV label="Clan"           value={player.guildName
              ? <Link to={`/clans/${encodeURIComponent(player.guildName)}`} style={{ textDecoration:"none", color:"inherit", fontWeight:700 }}>{player.guildName}</Link>
              : "—"} />
            <KV label="Hours offline"  value={typeof player.hoursOffline==="number" ? player.hoursOffline : "—"} />
            <KV label="Task on logout" value={player.taskNameOnLogout || "—"} />
          </div>
        </div>

        {history.length > 0 && (
          <div className="card">
            <div className="cardHeader"><div className="cardTitle">Clan travel history</div></div>
            <div className="cardBody">
              <HistoryTimeline items={history} emptyText="No clan changes recorded yet." />
            </div>
          </div>
        )}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div className="card">
          <div className="cardHeader"><div className="cardTitle">Activity heatmap</div></div>
          <div className="cardBody">
            <OnlineHeatmap events={onlineEvents} days={7} binMinutes={15} />
          </div>
        </div>
      </div>
    </div>
  );

  // SKILLS
  const tabSkills = (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div className="card">
        <div className="cardHeader"><div className="cardTitle">Skills</div></div>
        <div className="cardBody">
          <SkillsGrid items={skills} />
        </div>
      </div>
      {player.upgrades && Object.keys(player.upgrades).length > 0 && (
        <div className="card">
          <div className="cardHeader"><div className="cardTitle">Upgrades</div></div>
          <div className="cardBody">
            {Object.entries(player.upgrades).map(([k,v])=>(
              <KV key={k} label={k} value={String(v)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // EQUIPMENT
  const tabEquipment = (
    <div className="card">
      <div className="cardHeader">
        <div className="cardTitle">Equipment</div>
        <span style={{ fontSize:12, opacity:0.4 }}>Names from cached game data</span>
      </div>
      <div className="cardBody">
        {player.equipment && Object.keys(player.equipment).length > 0
          ? Object.entries(player.equipment).map(([k,v])=>{
              // Value may be a plain int OR an API object { itemId, enchantment, ... }
              const rawId = (v !== null && typeof v === "object")
                ? (v?.itemId ?? v?.ItemId ?? v?.id ?? 0) : v;
              const id    = Number(rawId);
              const valid = Number.isFinite(id) && id > 0;
              // Prettify camelCase slot key: "rightHand" -> "Right Hand"
              const label = k.replace(/([A-Z])/g, " $1")
                             .replace(/^./, c => c.toUpperCase());
              return (
                <KV key={k} label={label}
                  value={valid
                    ? <span title={`Item ID: ${id}`}>{resolveItemName(id)}</span>
                    : "—"} />
              );
            })
          : <div style={{ opacity:0.35, fontSize:13 }}>No equipment data stored.</div>
        }
      </div>
    </div>
  );

  const tabPvm = (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div className="card">
        <div className="cardHeader" style={{ justifyContent:"space-between" }}>
          <div className="cardTitle">PvM Stats</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <select className="select" value={pvmDeltaWindow} style={{ width:160 }}
              onChange={e=>setPvmDeltaWindow(e.target.value)}>
              <option value="daily">+24h (daily)</option>
              <option value="h:1">Last 1 hour</option>
              <option value="h:6">Last 6 hours</option>
              <option value="h:24">Last 24 hours</option>
            </select>
            <button className="btn" disabled={pvmSnapBusy} onClick={async()=>{
              setPvmSnapBusy(true);
              try{
                await api.takePvmSnapshotNow?.(decoded);
                try{ setPvmStatus(await api.getPvmSnapshotStatus?.(decoded)); }catch(e){ console.warn("[PlayerDetail] getPvmSnapshotStatus failed", e?.message); }
                try{
                  if (pvmDeltaWindow==="daily") setPvmDelta(await api.getPvmDelta24h(decoded));
                  else if (pvmDeltaWindow?.startsWith("h:")) setPvmDelta(await api.getPvmRollingDelta({ name:decoded, hours:Number(pvmDeltaWindow.slice(2))||1 }));
                }catch(e){ console.warn("[PlayerDetail] getPvmDelta after snapshot failed", e?.message); }
              } finally{ setPvmSnapBusy(false); }
            }}>
              {pvmSnapBusy ? "Taking…" : "Take snapshot now"}
            </button>
            <button className="btn" disabled={lbPvmBusy} onClick={async()=>{
              setLbPvmBusy(true);
              try{
                const gm = (player?.gameMode === "ironman" || player?.gameMode === "groupironman") ? player.gameMode : "default";
                // Auto: tries the player's own game mode first, then falls
                // back through ironman/groupironman/default if that mode
                // 404s — covers cases where the stored gameMode is stale or
                // the player isn't ranked under it.
                const result = await api.fetchPlayerPvmProfileAuto?.({ playerName: decoded, preferredGameMode: gm });
                if (result?.ok){
                  setLbPvmFields(result.fields || null);
                  setLbPvmTakenAt(result.takenAt || null);
                  if (result.gameMode !== gm){
                    toast.success(`Found leaderboard profile under ${result.gameMode} mode.`);
                  }
                } else if (result?.reason === "not_found"){
                  toast.warning(`"${decoded}" wasn't found on any player leaderboard (default, ironman, group ironman).`);
                } else {
                  toast.error(`Failed to refresh ranks: ${result?.reason || "unknown error"}`);
                }
              }catch(e){ toast.error(String(e?.message||e)); }
              finally{ setLbPvmBusy(false); }
            }}>
              {lbPvmBusy ? "Refreshing…" : "Refresh ranks"}
            </button>
          </div>
        </div>
        <div className="cardBody">
          <div style={{ fontSize:12, opacity:0.45, marginBottom:12, display:"flex", gap:16, flexWrap:"wrap" }}>
            <span>Last snapshot: {pvmStatus?.lastTakenAt ? new Date(pvmStatus.lastTakenAt).toLocaleString() : "—"}</span>
            <span>Stored: {Number.isFinite(Number(pvmStatus?.daysStored)) ? pvmStatus.daysStored : 0} days</span>
            <span>Ranks updated: {lbPvmTakenAt ? new Date(lbPvmTakenAt).toLocaleString() : "—"}</span>
          </div>
          {player.pvmStats && Object.keys(player.pvmStats).length > 0
            ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px,1fr))", gap:2 }}>
                {Object.entries(player.pvmStats).map(([k,v])=>{
                  const score = Number(v) || 0;
                  const d = (pvmDelta?.hasBaseline && pvmDelta?.deltas && Number.isFinite(Number(pvmDelta.deltas[k]))) ? Number(pvmDelta.deltas[k]) : null;
                  const sign = d!=null&&d>=0 ? "+" : "";

                  const snakeKey = pascalToSnake(k);
                  const label = BOSS_LABEL[snakeKey] || titleCase(snakeKey);
                  const field = lbPvmFields?.[snakeKey];
                  const rank = field?.rank != null ? Number(field.rank) : null;

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
                        {d !== null && <span style={{ marginLeft:8, fontSize:12, color: d>0?"var(--success)":d<0?"var(--danger)":"rgba(255,255,255,0.4)" }}>({sign}{d})</span>}
                        {rankBadge}
                      </span>
                    </div>
                  );
                })}
              </div>
            )
            : <div style={{ opacity:0.35, fontSize:13 }}>No PvM stats stored.</div>
          }
          {!lbPvmFields && (
            <div style={{ fontSize:11, opacity:0.35, marginTop:10 }}>
              No leaderboard rank data cached for this player yet. Click <b>Refresh ranks</b> to pull skill and boss
              ranks from the leaderboard API.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // LOGS & CHAT
  const tabLogs = (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <ActivityLog entityType="player" entityName={decoded} refreshNonce={logsNonce} />

      <div className="card">
        <div className="cardHeader" style={{ justifyContent:"space-between" }}>
          <div className="cardTitle">Chat Messages</div>
          <div style={{ display:"flex", gap:8 }}>
            <input className="input" style={{ width:220 }} placeholder="Filter messages…"
              value={chatFilter} onChange={e=>setChatFilter(e.target.value)} />
            <button className="btn" onClick={()=>loadChat({ reset:true })} disabled={chatLoading}>Refresh</button>
          </div>
        </div>
        <div className="cardBody" style={{ maxHeight:"60vh", overflowY:"auto" }}>
          {chatRows.length===0 && !chatLoading && (
            <div style={{ opacity:0.35, fontSize:13 }}>No chat messages saved yet for this player.</div>
          )}
          {chatRows.map(m=>{
            const ts = m?.timestamp;
            let timeText="-", agoText="-";
            try{ if(ts){ const d=new Date(ts); if(!isNaN(d)){ timeText=d.toLocaleTimeString(); agoText=agoFromIso(ts); } } }catch{}
            const cat = m?.category||"-";
            const msg = m?.message ? String(m.message) : "";
            return (
              <div key={`${m?.id??""}-${ts??""}`} style={{ padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:11, fontWeight:700, padding:"1px 7px", borderRadius:5, background:"rgba(255,255,255,0.07)" }}>{cat}</span>
                    <span style={{ fontSize:12, opacity:0.5, fontFamily:"monospace" }}>{timeText}</span>
                  </div>
                  <span style={{ fontSize:12, opacity:0.4 }}>{agoText}</span>
                </div>
                <div style={{ fontSize:13 }}>{msg}</div>
              </div>
            );
          })}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10 }}>
            <span style={{ fontSize:12, opacity:0.4 }}>{chatLoading?"Loading…":""}</span>
            <button className="btn" style={{ fontSize:12 }} disabled={chatLoading||!chatRows.length} onClick={()=>loadChat({ reset:false })}>Load older</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth:1200 }}>
      {header}
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab==="overview"  && tabOverview}
      {tab==="skills"    && tabSkills}
      {tab==="equipment" && tabEquipment}
      {tab==="pvm"       && tabPvm}
      {tab==="logs"      && tabLogs}
    </div>
  );
}
