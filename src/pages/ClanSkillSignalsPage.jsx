import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, onScanProgress } from "../lib/bridge.js";
import { modeLabel } from "../lib/format.js";

function fmtAgo(iso){
  if (!iso) return "";
  try{ const ms=Date.now()-new Date(iso).getTime(); const m=Math.floor(ms/60000); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<48) return `${h}h ago`; return `${Math.floor(h/24)}d ago`; }
  catch{ return ""; }
}

export default function ClanSkillSignalsPage(){
  const [rows,                  setRows]                  = useState([]);
  const [loading,               setLoading]               = useState(false);
  const [maxOfflineDays,        setMaxOfflineDays]        = useState(14);
  const [minActiveMembers,      setMinActiveMembers]      = useState(5);
  const [minClanSize,           setMinClanSize]           = useState(10);
  const [minSkillLevel,         setMinSkillLevel]         = useState(80);
  const [includeUnknownActivity,setIncludeUnknownActivity]= useState(false);
  const [sortBy,                setSortBy]                = useState("range");
  const [scan, setScan] = useState({ running:false, clanName:null, done:0, total:0, bulkIndex:0, bulkTotal:0 });
  const scanStopRef = useRef(false);

  useEffect(()=>{
    return onScanProgress?.((p)=>{
      if(!p||!p.clanName) return;
      setScan(prev=>({running:!!p.running,clanName:p.clanName,done:Number(p.done||0),total:Number(p.total||0),canceled:!!p.canceled,bulkIndex:prev.bulkIndex,bulkTotal:prev.bulkTotal}));
    });
  },[]);

  async function load(){
    setLoading(true);
    try{ const data=await api.listClanSkillSignals({maxOfflineDays,minActiveMembers,minClanSize,minSkillLevel,includeUnknownActivity,sortBy}); setRows(Array.isArray(data)?data:[]); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); },[]); // eslint-disable-line

  async function rescanClan(clanName){
    if(!clanName) return;
    setScan(prev=>({...prev,running:true,clanName,done:0,total:0}));
    try{ await api.scanClanMembers(clanName); }catch(e){ console.warn("[ClanSkillSignals] scanClanMembers failed", e?.message); }
    await load();
  }

  async function rescanAll(){
    const clans=(rows||[]).map(r=>r?.clanName).filter(Boolean); if(!clans.length) return;
    scanStopRef.current=false;
    setScan({running:true,clanName:clans[0],done:0,total:0,bulkIndex:1,bulkTotal:clans.length});
    for(let i=0;i<clans.length;i++){
      if(scanStopRef.current) break;
      const cn=clans[i];
      setScan(prev=>({...prev,running:true,clanName:cn,done:0,total:0,bulkIndex:i+1,bulkTotal:clans.length}));
      try{ await api.refreshClan?.(cn); }catch(e){ console.warn("[ClanSkillSignals] refreshClan failed", e?.message); }
      try{ await api.scanClanMembers(cn); }catch(e){ console.warn("[ClanSkillSignals] scanClanMembers(cn) failed", e?.message); }
    }
    setScan(prev=>({...prev,running:false}));
    await load();
  }

  return (
    <div className="page">
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:20, marginBottom:4 }}>Clan Skill Signals</div>
          <div style={{ fontSize:13, opacity:0.5 }}>Unusual clan-wide skill distributions — single-skill dominance, extreme variance, skewed combat/skilling focus</div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {scan.running ? (
            <button className="btn btnDanger" onClick={()=>{ scanStopRef.current=true; api.cancelScanClanMembers?.(); }}>Stop scan</button>
          ) : (
            <button className="btn" onClick={rescanAll} disabled={loading||rows.length===0}>Rescan all listed</button>
          )}
          <button className="btn btnPrimary" onClick={load} disabled={loading||scan.running}>{loading?"Loading…":"Apply filters"}</button>
        </div>
      </div>

      {/* Scan progress */}
      {scan.running && (
        <div style={{ marginBottom:12, padding:"8px 14px", borderRadius:8, background:"rgba(var(--info-rgb),0.08)", border:"1px solid rgba(var(--info-rgb),0.2)", fontSize:13 }}>
          Scanning <b>{scan.clanName}</b>
          {scan.bulkTotal>0 && <> · {scan.bulkIndex}/{scan.bulkTotal}</>}
          {scan.total>0 && <> · {scan.done}/{scan.total} members</>}
        </div>
      )}

      {/* Filters */}
      <div style={{ display:"flex", gap:14, alignItems:"flex-end", flexWrap:"wrap", marginBottom:14, padding:"12px 14px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10 }}>
        {[
          ["Active if offline ≤ (days)", maxOfflineDays, setMaxOfflineDays, 0, 365],
          ["Min active members",         minActiveMembers, setMinActiveMembers, 0, 500],
          ["Min clan size",              minClanSize, setMinClanSize, 1, 500],
          ["Only skills ≥ level",        minSkillLevel, setMinSkillLevel, 1, 120],
        ].map(([label, val, set, min, max])=>(
          <div key={label}>
            <div style={{ fontSize:11, opacity:0.5, marginBottom:4 }}>{label}</div>
            <input className="input" type="number" min={min} max={max} value={val}
              onChange={e=>set(Math.max(min,Math.min(max,Number(e.target.value)||min)))} style={{width:90}} />
          </div>
        ))}
        <div>
          <div style={{ fontSize:11, opacity:0.5, marginBottom:4 }}>Sort by</div>
          <select className="select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{width:220}}>
            <option value="range">Skill spread (highest − lowest)</option>
            <option value="topGap">Top gap (#1 − #2 skill)</option>
            <option value="focus">Combat bias (combat vs skilling)</option>
            <option value="topSkill">Top skill level</option>
            <option value="active">Active members</option>
            <option value="recent">Recently updated</option>
          </select>
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer", alignSelf:"center" }}>
          <input type="checkbox" checked={includeUnknownActivity} onChange={e=>setIncludeUnknownActivity(!!e.target.checked)} />
          Include unscanned
        </label>
      </div>

      {/* Results */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, overflow:"hidden" }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.06)", fontSize:13, opacity:0.55 }}>
          {loading ? "Loading…" : `${rows.length} clan${rows.length!==1?"s":""} · ≥ ${minSkillLevel} skill level · ≥ ${minActiveMembers} active (offline ≤ ${maxOfflineDays}d) · clan ≥ ${minClanSize}`}
        </div>
        {!loading && !rows.length ? (
          <div style={{ textAlign:"center", opacity:0.35, padding:32, fontSize:13 }}>No results match current filters.</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Clan</th>
                  <th title="Active / Total members — Active means offline within the threshold days">Activity</th>
                  <th title="Members with a stored profile scan / Total members">Coverage</th>
                  <th>Top skills</th>
                  <th title="Skill spread: highest average skill level minus lowest across the clan. High values (>40) suggest the clan focuses heavily on one or two skills.">Spread</th>
                  <th title="Top gap: difference between the #1 and #2 ranked skills. A large gap (>15) means one skill dominates the clan far above all others.">Top gap</th>
                  <th title="Combat bias: how skewed the clan is toward combat skills vs skilling. Near 0 = balanced. Higher = lopsided in one direction.">Bias</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r,idx)=>{
                  const range   = Number.isFinite(r.range)  ? Math.round(r.range)  : 0;
                  const topGap  = Number.isFinite(r.topGap) ? Math.round(r.topGap) : 0;
                  const focus   = Number.isFinite(Number(r.focus)) ? Number(r.focus) : 0;
                  const topGapA = topGap > 15;
                  const rangeA  = range > 40;
                  const focusA  = focus > 20;
                  const anyA    = topGapA||rangeA||focusA;
                  const tips    = [
                    topGapA ? `Top gap ${topGap} (>15: single-skill dominance)` : null,
                    rangeA  ? `Spread ${range} (>40: extreme variance)`         : null,
                    focusA  ? `Combat bias ${focus} (>20: heavily skewed)`       : null,
                  ].filter(Boolean).join(" · ");
                  const top     = (r.topSkills||[]).map(s=>`${s.skill} ${Math.round(Number(s.level||0))}`).join(" · ");
                  const focusLabel = focus < 1
                    ? "Balanced"
                    : focus < 5
                      ? `Slight ${Number(r.combatAvg||0) > Number(r.skillAvg||0) ? "combat" : "skill"} lean`
                      : `${Number(r.combatAvg||0) > Number(r.skillAvg||0) ? "Combat" : "Skill"}-leaning`;
                  return (
                    <tr key={r.lowerName||idx} style={anyA?{background:"rgba(var(--danger-rgb),0.06)"}:undefined}>
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <Link to={`/clans/${encodeURIComponent(r.clanName)}`} style={{fontWeight:700,textDecoration:"none",color:"inherit"}}>{r.clanName}</Link>
                          {anyA && <span style={{fontSize:11,fontWeight:700,color:"var(--danger)",background:"rgba(var(--danger-rgb),0.15)",borderRadius:5,padding:"1px 6px",cursor:"default"}} title={tips}>⚠ Anomaly</span>}
                        </div>
                        <div style={{fontSize:11,opacity:0.4,marginTop:2}}>{r.tag?`Tag: ${r.tag} · `:""}Last scan: {fmtAgo(r.lastMemberScanAt||r.updatedAt)||"unknown"}</div>
                      </td>
                      <td style={{opacity:0.7}}>{r.activeCount||0}/{r.memberCount||0}</td>
                      <td style={{opacity:0.7}}>{r.scannedCount||0}/{r.memberCount||0}</td>
                      <td style={{fontSize:12,opacity:0.8,minWidth:280}}>{top}</td>
                      <td style={{fontWeight:rangeA?800:undefined,color:rangeA?"var(--danger)":undefined}}>{range}</td>
                      <td style={{fontWeight:topGapA?800:undefined,color:topGapA?"var(--danger)":undefined}}>{topGap}</td>
                      <td title={`Combat avg: ${Math.round(Number(r.combatAvg||0))} · Skill avg: ${Math.round(Number(r.skillAvg||0))}`}
                          style={{fontSize:12,fontWeight:focusA?700:undefined,color:focusA?"var(--warning)":undefined}}>
                        {focusLabel}
                      </td>
                      <td>
                        <button className="btn" style={{fontSize:11,padding:"3px 8px"}} disabled={scan.running} onClick={()=>rescanClan(r.clanName)}>Rescan</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
