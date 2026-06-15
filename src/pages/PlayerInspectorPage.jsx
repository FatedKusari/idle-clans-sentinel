import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/bridge.js";
import { xpToLevel } from "../lib/xp.js";
import { PLAYER_SKILLS_ORDER } from "../lib/skills.js";
import { useGameData } from "../lib/gameDataContext.jsx";

// ── constants ─────────────────────────────────────────────────────────────────
const MAX_LEVEL   = 120;
const MAX_XP      = 500_000_000;
const XP_AT_120   = 88_474_739;

const EQUIP_SLOTS = [
  "head","cape","amulet","earrings","body","legs",
  "gloves","boots","bracelet","belt","leftHand","rightHand",
  "ammo","jewellery","pet",
];

import { modeLabel } from "../lib/format.js";

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtXpShort(n){
  const v = Number(n||0);
  if (!isFinite(v)) return "0";
  if (v >= 1e9) return (v/1e9).toFixed(2).replace(/\.00$/,"")+"B";
  if (v >= 1e6) return (v/1e6).toFixed(2).replace(/\.00$/,"")+"M";
  if (v >= 1e3) return (v/1e3).toFixed(1).replace(/\.0$/,"")+"K";
  return Math.round(v).toLocaleString();
}

function skillPct(xp){
  return Math.min(100, Math.round((Number(xp||0) / XP_AT_120) * 100 * 10) / 10);
}

function xpPct(xp){
  return Math.min(100, Math.round((Number(xp||0) / MAX_XP) * 100 * 10) / 10);
}

function fmtOffline(h){
  const n = Number(h);
  if (!isFinite(n)) return "—";
  if (n < 1)    return "< 1h";
  if (n < 24)   return `${Math.round(n)}h`;
  return `${(n/24).toFixed(1)}d`;
}

// Colour for a bar based on how close to max
function barColor(pct){
  if (pct >= 95) return "var(--warning2)"; // gold near max
  if (pct >= 75) return "var(--success)";
  if (pct >= 40) return "var(--info)";
  return "rgba(255,255,255,0.3)";
}

// ── sub-components (all outside export to avoid focus-loss) ───────────────────
function SectionLabel({ children }){
  return (
    <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase",
      opacity:0.4, marginBottom:8, marginTop:20 }}>{children}</div>
  );
}

function PlayerChip({ p, onRemove, onRefresh }){
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:8, padding:"5px 12px",
      borderRadius:8, fontSize:13, fontWeight:600,
      background: p.loading ? "rgba(255,255,255,0.04)"
        : p.error ? "rgba(var(--danger-rgb),0.1)"
        : "rgba(255,255,255,0.07)",
      border: p.error ? "1px solid rgba(var(--danger-rgb),0.3)" : "1px solid rgba(255,255,255,0.1)",
    }}>
      {p.loading && <span style={{ opacity:0.4, fontSize:11 }}>⟳</span>}
      <span>{p.name}</span>
      {p?.player?.guildName && <span style={{ opacity:0.35, fontSize:11 }}>· {p.player.guildName}</span>}
      {p.error && <span style={{ fontSize:11, color:"var(--danger)" }} title={p.error}>⚠</span>}
      <button onClick={()=>onRefresh(p.name)} disabled={p.loading}
        style={{ background:"none", border:"none", cursor:"pointer", opacity:0.4, fontSize:13, padding:"0 2px" }}>⟳</button>
      <button onClick={()=>onRemove(p.name)}
        style={{ background:"none", border:"none", cursor:"pointer", opacity:0.4, fontSize:15, padding:"0 2px" }}>×</button>
    </div>
  );
}

