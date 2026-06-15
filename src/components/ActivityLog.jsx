import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/bridge.js";
import { useGameData } from "../lib/gameDataContext.jsx";

export default function ActivityLog({ entityType, entityName, refreshNonce }){
  const [rows,setRows]=useState([]);
  const [filter,setFilter]=useState("");
  const [loading,setLoading]=useState(false);
  // Include refreshNonce so parent pages can force a reload after a profile refresh.
  const key = useMemo(()=>`${entityType}:${entityName}:${refreshNonce||0}`, [entityType, entityName, refreshNonce]);
  const { resolveItemName } = useGameData();

  async function load(){
    if (!entityName) return;
    setLoading(true);
    try{
      // Use detailed logs when available (includes rawJson and higher limit)
      const r = await (api.getLogsDetailed ? api.getLogsDetailed(entityType, entityName, { limit: 500 }) : api.getLogs(entityType, entityName));
      setRows(r || []);
    } finally{
      setLoading(false);
    }
  }

  async function refresh(){
    if (!entityName) return;
    setLoading(true);
    try{
      if (entityType === "player") await api.fetchPlayerLogs(entityName);
      if (entityType === "clan") await api.fetchClanLogs(entityName);
      await load();
    } finally{
      setLoading(false);
    }
  }

  useEffect(()=>{ load(); }, [key]);

  
const filtered = useMemo(()=>{
  const q = String(filter||"").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => String(r.message||"").toLowerCase().includes(q));
}, [rows, filter]);

return (
    <div className="card">
      <div className="cardHeader">
        <div className="row" style={{justifyContent:"space-between", padding:"10px 12px", gap:10, alignItems:"center", flexWrap:"wrap"}}>
          <div style={{fontWeight:800}}>Logs</div>
          <div style={{display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end", flex:"1 1 360px"}}>
            <input
              className="input"
              style={{flex:"1 1 260px", minWidth:140}}
              placeholder="Filter logs…"
              value={filter}
              onChange={(e)=>setFilter(e.target.value)}
            />
            <button className="btn btnPrimary" onClick={refresh} disabled={loading}>Refresh</button>
          </div>
        </div>
      </div>
      <div className="cardBody" style={{maxHeight: "72vh", overflow:"auto"}}>
        {loading && <div className="small">Loading…</div>}
        {!loading && rows.length===0 && <div className="small">No logs yet.</div>}
        {filtered.map((r,idx)=>(
          <div key={idx} style={{padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
            <div style={{fontWeight:650}}>{formatLogMessage(r, resolveItemName)}</div>
            <div className="small">{new Date(r.timestamp).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatLogMessage(row, resolveItemName){
  const msg = String(row?.message || "");

  // If the message references an explicit ItemId, replace with resolved name.
  // e.g. "ItemId: 123" or "itemId=123".
  let out = msg.replace(/\b(ItemId|itemId)\s*[:=]\s*(\d+)\b/g, (_m, k, id)=>{
    const name = resolveItemName ? resolveItemName(id) : `#${id}`;
    return `${k}: ${name}`;
  });

  // Convert snake_case item keys in common vault patterns into Title Case.
  out = out.replace(/\b(added|withdrew)\s+([\d,]+)\s*x\s+([a-z0-9_]{3,})\b/gi, (_m, verb, qty, key)=>{
    const pretty = key.replace(/_/g, " ").replace(/\b\w/g, (m)=>m.toUpperCase());
    return `${verb} ${qty}x ${pretty}`;
  });

  try{
    if (row?.rawJson && resolveItemName){
      const parsed = JSON.parse(String(row.rawJson));
      const itemId = parsed?.itemId ?? parsed?.ItemId ?? null;
      if (Number.isFinite(Number(itemId)) && /\b(added|withdrew)\s+[\d,]+x\s+\d+\b/i.test(out)){
        out = out.replace(/\b(added|withdrew)\s+([\d,]+)x\s+(\d+)\b/i, (_m2, v, q, _id)=>{
          return `${v} ${q}x ${resolveItemName(itemId)}`;
        });
      }
    }
  } catch {}

  return out;
}