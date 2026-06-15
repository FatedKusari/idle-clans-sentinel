import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/bridge.js";
import { useGameData } from "../lib/gameDataContext.jsx";

const PAGE_SIZE = 20;

// ── Sparkline ────────────────────────────────────────────────────────────────
// Renders a tiny inline SVG path from an array of lowestSellPrice numbers.
// Colour: green if flat/up, amber if mildly down, red if significantly down.
function Sparkline({ prices, width = 72, height = 24, onClick, title }) {
  const clickable = typeof onClick === "function";
  if (!prices || prices.length < 2) {
    return (
      <span style={{ display:"inline-block", width, height, opacity:0.15,
        fontSize:10, lineHeight:`${height}px`, textAlign:"center" }}>—</span>
    );
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 2;
  const w = width  - pad * 2;
  const h = height - pad * 2;
  const pts = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * w;
    const y = pad + h - ((p - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(",").map(Number);
  const pctChange = (prices[prices.length - 1] - prices[0]) / (prices[0] || 1);
  const lineColor = pctChange >= -0.02 ? "var(--success)" : pctChange >= -0.1 ? "#facc15" : "#f87171";
  return (
    <svg width={width} height={height} onClick={onClick}
      style={{ display:"inline-block", verticalAlign:"middle", overflow:"visible",
        cursor: clickable ? "pointer" : "default" }}>
      {title && <title>{title}</title>}
      <polyline points={pts.join(" ")} fill="none"
        stroke={lineColor} strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <circle cx={lx} cy={ly} r={2.5} fill={lineColor} opacity={0.9} />
    </svg>
  );
}

// ── Price History Modal ───────────────────────────────────────────────────────
// Larger line chart for a single item, with axis labels and a hover tooltip
// showing the exact timestamp/price. Fetches up to 60 recent snapshots
// (vs the 20 used for the inline sparkline) for a longer view.
function PriceHistoryModal({ item, onClose }) {
  const [rows, setRows]     = useState(null); // [{ fetchedAt, lowestSellPrice, dailyAveragePrice }]
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [hover, setHover]   = useState(null); // { x, y, point }

  useEffect(()=>{
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.marketGetHistory?.({ itemIds: [item.itemId], limit: 60 })
      .then(res=>{
        if (cancelled) return;
        const r = (res?.rows || [])
          .filter(row => Number(row.itemId) === Number(item.itemId))
          .sort((a,b) => new Date(a.fetchedAt) - new Date(b.fetchedAt));
        setRows(r);
      })
      .catch(err => { if (!cancelled) setError(err?.message || "Failed to load history"); })
      .finally(()=> { if (!cancelled) setLoading(false); });
    return ()=>{ cancelled = true; };
  }, [item.itemId]);

  // Chart geometry
  const W = 640, H = 280;
  const padL = 56, padR = 16, padT = 16, padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const prices = (rows || []).map(r => Number(r.lowestSellPrice));
  const hasData = prices.length >= 2;
  let min = 0, max = 0, range = 1;
  if (hasData) {
    min = Math.min(...prices);
    max = Math.max(...prices);
    range = (max - min) || (max || 1);
    // Add a little headroom so the line doesn't touch the edges
    const headroom = range * 0.08;
    min = Math.max(0, min - headroom);
    max = max + headroom;
    range = max - min || 1;
  }

  const pts = hasData ? rows.map((r, i) => {
    const x = padL + (i / (rows.length - 1)) * chartW;
    const y = padT + chartH - ((Number(r.lowestSellPrice) - min) / range) * chartH;
    return { x, y, row: r };
  }) : [];

  const pctChange = hasData
    ? (prices[prices.length - 1] - prices[0]) / (prices[0] || 1)
    : 0;
  const lineColor = pctChange >= -0.02 ? "var(--success)" : pctChange >= -0.1 ? "#facc15" : "#f87171";

  // Y-axis gridlines/labels (4 evenly spaced)
  const yTicks = hasData ? [0, 1, 2, 3, 4].map(i => min + (range * i) / 4) : [];

  // X-axis labels: first, middle, last timestamp
  const xLabelIdxs = hasData
    ? Array.from(new Set([0, Math.floor((rows.length-1)/2), rows.length-1]))
    : [];

  function handleMove(e){
    if (!hasData) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    // Find nearest point by x
    let nearest = pts[0];
    let bestDist = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.x - mx);
      if (d < bestDist) { bestDist = d; nearest = p; }
    }
    setHover(nearest);
  }

  const itemName = item._name || `Item #${item.itemId}`;

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: "min(720px, 100%)" }} onMouseDown={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:6 }}>
          <div style={{ fontWeight:800, fontSize:17 }}>{itemName} — Price History</div>
          <button className="btn" style={{ fontSize:16, padding:"0 8px" }} onClick={onClose}>×</button>
        </div>
        <div style={{ fontSize:12, opacity:0.5, marginBottom:14 }}>
          Lowest listed sell price across the most recent scan snapshots.
        </div>

        {loading && (
          <div style={{ padding:"40px 0", textAlign:"center", opacity:0.5, fontSize:13 }}>
            Loading price history…
          </div>
        )}

        {!loading && error && (
          <div style={{ padding:"40px 0", textAlign:"center", opacity:0.6, fontSize:13, color:"#f87171" }}>
            {error}
          </div>
        )}

        {!loading && !error && !hasData && (
          <div style={{ padding:"40px 0", textAlign:"center", opacity:0.5, fontSize:13 }}>
            Not enough history yet for this item — check back after a few more scans.
          </div>
        )}

        {!loading && !error && hasData && (
          <div style={{ position:"relative" }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
              onMouseMove={handleMove}
              onMouseLeave={()=>setHover(null)}
              style={{ display:"block", overflow:"visible" }}>

              {/* Y-axis gridlines + labels */}
              {yTicks.map((v, i) => {
                const y = padT + chartH - ((v - min) / range) * chartH;
                return (
                  <g key={i}>
                    <line x1={padL} y1={y} x2={W-padR} y2={y}
                      stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                    <text x={padL-8} y={y+4} textAnchor="end"
                      fontSize="10" fill="rgba(255,255,255,0.4)">
                      {Math.round(v).toLocaleString()}
                    </text>
                  </g>
                );
              })}

              {/* X-axis labels */}
              {xLabelIdxs.map(i => {
                const p = pts[i];
                return (
                  <text key={i} x={p.x} y={H-10}
                    textAnchor={i===0 ? "start" : i===rows.length-1 ? "end" : "middle"}
                    fontSize="10" fill="rgba(255,255,255,0.4)">
                    {fmtTs(p.row.fetchedAt)}
                  </text>
                );
              })}

              {/* Price line */}
              <polyline
                points={pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
                fill="none" stroke={lineColor} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />

              {/* Hover crosshair + dot */}
              {hover && (
                <>
                  <line x1={hover.x} y1={padT} x2={hover.x} y2={padT+chartH}
                    stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                  <circle cx={hover.x} cy={hover.y} r={4} fill={lineColor} stroke="#0b1410" strokeWidth={2} />
                </>
              )}
            </svg>

            {/* Tooltip */}
            {hover && (
              <div style={{
                position:"absolute",
                left: `${Math.min(Math.max((hover.x / W) * 100, 12), 88)}%`,
                top: 4,
                transform:"translateX(-50%)",
                background:"#0f2d1f", border:"1px solid rgba(255,255,255,0.15)",
                borderRadius:8, padding:"6px 10px", fontSize:12, lineHeight:1.5,
                whiteSpace:"nowrap", pointerEvents:"none",
                boxShadow:"0 8px 24px rgba(0,0,0,0.4)",
              }}>
                <div style={{ opacity:0.6 }}>{fmtTs(hover.row.fetchedAt)}</div>
                <div style={{ fontWeight:700, color:"var(--success)" }}>
                  Listed: {fmtNum(hover.row.lowestSellPrice)}
                </div>
                {Number(hover.row.dailyAveragePrice) > 0 && (
                  <div style={{ opacity:0.5 }}>
                    Daily avg: {fmtNum(hover.row.dailyAveragePrice)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── helpers (outside component — no focus-loss on re-render) ─────────────────

// Title-case: "bronze_helmet" or "bronze helmet" → "Bronze Helmet"
function toTitle(raw){
  if (!raw) return "";
  return raw.replace(/_/g," ")
            .replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function fmtNum(n){
  const v = Number(n);
  return (Number.isFinite(v) && v !== 0) ? v.toLocaleString() : "—";
}
function fmtTs(ts){
  if (!ts) return "—";
  try{ return new Date(ts).toLocaleString(undefined,{month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}); }
  catch{ return String(ts); }
}
function fmtCountdown(s){
  if (s===null||s===undefined) return null;
  return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
}

function SortTh({ col, current, dir, onSort, children, style={}, align="left" }){
  const active = current===col;
  return (
    <th style={{ cursor:"pointer", userSelect:"none", textAlign:align, ...style }}
      onClick={()=>onSort(col)}>
      <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
        {children}
        <span style={{ opacity:active?0.8:0.25, fontSize:10 }}>{active?(dir==="desc"?"↓":"↑"):"↕"}</span>
      </span>
    </th>
  );
}

function DiscountBadge({ pct }){
  // pct = how far below the daily average the current price is (0–100)
  // Higher = better deal. Colour shifts green→yellow as it approaches 0.
  const n = Number(pct);
  const colour = n >= 30 ? "var(--success)" : n >= 15 ? "#facc15" : "#86efac";
  return (
    <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:5, fontSize:11,
      fontWeight:700, background:"rgba(var(--success-rgb),0.12)",
      color:colour, border:"1px solid rgba(var(--success-rgb),0.25)" }}>
      -{n.toFixed(1)}%
    </span>
  );
}

function TableWrap({ children }){
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:12, overflow:"hidden" }}>
      <div style={{ overflowX:"auto" }}>{children}</div>
    </div>
  );
}

function Pagination({ page, total, onPage }){
  if (total <= 1) return null;
  return (
    <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:8,
      padding:"10px 0", borderTop:"1px solid rgba(255,255,255,0.06)", background:"rgba(0,0,0,0.2)" }}>
      <button className="btn" style={{padding:"3px 10px"}} disabled={page<=1} onClick={()=>onPage(Math.max(1,page-1))}>‹</button>
      <span style={{ fontSize:12, opacity:0.55 }}>Page {page} / {total}</span>
      <button className="btn" style={{padding:"3px 10px"}} disabled={page>=total} onClick={()=>onPage(Math.min(total,page+1))}>›</button>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function MarketPage(){
  const { resolveItemName } = useGameData();

  const [snapshot,   setSnapshot]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [lastFetch,  setLastFetch]  = useState(null);
  const [alertMsg,   setAlertMsg]   = useState(null); // kept for any inline use
  const [pollMins,   setPollMins]   = useState(15);
  const [nextFetch,  setNextFetch]  = useState(null);
  const [countdown,  setCountdown]  = useState(null);

  const [searchQ,   setSearchQ]   = useState("");
  const [sortState, setSortState] = useState({col:"discountPct", dir:"desc"});
  const [page,      setPage]      = useState(1);

  // ── Price history for sparklines (keyed by itemId) ───────────────────────
  const [history,   setHistory]  = useState({});  // { [itemId]: number[] }
  const histReqRef = useRef(null); // tracks which itemIds were last fetched

  // ── Price history modal ───────────────────────────────────────────────────
  const [historyItem, setHistoryItem] = useState(null); // row object or null

  // AudioContext must be created/resumed after a user gesture to avoid
  // browser autoplay policy blocking the beep.
  const audioCtx = useRef(null);
  const audioReady = useRef(false);

  function ensureAudio(){
    try{
      if (!audioCtx.current){
        audioCtx.current = new (window.AudioContext||window.webkitAudioContext)();
      }
      if (audioCtx.current.state === "suspended"){
        audioCtx.current.resume();
      }
      audioReady.current = true;
    }catch{}
  }

  // Pre-warm audio on first click anywhere on the page
  useEffect(()=>{
    const handler = ()=>{ ensureAudio(); document.removeEventListener("click", handler); };
    document.addEventListener("click", handler);
    return ()=>document.removeEventListener("click", handler);
  }, []);

  function playBeep(){
    try{
      ensureAudio();
      if (!audioCtx.current) return;
      const ctx = audioCtx.current;
      // Two-tone pleasant chime: C5 then E5
      [[523, 0], [659, 0.15]].forEach(([freq, when])=>{
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = ctx.currentTime + when;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    }catch(e){ console.warn("playBeep error", e); }
  }

  const loadFromDB = useCallback(async()=>{
    try{
      const res = await api.marketGetSnapshot?.();
      if (res?.rows?.length){ setSnapshot(res.rows); setLastFetch(res.fetchedAt); }
    }catch(e){ console.error("market loadFromDB", e); }
  }, []);

  async function fetchNow(){
    setLoading(true); setFetchError(null);
    try{
      await api.marketFetchPrices?.({ includeAverage:true });
      await loadFromDB();
    }catch(e){ setFetchError(String(e?.message||e)); }
    finally{ setLoading(false); }
  }

  // Listen for background poll events — main process fires these regardless of active page
  useEffect(()=>{
    const offUpdate = api.onMarketUpdated?.((d)=>{
      loadFromDB();
      setLastFetch(d.fetchedAt);
      // Re-read the authoritative next-fetch time from main process
      api.marketGetNextFetch?.().then(nf=>{
        if (nf?.nextFetchAt && nf.nextFetchAt > Date.now()) setNextFetch(nf.nextFetchAt);
        else if (pollMins > 0) setNextFetch(Date.now() + pollMins*60*1000);
      }).catch(()=>{ if (pollMins>0) setNextFetch(Date.now()+pollMins*60*1000); });
    });
    return ()=>{ try{offUpdate?.();}catch{} };
  }, [loadFromDB, pollMins]); // eslint-disable-line

  useEffect(()=>{
    loadFromDB();
    Promise.all([
      api.getSettings?.().catch(()=>null),
      api.marketGetNextFetch?.().catch(()=>null),
    ]).then(([s, nf])=>{
      const pm = Math.max(0, Number(s?.marketPollMinutes??15));
      setPollMins(pm);
      // Use the real next-fetch time from the main process so navigating
      // away and back doesn't reset the countdown to a full interval
      if (nf?.nextFetchAt && nf.nextFetchAt > Date.now()){
        setNextFetch(nf.nextFetchAt);
      } else if (pm > 0){
        setNextFetch(Date.now() + pm*60*1000);
      }
    }).catch(()=>{});
  }, []); // eslint-disable-line

  useEffect(()=>{
    const t = setInterval(()=>{
      if (!nextFetch){ setCountdown(null); return; }
      setCountdown(Math.max(0, Math.round((nextFetch-Date.now())/1000)));
    }, 1000);
    return ()=>clearInterval(t);
  }, [nextFetch]);

  // Resolve and title-case item name
  const rn = (row) => {
    const raw = row.name || resolveItemName(row.itemId) || "";
    return raw ? toTitle(raw) : `Item #${row.itemId}`;
  };

  function mkSort(col){
    setSortState(p => p.col===col ? {col, dir:p.dir==="desc"?"asc":"desc"} : {col, dir:"desc"});
    setPage(1);
  }

  // ── Underpriced: lowestSellPrice < dailyAveragePrice ───────────────────
  // discountPct = how many % below the daily average the item currently is.
  // Sorted by biggest discount first by default — the best flips are at the top.
  const underpriced = useMemo(()=>{
    const q = searchQ.trim().toLowerCase();
    const rows = snapshot
      .filter(r =>
        r.lowestSellPrice > 0 &&
        r.dailyAveragePrice > 0 &&
        r.lowestSellPrice < r.dailyAveragePrice &&
        r.lowestPriceVolume > 0
      )
      .map(r=>({
        ...r,
        _name: rn(r),
        // discountPct: how far below avg the listing is (higher = bigger deal)
        discountPct: ((r.dailyAveragePrice - r.lowestSellPrice) / r.dailyAveragePrice) * 100,
        // savingPerUnit: coins saved vs the daily average
        savingPerUnit: r.dailyAveragePrice - r.lowestSellPrice,
      }));

    const filtered = q ? rows.filter(r=>r._name.toLowerCase().includes(q)) : rows;

    const { col, dir } = sortState;
    filtered.sort((a,b)=>{
      const av = col==="_name" ? a._name : Number(a[col]||0);
      const bv = col==="_name" ? b._name : Number(b[col]||0);
      if (typeof av==="string") return dir==="asc"?av.localeCompare(bv):bv.localeCompare(av);
      return dir==="asc" ? av-bv : bv-av;
    });
    return filtered;
  }, [snapshot, searchQ, sortState]); // eslint-disable-line

  const totalPages = Math.max(1, Math.ceil(underpriced.length/PAGE_SIZE));
  const pageSlice  = underpriced.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  // Fetch sparkline history for the visible page slice whenever it changes.
  // Uses a stable serialised key so the effect only fires when the set of
  // visible itemIds actually changes (not on every render).
  const sliceKey = pageSlice.map(r=>r.itemId).join(",");
  useEffect(()=>{
    if (!sliceKey) return;
    if (histReqRef.current === sliceKey) return; // already fetched this set
    histReqRef.current = sliceKey;
    const ids = pageSlice.map(r=>r.itemId);
    api.marketGetHistory?.({ itemIds: ids, limit: 20 })
      .then(res=>{
        if (!res?.rows?.length) return;
        // Group rows by itemId and extract lowestSellPrice series (oldest→newest)
        const map = {};
        for (const row of res.rows){
          if (!map[row.itemId]) map[row.itemId] = [];
          map[row.itemId].push(Number(row.lowestSellPrice));
        }
        setHistory(prev=>({ ...prev, ...map }));
      })
      .catch(()=>{});
  }, [sliceKey]); // eslint-disable-line


  const sth = { current:sortState.col, dir:sortState.dir, onSort:mkSort };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}
      onClick={ensureAudio}> {/* unlock audio on first interaction */}

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="card">
        <div className="cardBody">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
            <div>
              <div style={{ fontWeight:800, fontSize:20, marginBottom:3 }}>Market</div>
              <div style={{ fontSize:12, opacity:0.45 }}>
                Underpriced listings · items listed below their 24h average price
                {lastFetch && <> · Last fetch: {fmtTs(lastFetch)}</>}
              </div>
            </div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              {countdown!==null && pollMins>0 && (
                <span style={{ fontSize:12, opacity:0.35 }}>Next: {fmtCountdown(countdown)}</span>
              )}
              {pollMins===0 && (
                <span style={{ fontSize:12, opacity:0.3 }}>Manual · set interval in Settings → Market</span>
              )}
              <button className="btn btnPrimary" onClick={fetchNow} disabled={loading}>
                {loading ? "Fetching…" : "Refresh Data"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {fetchError && (
        <div style={{ padding:"12px 16px", borderRadius:10, background:"rgba(var(--danger-rgb),0.08)",
          border:"1px solid rgba(var(--danger-rgb),0.25)", color:"#fca5a5", fontSize:13 }}>
          <b>Fetch failed:</b> {fetchError}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
            opacity:0.35, fontSize:13, pointerEvents:"none" }}>🔍</span>
          <input className="input" value={searchQ}
            onChange={e=>{ setSearchQ(e.target.value); setPage(1); }}
            placeholder="Search items…"
            style={{ paddingLeft:30, width:260, fontSize:13 }} />
        </div>
        <span style={{ fontSize:12, opacity:0.4 }}>
          {snapshot.length===0 ? "No data" : `${underpriced.length} underpriced of ${snapshot.length.toLocaleString()} items`}
        </span>
      </div>

      {/* ── Empty states ─────────────────────────────────────────── */}
      {snapshot.length===0 && !loading && (
        <div style={{ textAlign:"center", opacity:0.3, padding:48, fontSize:13 }}>
          No market data yet — click Refresh Data to fetch current prices.
        </div>
      )}

      {snapshot.length>0 && underpriced.length===0 && (
        <div style={{ textAlign:"center", opacity:0.3, padding:32, fontSize:13 }}>
          No underpriced items found. The daily average price must be available from the API
          (fetched with Refresh Data).
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────── */}
      {pageSlice.length>0 && (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="_name"            {...sth}          style={{width:"28%"}}>Item Name</SortTh>
                  <th style={{width:"9%", textAlign:"center", opacity:0.55, fontWeight:600, fontSize:11}}>7d Trend</th>
                  <SortTh col="dailyAveragePrice" {...sth} align="right" style={{width:"13%"}}>Daily Avg</SortTh>
                  <SortTh col="lowestSellPrice"   {...sth} align="right" style={{width:"13%"}}>Listed At</SortTh>
                  <SortTh col="discountPct"       {...sth} align="right" style={{width:"12%"}}>Below Avg</SortTh>
                  <SortTh col="savingPerUnit"     {...sth} align="right" style={{width:"13%"}}>Saving / Unit</SortTh>
                  <SortTh col="lowestPriceVolume" {...sth} align="right" style={{width:"12%"}}>Volume</SortTh>
                </tr>
              </thead>
              <tbody>
                {pageSlice.map(r=>(
                  <tr key={r.itemId} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ fontWeight:600 }}>{r._name}</td>
                    <td style={{ textAlign:"center", padding:"4px 6px" }}>
                      <Sparkline prices={history[r.itemId]}
                        onClick={()=>setHistoryItem(r)}
                        title="Click for full price history" />
                    </td>
                    <td style={{ textAlign:"right", opacity:0.6 }}>{fmtNum(r.dailyAveragePrice)}</td>
                    <td style={{ textAlign:"right", fontWeight:700, color:"var(--success)" }}>{fmtNum(r.lowestSellPrice)}</td>
                    <td style={{ textAlign:"right" }}><DiscountBadge pct={r.discountPct} /></td>
                    <td style={{ textAlign:"right", fontWeight:700, color:"var(--success)" }}>{fmtNum(r.savingPerUnit)}</td>
                    <td style={{ textAlign:"right", opacity:0.55 }}>{fmtNum(r.lowestPriceVolume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={page} total={totalPages} onPage={setPage} />
        </>
      )}

      {historyItem && (
        <PriceHistoryModal item={historyItem} onClose={()=>setHistoryItem(null)} />
      )}
    </div>
  );
}