function SkillBar({ skill, xp, compareXp }){
  const level   = xpToLevel(xp);
  const pct     = skillPct(xp);
  const cmpLvl  = compareXp !== undefined ? xpToLevel(compareXp) : null;
  const diff    = cmpLvl !== null ? level - cmpLvl : null;

  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:3 }}>
        <span style={{ fontSize:12, opacity:0.65, textTransform:"capitalize" }}>{skill}</span>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {diff !== null && diff !== 0 && (
            <span style={{ fontSize:11, fontWeight:700,
              color: diff > 0 ? "var(--success)" : "var(--danger)" }}>
              {diff > 0 ? `+${diff}` : diff}
            </span>
          )}
          <span style={{ fontSize:13, fontWeight:700 }}>{level}</span>
          <span style={{ fontSize:10, opacity:0.35 }}>{fmtXpShort(xp)}</span>
        </div>
      </div>
      <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:999, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", borderRadius:999,
          background: barColor(pct), transition:"width 0.3s" }} />
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function PlayerInspectorPage(){
  const { resolveItemName } = useGameData();

  const [query,    setQuery]    = useState("");
  const [selected, setSelected] = useState(()=>{
    try{
      // Accept names pre-loaded from Cross-Clan Matches "Inspect players" button
      const raw = localStorage.getItem("idleclans_inspect_players_v1");
      if (raw){ localStorage.removeItem("idleclans_inspect_players_v1"); return JSON.parse(raw)||[]; }
    }catch{}
    return [];
  });         // string[]
  const [dataMap,  setDataMap]  = useState({});          // name -> { player, loading, error }
  const [suggs,    setSuggs]    = useState([]);
  const [busyAll,  setBusyAll]  = useState(false);
  const [tab,      setTab]      = useState("skills");    // skills | equipment | upgrades | pvm
  const [basePlayer, setBasePlayer] = useState(null);   // name to compare others against

  const debounceRef = useRef(null);

  // Auto-load any players pre-populated from Cross-Clan Matches
  useEffect(()=>{
    if (selected.length) {
      selected.forEach(name => loadOne(name));
      setBasePlayer(selected[0] || null);
    }
  }, []); // eslint-disable-line

  // ── search suggestions ─────────────────────────────────────────────────────
  useEffect(()=>{
    clearTimeout(debounceRef.current);
    if (!query.trim()){ setSuggs([]); return; }
    debounceRef.current = setTimeout(async()=>{
      try{ const list = await window.idleclans.listPlayers(query); setSuggs((list?.rows||list||[]).slice(0,8)); }
      catch{ setSuggs([]); }
    }, 150);
    return ()=>clearTimeout(debounceRef.current);
  }, [query]);

  // ── load / refresh ─────────────────────────────────────────────────────────
  async function loadOne(name, force=false){
    const nm = String(name||"").trim();
    if (!nm) return;
    setDataMap(prev=>({ ...prev, [nm]:{ ...(prev[nm]||{}), loading:true, error:null } }));
    try{
      if (force){ await window.idleclans.refreshPlayer(nm); }
      let p = await window.idleclans.getPlayer(nm);
      if (!p){ await window.idleclans.refreshPlayer(nm); p = await window.idleclans.getPlayer(nm); }
      setDataMap(prev=>({ ...prev, [nm]:{ player:p, loading:false, error:null } }));
    }catch(err){
      setDataMap(prev=>({ ...prev, [nm]:{ ...(prev[nm]||{}), loading:false, error:String(err?.message||err) } }));
    }
  }

  async function addPlayer(name){
    const nm = String(name||query||"").trim();
    if (!nm) return;
    if (selected.some(x=>x.toLowerCase()===nm.toLowerCase())){ setQuery(""); setSuggs([]); return; }
    setSelected(prev=>[...prev, nm]);
    if (!basePlayer) setBasePlayer(nm);
    setQuery(""); setSuggs([]);
    await loadOne(nm, true); // always fetch fresh profile on add
  }

  function removePlayer(name){
    setSelected(prev=>prev.filter(x=>x.toLowerCase()!==name.toLowerCase()));
    setDataMap(prev=>{ const c={...prev}; delete c[name]; return c; });
    if (basePlayer === name) setBasePlayer(selected.filter(x=>x!==name)[0]||null);
  }

  async function refreshAll(){
    setBusyAll(true);
    try{ for (const n of selected) await loadOne(n, true); }
    finally{ setBusyAll(false); }
  }

  // ── derived data ───────────────────────────────────────────────────────────
  const players = useMemo(()=>
    selected.map(name=>({ name, ...(dataMap[name]||{}) })),
    [selected, dataMap]
  );

  const baseData = useMemo(()=>
    basePlayer ? dataMap[basePlayer]?.player : null,
    [basePlayer, dataMap]
  );

  // ── tab: skills ────────────────────────────────────────────────────────────
  const tabSkills = useMemo(()=>{
    if (!players.length) return null;
    // Total level + XP completion stats per player
    const stats = players.map(p=>{
      const skills = p?.player?.skillExperiences || {};
      const levels = PLAYER_SKILLS_ORDER.map(s=>xpToLevel(skills[s]||0));
      const totalLevel = levels.reduce((a,b)=>a+b,0);
      const maxTotalLevel = PLAYER_SKILLS_ORDER.length * MAX_LEVEL;
      const totalXp = PLAYER_SKILLS_ORDER.reduce((a,s)=>a+Number(skills[s]||0),0);
      const maxXp = PLAYER_SKILLS_ORDER.length * MAX_XP;
      const at120 = levels.filter(l=>l>=MAX_LEVEL).length;
      return { name:p.name, totalLevel, totalXp, at120, maxTotalLevel, maxXp, skills };
    });

    return (
      <div>
        {/* Summary cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10, marginBottom:20 }}>
          {stats.map(s=>(
            <div key={s.name} style={{
              background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:10, padding:"12px 14px",
              ...(s.name===basePlayer ? { borderColor:"rgba(var(--info-rgb),0.3)" } : {}),
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <Link to={`/players/${encodeURIComponent(s.name)}`}
                  style={{ fontWeight:800, fontSize:14, textDecoration:"none", color:"inherit" }}>{s.name}</Link>
                <button onClick={()=>setBasePlayer(s.name)} style={{
                  fontSize:10, padding:"2px 7px", borderRadius:4, border:"none", cursor:"pointer",
                  background: s.name===basePlayer ? "rgba(var(--info-rgb),0.2)" : "rgba(255,255,255,0.07)",
                  color: s.name===basePlayer ? "var(--info)" : "rgba(255,255,255,0.5)",
                  fontWeight:700,
                }}>{s.name===basePlayer ? "Base ✓" : "Set base"}</button>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6 }}>
                <span style={{ opacity:0.5 }}>Total level</span>
                <span style={{ fontWeight:800 }}>{s.totalLevel.toLocaleString()} <span style={{ opacity:0.4, fontSize:11 }}>/ {s.maxTotalLevel.toLocaleString()}</span></span>
              </div>
              <div style={{ height:4, background:"rgba(255,255,255,0.07)", borderRadius:999, marginBottom:8 }}>
                <div style={{ width:`${Math.round(s.totalLevel/s.maxTotalLevel*100)}%`, height:"100%", background:"var(--info)", borderRadius:999, opacity:0.7 }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, opacity:0.5 }}>
                <span>{s.at120} / {PLAYER_SKILLS_ORDER.length} at 120</span>
                <span>{fmtXpShort(s.totalXp)} XP</span>
              </div>
            </div>
          ))}
        </div>

        {/* Per-skill bars */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:20 }}>
          {players.map(p=>{
            const skills = p?.player?.skillExperiences || {};
            const base   = baseData?.skillExperiences || {};
            return (
              <div key={p.name}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:10, opacity:0.8 }}>{p.name}</div>
                {PLAYER_SKILLS_ORDER.map(skill=>(
                  <SkillBar key={skill} skill={skill} xp={skills[skill]}
                    compareXp={p.name!==basePlayer && basePlayer ? base[skill] : undefined} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [players, basePlayer, baseData]);

  // ── tab: equipment ─────────────────────────────────────────────────────────
  const tabEquipment = useMemo(()=>{
    if (!players.length) return null;
    return (
      <div style={{ overflowX:"auto" }}>
        <table className="table" style={{ minWidth:400 }}>
          <thead>
            <tr>
              <th style={{ width:120 }}>Slot</th>
              {players.map(p=><th key={p.name}>{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {EQUIP_SLOTS.map(slot=>{
              const values = players.map(p=>{
                const eq = p?.player?.equipment || {};
                const raw = eq[slot] ?? eq[slot?.toUpperCase?.()] ?? eq[slot?.toLowerCase?.()];
                return raw != null ? resolveItemName?.(raw) || `#${raw}` : "—";
              });
              const allSame = values.every(v=>v===values[0]);
              return (
                <tr key={slot}>
                  <td style={{ fontWeight:600, textTransform:"capitalize", opacity:0.7 }}>{slot}</td>
                  {values.map((v,i)=>(
                    <td key={i} style={{
                      fontWeight: !allSame && v!=="—" ? 600 : undefined,
                      color: !allSame && players[i] && v!=="—" ? "rgba(255,255,255,0.9)" : undefined,
                    }}>{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [players, resolveItemName]);

  // ── tab: upgrades ──────────────────────────────────────────────────────────
  const tabUpgrades = useMemo(()=>{
    if (!players.length) return null;
    // Collect all upgrade keys
    const keys = new Set();
    for (const p of players) Object.keys(p?.player?.upgrades||{}).forEach(k=>keys.add(k));
    if (!keys.size) return <div style={{ opacity:0.35, fontSize:13 }}>No upgrade data stored for these players.</div>;
    const keyList = Array.from(keys).sort();

    return (
      <div style={{ overflowX:"auto" }}>
        <table className="table" style={{ minWidth:400 }}>
          <thead>
            <tr>
              <th style={{ width:180 }}>Upgrade</th>
              {players.map(p=><th key={p.name}>{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {keyList.map(key=>{
              const values = players.map(p=>(p?.player?.upgrades||{})[key]);
              const allSame = values.every(v=>String(v??"")=== String(values[0]??""));
              return (
                <tr key={key}>
                  <td style={{ fontWeight:600, textTransform:"capitalize", opacity:0.7 }}>{key.replace(/_/g," ")}</td>
                  {values.map((v,i)=>(
                    <td key={i} style={{
                      fontWeight: !allSame && v!=null ? 600 : undefined,
                      color: !allSame && v!=null ? "rgba(255,255,255,0.9)" : undefined,
                    }}>{v != null ? String(v) : <span style={{opacity:0.3}}>—</span>}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [players]);

  // ── tab: PvM ──────────────────────────────────────────────────────────────
  const tabPvm = useMemo(()=>{
    if (!players.length) return null;
    const keys = new Set();
    for (const p of players) Object.keys(p?.player?.pvmStats||{}).forEach(k=>keys.add(k));
    if (!keys.size) return <div style={{ opacity:0.35, fontSize:13 }}>No PvM data stored for these players.</div>;
    const keyList = Array.from(keys).sort();
    const baseStats = baseData?.pvmStats || {};

    return (
      <div style={{ overflowX:"auto" }}>
        <table className="table" style={{ minWidth:400 }}>
          <thead>
            <tr>
              <th style={{ width:180 }}>Boss</th>
              {players.map(p=><th key={p.name}>{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {keyList.map(key=>{
              const values = players.map(p=>Number(p?.player?.pvmStats?.[key]||0));
              const maxVal = Math.max(...values, 1);
              return (
                <tr key={key}>
                  <td style={{ fontWeight:600, opacity:0.7 }}>{key}</td>
                  {values.map((v,i)=>{
                    const baseVal = basePlayer && players[i].name!==basePlayer ? Number(baseStats[key]||0) : null;
                    const diff = baseVal !== null ? v - baseVal : null;
                    return (
                      <td key={i}>
                        <span style={{ fontWeight:700 }}>{v.toLocaleString()}</span>
                        {diff !== null && diff !== 0 && (
                          <span style={{ marginLeft:6, fontSize:11, color:diff>0?"var(--success)":"var(--danger)" }}>
                            {diff>0?"+":""}{diff.toLocaleString()}
                          </span>
                        )}
                        {v > 0 && (
                          <div style={{ marginTop:2, height:3, background:"rgba(255,255,255,0.07)", borderRadius:999, overflow:"hidden" }}>
                            <div style={{ width:`${Math.round(v/maxVal*100)}%`, height:"100%", background:"rgba(var(--info-rgb),0.6)", borderRadius:999 }} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [players, basePlayer, baseData]);

  // ── tabs config ────────────────────────────────────────────────────────────
  const TABS = [
    { id:"skills",    label:"Skills" },
    { id:"equipment", label:"Equipment" },
    { id:"upgrades",  label:"Upgrades" },
    { id:"pvm",       label:"PvM" },
  ];

  const hasAnyPlayer = players.some(p=>p.player);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── Search bar (outside card so dropdown is never clipped) ──── */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"14px 18px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Player Inspector</div>
            <div style={{ fontSize:12, opacity:0.4, marginTop:1 }}>Compare skills · equipment · upgrades · PvM kills across multiple players</div>
          </div>
          {selected.length > 0 && (
            <button className="btn" onClick={refreshAll} disabled={busyAll} style={{ flexShrink:0 }}>
              {busyAll ? "Refreshing…" : "Refresh all"}
            </button>
          )}
        </div>

        {/* Search input — plain div so the dropdown is never clipped */}
        <div style={{ position:"relative", display:"flex", gap:8 }}>
          <div style={{ flex:1, position:"relative" }}>
            <input className="input" style={{ width:"100%" }}
              placeholder="Search for a player to add…"
              value={query}
              onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") addPlayer(); }}
            />
            {suggs.length > 0 && (
              <div style={{
                position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:200,
                background:"rgba(6,22,14,0.98)", border:"1px solid rgba(255,255,255,0.14)",
                borderRadius:10, overflow:"hidden", boxShadow:"0 12px 32px rgba(0,0,0,0.5)",
              }}>
                {suggs.map(s=>(
                  <div key={s.username||s.lowerName}
                    onMouseDown={()=>addPlayer(s.username)}
                    style={{ padding:"10px 14px", cursor:"pointer", fontSize:13,
                      borderBottom:"1px solid rgba(255,255,255,0.05)" }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  >
                    <span style={{ fontWeight:700 }}>{s.username}</span>
                    <span style={{ opacity:0.45, marginLeft:10, fontSize:12 }}>
                      {modeLabel(s.gameMode)}{s.guildName ? ` · ${s.guildName}` : ""}
                    </span>
                    {s.bannedAt && <span style={{ marginLeft:8, fontSize:11, color:"var(--danger)", fontWeight:700 }}>BANNED</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btnPrimary" onClick={()=>addPlayer()} disabled={!query.trim()}>Add</button>
        </div>

        {/* Player chips */}
        {selected.length > 0 && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:12 }}>
            {players.map(p=>(
              <PlayerChip key={p.name} p={p}
                onRemove={removePlayer}
                onRefresh={n=>loadOne(n,true)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {!selected.length && (
        <div style={{ textAlign:"center", opacity:0.3, padding:48, fontSize:14 }}>
          Add two or more players above to compare their profiles.
        </div>
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      {hasAnyPlayer && (
        <>
          <div style={{ display:"flex", gap:0, borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                padding:"10px 20px", background:"none", border:"none", cursor:"pointer",
                fontSize:13, fontWeight: tab===t.id ? 700 : 500,
                color: tab===t.id ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.4)",
                borderBottom: tab===t.id ? "2px solid var(--accent,#60a5fa)" : "2px solid transparent",
                marginBottom:-1,
              }}>{t.label}</button>
            ))}
            {basePlayer && (
              <div style={{ marginLeft:"auto", alignSelf:"center", fontSize:12, opacity:0.45, paddingRight:4 }}>
                Base: <span style={{ fontWeight:700, opacity:1 }}>{basePlayer}</span>
              </div>
            )}
          </div>

          {/* Tab content */}
          <div>
            {tab === "skills"    && tabSkills}
            {tab === "equipment" && tabEquipment}
            {tab === "upgrades"  && tabUpgrades}
            {tab === "pvm"       && tabPvm}
          </div>
        </>
      )}
    </div>
  );
}
