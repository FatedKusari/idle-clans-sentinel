import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast.jsx";
import { modeLabel } from "../lib/format.js";

function clampNum(v, min, max, fallback){ const n=Number(v); return Number.isNaN(n)?fallback:Math.min(max,Math.max(min,n)); }

export default function SimilarNameClansPage(){
  const toast = useToast();
  const LS_OFFLINE="snc_offlineDaysMax", LS_MIN="snc_minGroupSize";
  const [offlineDaysMax, setOfflineDaysMax]=useState(()=>clampNum(localStorage.getItem(LS_OFFLINE),0,365,7));
  const [minGroupSize,   setMinGroupSize]  =useState(()=>clampNum(localStorage.getItem(LS_MIN),2,50,4));
  const [rows,    setRows]   =useState([]);
  const [loading, setLoading]=useState(false);
  const [error,   setError]  =useState("");
  const [page,    setPage]   =useState(1);
  const [skipAlreadyScanned,   setSkipAlreadyScanned]   =useState(true);
  const [onlyUnknownLastOnline,setOnlyUnknownLastOnline]=useState(true);
  const [scanBusy, setScanBusy]=useState(false);
  const perPage=10;

  const totalPages = Math.max(1,Math.ceil(rows.length/perPage));
  const pagedRows  = useMemo(()=>{ const s=(page-1)*perPage; return rows.slice(s,s+perPage); },[rows,page,perPage]);

  useEffect(()=>{ localStorage.setItem(LS_OFFLINE,String(offlineDaysMax)); },[offlineDaysMax]);
  useEffect(()=>{ localStorage.setItem(LS_MIN,String(minGroupSize)); },[minGroupSize]);
  useEffect(()=>{ const tp=Math.max(1,Math.ceil(rows.length/perPage)); if(page>tp) setPage(tp); if(page<1) setPage(1); },[rows.length,perPage,page]);

  async function load(){
    setLoading(true); setError("");
    try{ const res=await window.idleclans.getClansWithNameClusters({offlineDaysMax,minGroupSize,similarityThreshold:0.82}); setRows(Array.isArray(res)?res:[]); setPage(1); }
    catch(e){ setError(String(e?.message||e)); setRows([]); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); },[]); // eslint-disable-line

  const modeCounts = useMemo(()=>{
    const out={default:0,ironman:0,groupironman:0,notselected:0,other:0};
    for(const c of rows){ const gm=String(c?.gameMode||"").toLowerCase(); if(gm in out) out[gm]++; else out.other++; }
    return out;
  },[rows]);

  async function scanMatched(){
    try{
      setScanBusy(true);
      const names=[]; const seen=new Set();
      for(const c of rows) for(const g of (c.groups||[])) for(const n of (g||[])){
        const nm=String(n||"").trim(); if(!nm) continue;
        const lo=nm.toLowerCase(); if(seen.has(lo)) continue; seen.add(lo); names.push(nm);
      }
      const res=await window.idleclans.scanPlayersList({players:names,skipPreviouslyScanned:skipAlreadyScanned,onlyUnknownLastOnline});
      if(!Number(res?.total??res?.count??0)) toast.warning("No eligible members to scan. Try disabling 'Only unknown last-online' or 'Skip already scanned'.");
      await load();
    }catch(e){ toast.error("Scan failed: "+(e?.message||String(e))); }
    finally{ setScanBusy(false); }
  }

  return (
    <div className="page">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:20, marginBottom:2 }}>Clan Name Match Groups</div>
          <div style={{ fontSize:13, opacity:0.45 }}>
            Clans where {minGroupSize}+ members share near-identical names — a common alt-account signal.
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn" onClick={load} disabled={loading||scanBusy}>{loading?"Loading…":"Refresh"}</button>
        </div>
      </div>

      {/* Filter + scan bar */}
      <div className="card" style={{ marginBottom:14 }}>
        <div className="cardBody">
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, opacity:0.45, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:5 }}>Max offline</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <input className="input" type="number" min={0} max={365} value={offlineDaysMax}
                  onChange={e=>setOfflineDaysMax(clampNum(e.target.value,0,365,7))} style={{width:90}} />
                <span style={{ fontSize:12, opacity:0.45 }}>days</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, opacity:0.45, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:5 }}>Min matching members</div>
              <input className="input" type="number" min={2} max={50} value={minGroupSize}
                onChange={e=>setMinGroupSize(clampNum(e.target.value,2,50,4))} style={{width:90}} />
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, paddingTop:18 }}>
              <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }}>
                <input type="checkbox" checked={skipAlreadyScanned} onChange={e=>setSkipAlreadyScanned(e.target.checked)} />
                Skip already scanned
              </label>
              <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }} title="Only scan members without cached last-online data">
                <input type="checkbox" checked={onlyUnknownLastOnline} onChange={e=>setOnlyUnknownLastOnline(e.target.checked)} />
                Only unknown last-online
              </label>
            </div>
            <button className="btn btnPrimary" style={{ alignSelf:"flex-end" }} disabled={loading||scanBusy||rows.length===0} onClick={scanMatched}>
              {scanBusy?"Scanning matched members…":"Scan matched members"}
            </button>
          </div>
          {error && <div style={{ marginTop:10, color:"var(--danger)", fontSize:13 }}>{error}</div>}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", fontSize:13 }}>
          <span style={{ fontWeight:700 }}>{rows.length.toLocaleString()}</span>
          <span style={{ opacity:0.5 }}>clan{rows.length!==1?"s":""} with name groups</span>
          {Object.entries(modeCounts).filter(([,v])=>v>0).map(([k,v])=>(
            <span key={k} style={{ opacity:0.5 }}>{modeLabel(k)}: <b style={{opacity:1}}>{v}</b></span>
          ))}
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button className="btn" style={{padding:"3px 10px",fontSize:12}} disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹</button>
          <span style={{ fontSize:12, opacity:0.5 }}>Page {page} / {totalPages}</span>
          <button className="btn" style={{padding:"3px 10px",fontSize:12}} disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>›</button>
        </div>
      </div>

      {/* Clan cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(400px, 1fr))", gap:12 }}>
        {pagedRows.map((c,idx)=>{
          const maxGroup=(c.groups&&c.groups[0])?c.groups[0].length:0;
          const colors=["var(--info)","#34d399","var(--warning)","var(--danger)","#a78bfa","#38bdf8","#fb923c","var(--success)"];
          return (
            <div key={c.clanLower||idx} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, overflow:"hidden" }}>
              <div style={{ padding:"12px 14px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                  <div>
                    <Link to={`/clans/${encodeURIComponent(c.clanName)}`} style={{ fontWeight:800, fontSize:14, textDecoration:"none", color:"inherit" }}>
                      {c.clanName}
                    </Link>
                    <div style={{ fontSize:12, opacity:0.45, marginTop:3 }}>
                      {modeLabel(c.gameMode)} · {c.eligibleCount}/{c.totalMembers} eligible
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                    <span style={{ fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:6, background:"rgba(var(--warning-rgb),0.12)", color:"var(--warning)" }}>
                      Largest: {maxGroup}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                {(c.groups||[]).slice(0,6).map((group,gi)=>(
                  <div key={gi}>
                    <div style={{ fontSize:11, opacity:0.4, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                      Group {gi+1} · {group.length} members
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 6px" }}>
                      {group.map(name=>(
                        <span key={name} style={{
                          fontSize:12, fontWeight:600, padding:"3px 10px", borderRadius:6,
                          background:`${colors[gi%colors.length]}18`,
                          border:`1px solid ${colors[gi%colors.length]}30`,
                          color: colors[gi%colors.length],
                        }}>{name}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && rows.length===0 && (
        <div style={{ textAlign:"center", opacity:0.35, padding:40, fontSize:13 }}>
          No clans found meeting the criteria.
        </div>
      )}
    </div>
  );
}
