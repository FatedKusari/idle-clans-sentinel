import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/bridge.js";
import { useToast } from "../components/Toast.jsx";
import { modeLabel } from "../lib/format.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function agoFromIso(ts){
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.floor((Date.now()-t)/60000);
  if (mins < 60)  return `${mins}m ago`;
  const h = Math.floor(mins/60);
  if (h < 24)     return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}


function SortTh({ col, current, dir, onSort, children, style={} }){
  const active = current === col;
  return (
    <th style={{ cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", ...style }}
      onClick={()=>onSort(col)}>
      <span style={{ display:"flex", alignItems:"center", gap:4 }}>
        {children}
        <span style={{ fontSize:10, opacity: active ? 0.8 : 0.2 }}>
          {active ? (dir==="desc" ? "↓" : "↑") : "↕"}
        </span>
      </span>
    </th>
  );
}

const PAGE_SIZE = 100;

// ── main ──────────────────────────────────────────────────────────────────────

export default function ClansPage(){
  const toast = useToast();
  const [q,         setQ]         = useState("");
  const [gameMode,  setGameMode]  = useState("all");
  const [onlyStale,   setOnlyStale]   = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [sortCol,   setSortCol]   = useState("clanName");
  const [sortDir,   setSortDir]   = useState("asc");
  const [page,      setPage]      = useState(1);

  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);

  // ── Selection + bulk delete ───────────────────────────────────────────────
  const [selected,  setSelected]  = useState(new Set());
  const [deleting,  setDeleting]  = useState(false);

  function toggleSelect(lowerName){
    setSelected(prev => {
      const next = new Set(prev);
      next.has(lowerName) ? next.delete(lowerName) : next.add(lowerName);
      return next;
    });
  }
  async function toggleSelectAll(){
    if (selected.size > 0){
      setSelected(new Set());
      return;
    }
    try{
      const allNames = await api.getAllClanNames(q, {
        gameMode: gameMode !== "all" ? gameMode : null,
        onlyStale, staleDays: 7, onlyFlagged,
      });
      setSelected(new Set(allNames));
    }catch{
      setSelected(new Set(rows.map(r => r.lowerName)));
    }
  }
  useEffect(()=>{ setSelected(new Set()); }, [q, gameMode, onlyStale, onlyFlagged]);

  const debounceRef = useRef(null);

  function toggleSort(col){
    if (sortCol===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  }

  useEffect(()=>{ setPage(1); }, [q, gameMode, onlyStale, onlyFlagged, sortCol, sortDir]);

  useEffect(()=>{
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async()=>{
      setLoading(true);
      try{
        const res = await api.listClans(q, {
          limit: PAGE_SIZE,
          offset: (page-1)*PAGE_SIZE,
          sortCol, sortDir, gameMode,
          onlyStale, staleDays: 7, onlyFlagged,
        });
        setRows(Array.isArray(res?.rows) ? res.rows : []);
        setTotal(Number(res?.total)||0);
      }catch(e){ console.error(e); }
      finally{ setLoading(false); }
    }, 150);
    return ()=>clearTimeout(debounceRef.current);
  }, [q, gameMode, onlyStale, onlyFlagged, sortCol, sortDir, page]);

  const totalPages    = Math.max(1, Math.ceil(total/PAGE_SIZE));
  const thProps       = { current:sortCol, dir:sortDir, onSort:toggleSort };
  const activeFilters = (gameMode!=="all"?1:0) + (onlyStale?1:0) + (onlyFlagged?1:0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Search + filter bar ───────────────────────────────────────── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
        <input className="input" placeholder="Search clans…" value={q}
          onChange={e=>setQ(e.target.value)} style={{ width:240 }} />

        <select className="select" value={gameMode}
          onChange={e=>{ setGameMode(e.target.value); setPage(1); }} style={{ width:150 }}>
          <option value="all">All modes</option>
          <option value="default">Normal</option>
          <option value="ironman">Ironman</option>
          <option value="groupironman">Group Ironman</option>
        </select>

        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer",
          padding:"5px 12px", borderRadius:8, userSelect:"none",
          background: onlyFlagged ? "rgba(var(--warning2-rgb),0.15)" : "rgba(255,255,255,0.05)",
          border: onlyFlagged ? "1px solid rgba(var(--warning2-rgb),0.3)" : "1px solid rgba(255,255,255,0.1)",
          color: onlyFlagged ? "var(--warning2)" : "rgba(255,255,255,0.6)",
        }}>
          <input type="checkbox" checked={onlyFlagged}
            onChange={e=>{ setOnlyFlagged(e.target.checked); setPage(1); }}
            style={{ display:"none" }} />
          Flagged only
        </label>

        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer",
          padding:"5px 12px", borderRadius:8, userSelect:"none",
          background: onlyStale ? "rgba(var(--info-rgb),0.15)" : "rgba(255,255,255,0.05)",
          border: onlyStale ? "1px solid rgba(var(--info-rgb),0.3)" : "1px solid rgba(255,255,255,0.1)",
          color: onlyStale ? "var(--info)" : "rgba(255,255,255,0.6)",
        }}>
          <input type="checkbox" checked={onlyStale}
            onChange={e=>{ setOnlyStale(e.target.checked); setPage(1); }}
            style={{ display:"none" }} />
          Stale (7d+)
        </label>

        {activeFilters > 0 && (
          <button className="btn" style={{ fontSize:12 }}
            onClick={()=>{ setGameMode("all"); setOnlyStale(false); setOnlyFlagged(false); setPage(1); }}>
            Clear filters ({activeFilters})
          </button>
        )}

        <span style={{ marginLeft:"auto", fontSize:13, opacity:0.45 }}>
          {loading ? "Loading…" : `${total.toLocaleString()} clan${total!==1?"s":""}`}
        </span>
      </div>

      {/* ── Bulk action bar ───────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
          borderRadius:10, background:"rgba(var(--danger-rgb),0.08)", border:"1px solid rgba(var(--danger-rgb),0.2)" }}>
          <span style={{ fontSize:13, fontWeight:600 }}>{selected.size} selected</span>
          <button className="btn btnDanger" disabled={deleting} style={{ fontSize:13 }}
            onClick={async()=>{
              if (!confirm(`Permanently delete ${selected.size} clan${selected.size!==1?"s":""}? They will be re-added if they appear in a future scan.`)) return;
              setDeleting(true);
              try{
                await api.deleteClansHard({ names: [...selected] });
                setSelected(new Set());
                const res = await api.listClans(q, { limit:PAGE_SIZE, offset:(page-1)*PAGE_SIZE, sortCol, sortDir, gameMode, onlyStale, onlyFlagged });
                setRows(Array.isArray(res?.rows) ? res.rows : []);
                setTotal(Number(res?.total)||0);
              }catch(e){ toast.error("Delete failed: "+String(e?.message||e)); }
              finally{ setDeleting(false); }
            }}>
            {deleting ? "Deleting…" : `🗑 Delete ${selected.size}`}
          </button>
          <button className="btn" style={{ fontSize:13 }} onClick={()=>setSelected(new Set())}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width:36, paddingLeft:14 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", whiteSpace:"nowrap" }}
                    title="Select all visible rows">
                    <input type="checkbox"
                      checked={selected.size > 0 && total > 0 && selected.size >= total}
                      ref={el=>{ if(el) el.indeterminate = selected.size>0 && selected.size<total; }}
                      onChange={toggleSelectAll} style={{ cursor:"pointer" }} />
                    <span style={{ fontSize:10, opacity:0.45, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em" }}>All</span>
                  </label>
                </th>
                <SortTh col="clanName" {...thProps} style={{ width:"30%" }}>Name</SortTh>
                <SortTh col="tag"      {...thProps} style={{ width:"10%" }}>Tag</SortTh>
                <SortTh col="gameMode" {...thProps} style={{ width:"14%" }}>Mode</SortTh>
                <th style={{ width:"10%" }}>Members</th>
                <SortTh col="updated"  {...thProps} style={{ width:"14%" }}>Updated</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.lowerName} style={{ cursor:"pointer",
                  background: selected.has(r.lowerName) ? "rgba(var(--danger-rgb),0.06)" : undefined }}>
                  <td style={{ paddingLeft:14 }} onClick={e=>e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.lowerName)}
                      onChange={()=>toggleSelect(r.lowerName)} style={{ cursor:"pointer" }} />
                  </td>
                  <td>
                    <Link to={`/clans/${encodeURIComponent(r.clanName)}`}
                      style={{ fontWeight:700, textDecoration:"none", color:"inherit" }}>
                      {r.clanName}
                    </Link>
                  </td>
                  <td>
                    {r.tag
                      ? <span style={{ fontSize:12, fontWeight:600, padding:"2px 8px", borderRadius:6,
                          background:"rgba(255,255,255,0.07)" }}>{r.tag}</span>
                      : <span style={{ opacity:0.25 }}>—</span>}
                  </td>
                  <td style={{ fontSize:12, opacity:0.6 }}>{modeLabel(r.gameMode)}</td>
                  <td style={{ fontSize:13, opacity:0.65 }}>
                    {r.memberCount > 0 ? r.memberCount : <span style={{ opacity:0.3 }}>—</span>}
                  </td>
                  <td style={{ fontSize:12, opacity:0.45 }}>
                    {r.updatedAt ? agoFromIso(r.updatedAt) : <span style={{ opacity:0.4 }}>Never</span>}
                  </td>
                </tr>
              ))}
              {!loading && rows.length===0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign:"center", opacity:0.35, padding:32 }}>
                    No clans found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"10px 14px", borderTop:"1px solid rgba(255,255,255,0.06)", fontSize:12 }}>
          <span style={{ opacity:0.4 }}>
            {total > 0
              ? `Showing ${((page-1)*PAGE_SIZE)+1}–${Math.min(page*PAGE_SIZE,total).toLocaleString()} of ${total.toLocaleString()}`
              : "0 results"}
          </span>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <button className="btn" style={{ padding:"3px 10px" }} disabled={page<=1||loading}
              onClick={()=>setPage(1)}>«</button>
            <button className="btn" style={{ padding:"3px 10px" }} disabled={page<=1||loading}
              onClick={()=>setPage(p=>p-1)}>‹</button>
            <span style={{ opacity:0.5, minWidth:80, textAlign:"center" }}>
              Page {page} / {totalPages}
            </span>
            <button className="btn" style={{ padding:"3px 10px" }} disabled={page>=totalPages||loading}
              onClick={()=>setPage(p=>p+1)}>›</button>
            <button className="btn" style={{ padding:"3px 10px" }} disabled={page>=totalPages||loading}
              onClick={()=>setPage(totalPages)}>»</button>
          </div>
        </div>
      </div>
    </div>
  );
}
