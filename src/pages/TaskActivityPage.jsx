import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/bridge.js";

// ── Task Activity ─────────────────────────────────────────────────────────────
//
// Aggregates `taskNameOnLogout` across every stored player profile — a rough
// "what is everyone currently doing" snapshot based on each player's most
// recent scan. Not a live feed: a player's task only updates when their
// profile is next refreshed.

const GAME_MODES = [
  { key: "all",          label: "All modes" },
  { key: "default",      label: "Normal" },
  { key: "ironman",      label: "Ironman" },
  { key: "groupironman", label: "Group Ironman" },
];

// taskNameOnLogout comes from the API as raw snake_case (e.g.
// "titanium_ore", "ancient_tribe") — same as item/skill keys elsewhere in
// the game's data. Prettify for display only; the underlying task string
// (used for filtering/drill-down lookups) stays untouched.
function prettyTask(task){
  return String(task||"")
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function timeAgo(iso){
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TaskActivityPage(){
  const [tasks, setTasks]             = useState([]); // [{task, count}], sorted desc
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [totalWithTask, setTotalWithTask] = useState(0);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState("");
  const [gameMode, setGameMode]       = useState("all");

  // Drill-down
  const [selectedTask, setSelectedTask]   = useState(null);
  const [drillPlayers, setDrillPlayers]   = useState([]);
  const [drillLoading, setDrillLoading]   = useState(false);
  const [drillError,   setDrillError]     = useState(null);
  const [drillSearch, setDrillSearch]     = useState("");

  const [activeOnly, setActiveOnly] = useState(()=>{
    try{ return localStorage.getItem("taskActivity_activeOnly") === "1"; }catch{ return false; }
  });
  const [staleDays, setStaleDays] = useState(7);

  // Load staleDays from settings once
  useEffect(()=>{
    api.getSettings?.().then(s=>{
      const d = Number(s?.dormantThresholdDays ?? s?.autoRefreshStaleDays ?? 14);
      if (Number.isFinite(d) && d > 0) setStaleDays(d);
    }).catch(()=>{});
  }, []);

  function toggleActiveOnly(){
    setActiveOnly(v=>{
      const next = !v;
      try{ localStorage.setItem("taskActivity_activeOnly", next ? "1" : "0"); }catch{}
      return next;
    });
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    setSelectedTask(null);
    setDrillPlayers([]);
    try{
      const res = await api.getTaskActivitySummary?.({ gameMode, activeOnly });
      setTasks(Array.isArray(res?.tasks) ? res.tasks : []);
      setTotalPlayers(res?.totalPlayers || 0);
      setTotalWithTask(res?.totalWithTask || 0);
    }catch{
      setTasks([]); setTotalPlayers(0); setTotalWithTask(0);
    }finally{
      setLoading(false);
    }
  }, [gameMode, activeOnly]);

  useEffect(()=>{ loadAll(); }, [loadAll]);

  // ── DRILL-DOWN ──────────────────────────────────────────────────────────────
  const handleTaskClick = useCallback(async (task) => {
    if (selectedTask === task){
      setSelectedTask(null);
      setDrillPlayers([]);
      setDrillSearch("");
      return;
    }
    setSelectedTask(task);
    setDrillPlayers([]);
    setDrillSearch("");
    setDrillError(null);
    setDrillLoading(true);
    try{
      const result = await api.getPlayersByTask?.(task, { gameMode, activeOnly });
      if (Array.isArray(result)){
        setDrillPlayers(result);
      } else if (result && result.ok === false){
        setDrillError(result.error || "Request failed");
      } else if (result === undefined){
        setDrillError("getPlayersByTask is not available — the app may need a full restart to pick up this feature.");
      } else {
        setDrillError("Unexpected response shape from getPlayersByTask.");
      }
    }catch(e){ setDrillError(String(e?.message || e)); }
    finally{ setDrillLoading(false); }
  }, [selectedTask, gameMode, activeOnly]);

  // ── FILTERING ───────────────────────────────────────────────────────────────
  const searchQ = search.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    if (!searchQ) return tasks;
    return tasks.filter(t =>
      t.task.toLowerCase().includes(searchQ) ||
      prettyTask(t.task).toLowerCase().includes(searchQ)
    );
  }, [tasks, searchQ]);

  const filteredDrillPlayers = useMemo(() => {
    const q = drillSearch.trim().toLowerCase();
    if (!q) return drillPlayers;
    return drillPlayers.filter(p => p.username?.toLowerCase().includes(q));
  }, [drillPlayers, drillSearch]);

  const maxCount = tasks.length ? tasks[0].count : 0;
  const noTaskCount = Math.max(0, totalPlayers - totalWithTask);

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16, gap:10, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:18 }}>Task Activity</div>
          <div style={{ fontSize:13, opacity:0.5, marginTop:2 }}>
            {totalWithTask > 0
              ? `${totalWithTask.toLocaleString()} of ${totalPlayers.toLocaleString()} stored players reported a task on their last scan`
              : ""}
          </div>
        </div>
        <button className="btn" onClick={loadAll} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display:"flex", gap:10, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
        {/* Active-only toggle */}
        <button
          onClick={toggleActiveOnly}
          title={activeOnly
            ? `Showing active players only (not dormant within ${staleDays}d, excluded notFoundAt)`
            : "Showing all players — click to filter active only"}
          style={{
            display:"flex", alignItems:"center", gap:6,
            padding:"5px 12px", borderRadius:20, cursor:"pointer", fontSize:13,
            border: activeOnly
              ? "1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.5)"
              : "1px solid rgba(255,255,255,0.12)",
            background: activeOnly
              ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.12)"
              : "rgba(255,255,255,0.04)",
            color: activeOnly
              ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),1)"
              : "rgba(255,255,255,0.5)",
            fontWeight: activeOnly ? 700 : 400, flexShrink:0,
          }}>
          <span style={{
            width:10, height:10, borderRadius:"50%", flexShrink:0,
            background: activeOnly ? "#22c55e" : "rgba(255,255,255,0.2)",
          }} />
          {activeOnly ? "Active only" : "All players"}
        </button>

        {/* Game mode filter */}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {GAME_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setGameMode(m.key)}
              style={{
                padding:"4px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                background: gameMode === m.key ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.08)",
                color: gameMode === m.key ? "#fff" : "rgba(255,255,255,0.6)",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <input
          className="input"
          placeholder="Filter tasks…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width:200 }}
          autoComplete="off"
        />
        {search && (
          <span style={{ fontSize:12, opacity:0.45 }}>
            {filteredTasks.length.toLocaleString()} task{filteredTasks.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading && (
        <div style={{ opacity:0.4, textAlign:"center", padding:32 }}>Loading task activity…</div>
      )}

      {!loading && filteredTasks.length === 0 && (
        <div style={{ opacity:0.4, textAlign:"center", padding:32 }}>
          {search ? "No tasks match your search." : "No task data yet. Refresh some player profiles first."}
        </div>
      )}

      {/* Task list */}
      {!loading && filteredTasks.length > 0 && (
        <div className="card">
          <div className="cardBody">
            {filteredTasks.map(({ task, count }) => {
              const isOpen = selectedTask === task;
              const pct = maxCount ? Math.round((count / maxCount) * 100) : 0;

              return (
                <div key={task} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                  <div
                    style={{
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      padding:"9px 4px", cursor:"pointer", borderRadius:6, gap:12,
                      background: isOpen ? "rgba(var(--info-rgb),0.07)" : "transparent",
                      transition:"background 0.1s",
                    }}
                    onClick={() => handleTaskClick(task)}
                  >
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{prettyTask(task)}</div>
                      <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:999, overflow:"hidden" }}>
                        <div style={{
                          width:`${pct}%`, height:"100%",
                          background:"rgba(120,190,255,0.7)", borderRadius:999,
                          transition:"width 0.3s",
                        }} />
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                      <span style={{
                        fontSize:12, fontWeight:700,
                        background:"rgba(255,255,255,0.08)", borderRadius:6, padding:"1px 8px",
                      }}>
                        {count.toLocaleString()}
                      </span>
                      <span style={{ opacity:0.25, fontSize:11 }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {/* Drill-down */}
                  {isOpen && (
                    <div style={{ margin:"2px 0 8px 12px", padding:10, borderRadius:8, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)" }}>
                      {drillLoading ? (
                        <div style={{ fontSize:13, opacity:0.5 }}>Loading players…</div>
                      ) : drillError ? (
                        <div style={{ fontSize:13, color:"#f87171" }}>
                          Couldn't load players: {drillError}
                        </div>
                      ) : (
                        <>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                            <input
                              className="input"
                              placeholder="Filter players…"
                              value={drillSearch}
                              onChange={e => setDrillSearch(e.target.value)}
                              style={{ width:180, fontSize:12 }}
                            />
                            <span style={{ fontSize:12, opacity:0.4 }}>
                              {filteredDrillPlayers.length.toLocaleString()} player{filteredDrillPlayers.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {filteredDrillPlayers.length === 0 ? (
                            <div style={{ fontSize:13, opacity:0.4 }}>No players found.</div>
                          ) : (
                            <div style={{ maxHeight:260, overflowY:"auto", display:"flex", flexDirection:"column", gap:4 }}>
                              {filteredDrillPlayers.slice(0, 400).map(p => (
                                <div key={p.username} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, fontSize:13 }}>
                                  <Link
                                    to={`/players/${encodeURIComponent(p.username)}`}
                                    style={{ fontWeight:600, textDecoration:"none", color:"var(--accent,#60a5fa)" }}
                                  >
                                    {p.username}
                                  </Link>
                                  <div style={{ display:"flex", gap:10, alignItems:"center", opacity:0.5, fontSize:12 }}>
                                    {p.guildName && (
                                      <Link
                                        to={`/clans/${encodeURIComponent(p.guildName)}`}
                                        style={{ color:"inherit", textDecoration:"none" }}
                                        title="Clan"
                                      >
                                        {p.guildName}
                                      </Link>
                                    )}
                                    <span title="Last profile update">{timeAgo(p.updatedAt)}</span>
                                  </div>
                                </div>
                              ))}
                              {filteredDrillPlayers.length > 400 && (
                                <span style={{ fontSize:12, opacity:0.4 }}>
                                  +{(filteredDrillPlayers.length - 400).toLocaleString()} more
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && noTaskCount > 0 && !search && (
        <div style={{ fontSize:12, opacity:0.35, marginTop:14 }}>
          {noTaskCount.toLocaleString()} stored player{noTaskCount !== 1 ? "s" : ""} have no recorded task (never scanned, or task data unavailable).
        </div>
      )}

      <div style={{ fontSize:12, opacity:0.35, marginTop:8 }}>
        Based on each player's <b>task on logout</b> from their most recent profile scan — not a live feed.
        Refresh player or clan member profiles to update this data.
      </div>
    </div>
  );
}
