import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/bridge.js";
import { xpToLevel, fmtXp } from "../lib/xp.js";
import xpThresholds from "../lib/xpTable.js";
import { PLAYER_SKILLS_ORDER } from "../lib/skills.js";

const MAX_LEVEL = 120;
const SKILL_ICONS = {
  attack:"⚔️", strength:"💪", defence:"🛡️", archery:"🏹", magic:"🔮",
  health:"❤️", crafting:"🔨", woodcutting:"🪵", carpentry:"🪚", fishing:"🎣",
  cooking:"🍳", mining:"⛏️", smithing:"🔩", foraging:"🌿", farming:"🌾",
  agility:"👟", plundering:"🗝️", enchanting:"✨", brewing:"🍺",
  exterminating:"🐛", invocation:"📿",
};

const BOSS_KEYS = [
  "chimera","devil","griffin","hades","medusa","zeus","sobek","kronos",
  "reckoning_of_the_gods","guardians_of_the_citadel","malignant_spider",
  "skeleton_warrior","otherworldly_golem","bloodmoon_massacre","mesines",
];
const BOSS_LABEL = {
  chimera:"Chimera", devil:"Devil", griffin:"Griffin", hades:"Hades",
  medusa:"Medusa", zeus:"Zeus", sobek:"Sobek", kronos:"Kronos",
  reckoning_of_the_gods:"Reckoning of the Gods",
  guardians_of_the_citadel:"Guardians of the Citadel",
  malignant_spider:"Malignant Spider", skeleton_warrior:"Skeleton Warrior",
  otherworldly_golem:"Otherworldly Golem", bloodmoon_massacre:"Bloodmoon Massacre",
  mesines:"Mesines",
};

