import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/bridge.js";

function fmtNum(n){ const x=Number(n||0); return Number.isFinite(x)?x.toLocaleString():"0"; }
function fmtLocal(iso){
  if (!iso) return "—";
  try{ const d=new Date(iso); return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}):String(iso); }
  catch{ return String(iso); }
}

function SortTh({ col, current, dir, onSort, children, style={} }){
  const active = current === col;
  return (
    <th style={{ cursor:"pointer", userSelect:"none", ...style }} onClick={()=>onSort(col)} title={`Sort by ${col}`}>
      <span style={{ display:"flex", alignItems:"center", gap:4 }}>
        {children}
        <span style={{ opacity: active ? 0.8 : 0.25, fontSize:11 }}>{active ? (dir==="desc"?"↓":"↑") : "↕"}</span>
      </span>
    </th>
  );
}

export default function PotentialClansPage(){
  const nav = useNavigate();

  const [q,              setQ]              = useState("");
  const [minLogs,        setMinLogs]        = useState(()=>{ try{return Number(localStorage.getItem("potentialClansMinLogs")||50)||50;}catch{return 50;} });
  const [includeJoinLeave,setIncludeJoinLeave]=useState(()=>{ try{return localStorage.getItem("potentialClansIncludeJoinLeave")==="1";}catch{return false;} });
  const [rows,           setRows]           = useState([]);
  const [total,          setTotal]          = useState(0);
  const [loading,        setLoading]        = useState(false);
  const [err,            setErr]            = useState(null);
  const [sortCol,        setSortCol]        = useState("lastLogAt");
  const [sortDir,        setSortDir]        = useState("desc");
  const [page,           setPage]           = useState(1);
  const pageSize = 50;

  useEffect(()=>{ try{localStorage.setItem("potentialClansMinLogs",String(minLogs));}catch{} },[minLogs]);
  useEffect(()=>{ try{localStorage.setItem("potentialClansIncludeJoinLeave",includeJoinLeave?"1":"0");}catch{} },[includeJoinLeave]);
  useEffect(()=>{ setPage(1); },[q,minLogs,includeJoinLeave]);

  useEffect(()=>{
    let alive=true;
    const t=setTimeout(async()=>{
      setLoading(true); setErr(null);
      try{
        const offset=(Math.max(1,Number(page)||1)-1)*pageSize;
        const res=await api.listPotentialClans?.({q,limit:pageSize,offset,minLogs,includeJoinLeave});
        if(!alive) return;
        const rr=(res&&typeof res==="object")?res:{};
        const list=Array.isArray(rr.rows)?rr.rows:(Array.isArray(res)?res:[]);
        setRows(list); setTotal(Number(rr.total)||0);
      }catch(e){ if(!alive) return; setErr(e?.message||String(e)); setRows([]); setTotal(0); }
      finally{ if(!alive) return; setLoading(false); }
    },120);
    return ()=>{ alive=false; clearTimeout(t); };
  },[q,minLogs,includeJoinLeave,page]);

  function toggleSort(col){ if(sortCol===col){ setSortDir(d=>d==="desc"?"asc":"desc"); } else { setSortCol(col); setSortDir("desc"); } }

  const sorted = useMemo(()=>{
    const r=rows.map(row=>({...row, vaultRatio: row.logCount>0?((Number(row.depositLikeCount||0)+Number(row.withdrawLikeCount||0))/Number(row.logCount)):0}));
    r.sort((a,b)=>{
      let av=a[sortCol], bv=b[sortCol];
      if(sortCol==="lastLogAt"){av=av||"";bv=bv||"";}else{av=Number(av||0);bv=Number(bv||0);}
      if(av<bv) return sortDir==="asc"?-1:1;
      if(av>bv) return sortDir==="asc"?1:-1;
      return 0;
    });
    return r;
  },[rows,sortCol,sortDir]);

  const totalPages = Math.max(1, Math.ceil((Number(total)||0)/pageSize));
  const safePage   = Math.min(Math.max(1,page), totalPages);
  const thProps    = { current:sortCol, dir:sortDir, onSort:toggleSort };

  return (
    <div className="page">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:13, opacity:0.45 }}>
            Clans with notable vault activity in stored logs — high vault % may indicate item funnelling.
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom:14 }}>
      <div className="cardBody" style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <input className="input" placeholder="Search clans…" value={q} onChange={e=>setQ(e.target.value)} style={{width:220}} />
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, opacity:0.55 }}>Min logs</span>
          <input className="input" type="number" min={0} step={1} value={minLogs}
            onChange={e=>setMinLogs(Math.max(0,Number(e.target.value)||0))} style={{width:90}}
            title="Hide clans with fewer stored log rows" />
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:13, cursor:"pointer" }} title="When off, join/leave activity is excluded from counts">
          <input type="checkbox" checked={includeJoinLeave} onChange={e=>setIncludeJoinLeave(e.target.checked)} />
          Include join/leave
        </label>
        <div style={{ marginLeft:"auto", fontSize:13, opacity:0.5 }}>
          {loading ? "Loading…" : `${(Number(total)||0).toLocaleString()} clans`}
          {err && <span style={{color:"var(--danger)", marginLeft:8}}>{err}</span>}
        </div>
      </div>
      </div>

      {/* Table */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:"30%"}}>Clan</th>
                <SortTh col="logCount"          {...thProps} style={{width:"9%"}}>Logs</SortTh>
                <SortTh col="depositLikeCount"  {...thProps} style={{width:"11%"}}>Deposits</SortTh>
                <SortTh col="withdrawLikeCount" {...thProps} style={{width:"11%"}}>Withdrawals</SortTh>
                <SortTh col="vaultRatio"        {...thProps} style={{width:"10%"}} title="(Deposits + Withdrawals) ÷ Total logs · amber = ≥50%">Vault %</SortTh>
                {includeJoinLeave && <SortTh col="joinLeaveCount" {...thProps} style={{width:"10%"}}>Join/Leave</SortTh>}
                <SortTh col="lastLogAt"         {...thProps} style={{width:"18%"}}>Last log</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r=>{
                const name = r?.clanName||r?.clanLower||"—";
                const lower = r?.clanLower||String(name).toLowerCase();
                const vaultPct = r.vaultRatio!=null?`${Math.round(r.vaultRatio*100)}%`:"—";
                const highVault = (r.vaultRatio||0)>=0.5;
                return (
                  <tr key={lower} style={{cursor:"pointer"}} onClick={()=>nav(`/clans/${encodeURIComponent(name)}`)}>
                    <td style={{fontWeight:700}}>{name}</td>
                    <td style={{opacity:0.7}}>{fmtNum(r?.logCount)}</td>
                    <td style={{opacity:0.7}}>{fmtNum(r?.depositLikeCount)}</td>
                    <td style={{opacity:0.7}}>{fmtNum(r?.withdrawLikeCount)}</td>
                    <td style={{fontWeight:highVault?800:undefined, color:highVault?"var(--warning)":undefined}}>{vaultPct}</td>
                    {includeJoinLeave && <td style={{opacity:0.7}}>{fmtNum(r?.joinLeaveCount)}</td>}
                    <td style={{opacity:0.5, fontSize:12}}>{fmtLocal(r?.lastLogAt)}</td>
                  </tr>
                );
              })}
              {!loading && sorted.length===0 && (
                <tr><td colSpan={includeJoinLeave?7:6} style={{textAlign:"center",opacity:0.35,padding:24}}>
                  No clan logs found. Import logs or fetch clan data first.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderTop:"1px solid rgba(255,255,255,0.06)", fontSize:12 }}>
          <span style={{opacity:0.45}}>Page {safePage} of {totalPages}</span>
          <div style={{display:"flex", gap:6}}>
            <button className="btn" style={{padding:"3px 10px",fontSize:12}} disabled={safePage<=1||loading} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Prev</button>
            <button className="btn" style={{padding:"3px 10px",fontSize:12}} disabled={safePage>=totalPages||loading} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next ›</button>
          </div>
        </div>
      </div>
    </div>
  );
}