function fmtTs(ts){
  if (!ts) return "—";
  try{ return new Date(ts).toLocaleString(undefined,{month:"short",day:"2-digit",
    hour:"2-digit",minute:"2-digit"}); }catch{ return ts; }
}
function fmtDate(ts){
  if (!ts) return "—";
  try{ return new Date(ts).toLocaleDateString(undefined,{month:"short",day:"2-digit"}); }
  catch{ return ts; }
}
function diffDays(a, b){
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function titleCase(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

// Returns the fraction of progress within the current level [0, 1].
// At max level the bar is full (1.0).
function withinLevelPct(xp, level){
  if (level >= MAX_LEVEL) return 1;
  const floor = Number(xpThresholds[level]     || 0);
  const ceil  = Number(xpThresholds[level + 1] || 0);
  if (ceil <= floor) return 1;
  return Math.max(0, Math.min(1, (xp - floor) / (ceil - floor)));
}

const SKILL_IMAGE = {
  attack:"rigour", strength:"strength", defence:"defence", archery:"archery",
  magic:"magic", health:"health", crafting:"crafting", woodcutting:"woodcutting",
  carpentry:"carpentry", fishing:"fishing", cooking:"cooking", mining:"mining",
  smithing:"smithing", foraging:"foraging", farming:"farming", agility:"agility",
  plundering:"plundering", enchanting:"enchanting", brewing:"brewing",
  exterminating:"exterminating", invocation:"invocation",
};

function SkillImg({ skillKey }){
  const [err, setErr] = useState(false);
  const name = SKILL_IMAGE[skillKey];
  if (name && !err){
    return (
      <img src={"/gameimages/" + name + ".png"} alt={skillKey}
        onError={()=>setErr(true)}
        style={{ width:22, height:22, objectFit:"contain", imageRendering:"pixelated", flexShrink:0 }} />
    );
  }
  return (
    <span style={{ fontSize:16, width:22, textAlign:"center", flexShrink:0 }}>
      {SKILL_ICONS[skillKey] || "•"}
    </span>
  );
}

function SkillBar({ skillKey, xp, prevXp, showDelta }){
  const level    = xpToLevel(xp);
  const gained   = showDelta && prevXp != null ? xpToLevel(xp) - xpToLevel(prevXp) : 0;
  const xpGained = showDelta && prevXp != null ? xp - prevXp : 0;
  // Within-level progress: how far through this level's XP band are we?
  const pct      = withinLevelPct(xp, level) * 100;
  const colour   = level >= 110 ? "var(--warning)"
                 : level >= 100 ? "#a78bfa"
                 : level >= 80  ? "var(--success)"
                 : "var(--info)";

  // XP needed to reach next level (tooltip info)
  const xpToNext = level < MAX_LEVEL
    ? Math.max(0, Number(xpThresholds[level + 1] || 0) - xp) : 0;

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0",
      borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
      <SkillImg skillKey={skillKey} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
          marginBottom:4 }}>
          <span style={{ fontSize:13, fontWeight:600 }}>{titleCase(skillKey)}</span>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {gained > 0 && (
              <span style={{ fontSize:11, color:"var(--success)", fontWeight:700 }}>
                +{gained} lvl
              </span>
            )}
            {xpGained > 0 && (
              <span style={{ fontSize:11, opacity:0.5 }}>+{fmtXp(xpGained)} xp</span>
            )}
            <span style={{ fontSize:14, fontWeight:800, minWidth:32, textAlign:"right" }}>
              {level}
            </span>
          </div>
        </div>
        <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:3 }}
          title={level < MAX_LEVEL ? `${fmtXp(xpToNext)} xp to level ${level + 1}` : "Max level"}>
          <div style={{ width:`${pct}%`, height:"100%", borderRadius:3,
            background:colour, transition:"width 0.3s" }} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, colour="var(--success)" }){
  return (
    <div style={{ padding:"14px 16px", borderRadius:10,
      background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)",
      flex:1, minWidth:120 }}>
      <div style={{ fontSize:11, opacity:0.4, textTransform:"uppercase",
        letterSpacing:"0.06em", marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:800, color:colour }}>{value}</div>
      {sub && <div style={{ fontSize:12, opacity:0.45, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function AccountSkillsPage(){
  const { username } = useParams();
  const navigate     = useNavigate();

  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [snapBusy,  setSnapBusy]  = useState(false);
  const [snapMsg,   setSnapMsg]   = useState(null);
  const [period,    setPeriod]    = useState("7d");
  const [activeTab, setActiveTab] = useState("skills"); // "skills" | "pvm"

  async function load(){
    setLoading(true);
    try{
      const rows = await api.accountsSkillHistory?.(username, { limit:180 }) || [];
      setHistory(rows);
    }catch(e){ console.warn("[AccountSkills] failed to load skill history", e?.message); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); }, [username]); // eslint-disable-line

  async function takeSnapshot(){
    setSnapBusy(true); setSnapMsg(null);
    try{
      const r = await api.accountsSnapshotSkills?.(username);
      if (r?.ok && !r?.skipped) setSnapMsg("✓ Snapshot saved");
      else if (r?.skipped)      setSnapMsg("Already snapped this hour — no change");
      else                      setSnapMsg(`Failed: ${r?.error||"unknown"}`);
      await load();
    }catch(e){ setSnapMsg(String(e?.message||e)); }
    finally{ setSnapBusy(false); setTimeout(()=>setSnapMsg(null), 4000); }
  }

  // Filter history by period
  const filtered = useMemo(()=>{
    if (period === "all") return history;
    const days = period==="1d"?1:period==="7d"?7:30;
    const cutoff = new Date(Date.now() - days*86400000).toISOString();
    return history.filter(r=>r.snappedAt >= cutoff);
  }, [history, period]);

  const latest = filtered[0] || null;
  const oldest = filtered[filtered.length-1] || null;

  // Compute per-skill deltas between oldest and latest in the window
  const deltas = useMemo(()=>{
    if (!latest || !oldest || latest === oldest) return {};
    const d = {};
    for (const sk of PLAYER_SKILLS_ORDER){
      const curr = Number(latest.skills?.[sk] || 0);
      const prev = Number(oldest.skills?.[sk] || 0);
      if (curr > prev) d[sk] = { xpGained: curr-prev, levelsGained: xpToLevel(curr)-xpToLevel(prev) };
    }
    return d;
  }, [latest, oldest]);

  // Total level + XP from latest snapshot
  const totalLevel = useMemo(()=>{
    if (!latest?.skills) return 0;
    return PLAYER_SKILLS_ORDER
      .filter(sk=>sk in latest.skills)
      .reduce((s,sk)=>s+xpToLevel(Number(latest.skills[sk]||0)),0);
  }, [latest]);

  const totalXpGained = useMemo(()=>{
    if (!latest || !oldest || latest===oldest) return 0;
    return Object.values(deltas).reduce((s,d)=>s+d.xpGained, 0);
  }, [deltas]);

  const levelsGained = useMemo(()=>{
    return Object.values(deltas).reduce((s,d)=>s+d.levelsGained, 0);
  }, [deltas]);

  const daySpan = latest && oldest && latest!==oldest
    ? diffDays(oldest.snappedAt, latest.snappedAt) || 1 : null;

  // Skills with gains in this period
  const changedSkills = PLAYER_SKILLS_ORDER.filter(sk=>deltas[sk]?.levelsGained > 0);
  const allSkills     = PLAYER_SKILLS_ORDER.filter(sk=>latest?.skills?.[sk] != null);

  // PvM deltas between oldest and latest
  const pvmDeltas = useMemo(()=>{
    if (!latest?.pvm) return {};
    const d = {};
    for (const k of BOSS_KEYS){
      const curr = Number(latest.pvm?.[k] ?? 0);
      const prev = Number(oldest?.pvm?.[k] ?? 0);
      d[k] = { curr, gained: oldest && oldest !== latest ? Math.max(0, curr - prev) : 0 };
    }
    return d;
  }, [latest, oldest]);

  const hasPvmData = latest?.pvm && Object.keys(latest.pvm).length > 0;
  const totalKills = hasPvmData
    ? BOSS_KEYS.reduce((s,k)=>s + Number(latest.pvm?.[k] ?? 0), 0) : 0;
  const killsGained = Object.values(pvmDeltas).reduce((s,d)=>s + d.gained, 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button className="btn" onClick={()=>navigate("/my-accounts")}
            style={{ fontSize:13, padding:"4px 12px" }}>← Back</button>
          <div>
            <div style={{ fontWeight:800, fontSize:20 }}>{username}</div>
            <div style={{ fontSize:12, opacity:0.4 }}>
              Skill progress · {history.length} snapshot{history.length!==1?"s":""}
              {latest && <> · Last: {fmtTs(latest.snappedAt)}</>}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {snapMsg && <span style={{ fontSize:12, opacity:0.7 }}>{snapMsg}</span>}
          <button className="btn btnPrimary" onClick={takeSnapshot} disabled={snapBusy}>
            {snapBusy?"Snapping…":"Snapshot now"}
          </button>
          <button className="btn"
            onClick={()=>navigate(`/players/${encodeURIComponent(username)}`)}>
            View profile
          </button>
        </div>
      </div>

      {/* ── No data ────────────────────────────────────────────── */}
      {!loading && history.length === 0 && (
        <div style={{ textAlign:"center", opacity:0.35, padding:48, fontSize:13 }}>
          No snapshots yet. Click "Snapshot now" to record your current skill levels,
          or wait for the next auto-refresh.
        </div>
      )}

      {latest && (
        <>
          {/* ── Period picker ──────────────────────────────────── */}
          <div style={{ display:"flex", gap:6 }}>
            {[["1d","1 Day"],["7d","7 Days"],["30d","30 Days"],["all","All time"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPeriod(v)}
                className="btn"
                style={{ padding:"4px 14px", fontSize:12,
                  background:period===v?"rgba(var(--success-rgb),0.15)":"",
                  color:period===v?"var(--success)":"",
                  border:period===v?"1px solid rgba(var(--success-rgb),0.35)":"" }}>
                {l}
              </button>
            ))}
            {oldest && latest !== oldest && (
              <span style={{ alignSelf:"center", fontSize:12, opacity:0.35, marginLeft:4 }}>
                {fmtDate(oldest.snappedAt)} → {fmtDate(latest.snappedAt)}
              </span>
            )}
          </div>

          {/* ── Tab bar ────────────────────────────────────────── */}
          <div style={{ display:"flex", gap:6, borderBottom:"1px solid rgba(255,255,255,0.08)", paddingBottom:0 }}>
            {[["skills","Skills"],["pvm","PvM Kills"]].map(([id,label])=>(
              <button key={id} onClick={()=>setActiveTab(id)} style={{
                background:"none", border:"none", cursor:"pointer",
                padding:"8px 16px", fontSize:13, fontWeight: activeTab===id ? 700 : 400,
                color: activeTab===id ? "var(--text)" : "var(--muted)",
                borderBottom: activeTab===id ? "2px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.8)" : "2px solid transparent",
                marginBottom:-1,
              }}>{label}</button>
            ))}
          </div>

          {/* ── Summary stats ──────────────────────────────────── */}
          {activeTab === "skills" && (
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard label="Total Level" value={totalLevel.toLocaleString()} />
            <StatCard label="Total XP" value={fmtXp(latest.totalXp||0)} colour="var(--info)" />
            {daySpan && <>
              <StatCard
                label={`XP gained (${period})`}
                value={fmtXp(totalXpGained)}
                sub={totalXpGained>0 ? `${fmtXp(totalXpGained/daySpan)}/day avg` : null}
                colour="var(--success)" />
              <StatCard
                label={`Levels gained (${period})`}
                value={levelsGained>0?`+${levelsGained}`:"—"}
                sub={changedSkills.length>0?`across ${changedSkills.length} skill${changedSkills.length!==1?"s":""}`:null}
                colour={levelsGained>0?"var(--success)":"rgba(255,255,255,0.4)"} />
            </>}
          </div>
          )}

          {activeTab === "pvm" && (
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard label="Total kills" value={totalKills.toLocaleString()} colour="var(--warning)" />
            {daySpan && killsGained > 0 && (
              <StatCard
                label={`Kills gained (${period})`}
                value={`+${killsGained.toLocaleString()}`}
                sub={`${Math.round(killsGained/daySpan).toLocaleString()}/day avg`}
                colour="var(--success)" />
            )}
          </div>
          )}

          {/* ── Skills tab ─────────────────────────────────────── */}
          {activeTab === "skills" && (
          <div className="card">
            <div className="cardHeader" style={{ display:"flex",
              justifyContent:"space-between", alignItems:"center" }}>
              <div className="cardTitle">Skills</div>
              <span style={{ fontSize:12, opacity:0.4 }}>
                {changedSkills.length > 0
                  ? `${changedSkills.length} skill${changedSkills.length!==1?"s":""} progressed`
                  : latest===oldest ? "No comparison available" : "No change in period"}
              </span>
            </div>
            <div className="cardBody">
              {allSkills.map(sk=>(
                <SkillBar key={sk}
                  skillKey={sk}
                  xp={Number(latest.skills[sk]||0)}
                  prevXp={oldest && oldest!==latest ? Number(oldest.skills?.[sk]||0) : null}
                  showDelta={oldest && oldest!==latest} />
              ))}
            </div>
          </div>
          )}

          {/* ── PvM tab ─────────────────────────────────────────── */}
          {activeTab === "pvm" && (
          <div className="card">
            <div className="cardHeader" style={{ justifyContent:"space-between" }}>
              <div className="cardTitle">PvM Kills</div>
              <span style={{ fontSize:12, opacity:0.4 }}>
                {!hasPvmData ? "No PvM data in snapshots yet"
                  : killsGained > 0 ? `+${killsGained.toLocaleString()} kills in period`
                  : latest===oldest ? "No comparison available" : "No kills gained in period"}
              </span>
            </div>
            <div className="cardBody">
              {!hasPvmData ? (
                <div style={{ opacity:0.4, fontSize:13 }}>
                  PvM data will appear in your next snapshot. Make sure your player profile
                  has been refreshed from the API before snapping.
                </div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:2 }}>
                  {BOSS_KEYS.filter(k => pvmDeltas[k]?.curr > 0 || (latest.pvm?.[k] ?? 0) > 0).map(k=>{
                    const d = pvmDeltas[k] || { curr:0, gained:0 };
                    const label = BOSS_LABEL[k] || k;
                    return (
                      <div key={k} style={{ display:"flex", justifyContent:"space-between",
                        alignItems:"center", padding:"7px 0",
                        borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                        <span style={{ fontSize:13, opacity:0.65 }}>{label}</span>
                        <span style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, fontWeight:600 }}>
                          {d.curr.toLocaleString()}
                          {d.gained > 0 && (
                            <span style={{ fontSize:11, color:"var(--success)", fontWeight:700 }}>
                              +{d.gained.toLocaleString()}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}

          {/* ── Snapshot history ───────────────────────────────── */}
          {filtered.length > 1 && (
            <div className="card">
              <div className="cardHeader">
                <div className="cardTitle">Snapshot history</div>
              </div>
              <div className="cardBody" style={{ overflowX:"auto" }}>
                <table className="table">
                  <thead><tr>
                    <th style={{width:"18%"}}>Date</th>
                    <th style={{textAlign:"right",width:"15%"}}>Total Level</th>
                    <th style={{textAlign:"right",width:"15%"}}>Total XP</th>
                    <th style={{textAlign:"right",width:"15%"}}>XP since prev</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map((row,i)=>{
                      const prevRow = filtered[i+1];
                      const xpDiff = prevRow ? row.totalXp - prevRow.totalXp : null;
                      const totLvl = PLAYER_SKILLS_ORDER
                        .filter(sk=>sk in (row.skills||{}))
                        .reduce((s,sk)=>s+xpToLevel(Number(row.skills[sk]||0)),0);
                      return (
                        <tr key={row.id}
                          style={{ background:i===0?"rgba(var(--success-rgb),0.04)":"" }}>
                          <td style={{ fontSize:12 }}>{fmtTs(row.snappedAt)}</td>
                          <td style={{ textAlign:"right", fontWeight:i===0?700:400 }}>
                            {totLvl.toLocaleString()}
                          </td>
                          <td style={{ textAlign:"right", opacity:0.7 }}>
                            {fmtXp(row.totalXp||0)}
                          </td>
                          <td style={{ textAlign:"right",
                            color:xpDiff>0?"var(--success)":"inherit",
                            fontWeight:xpDiff>0?700:400 }}>
                            {xpDiff!=null && xpDiff>0 ? `+${fmtXp(xpDiff)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
