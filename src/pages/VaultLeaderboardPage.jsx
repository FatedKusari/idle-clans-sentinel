import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/bridge.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtQty(n){
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return (n/1_000_000_000).toFixed(2).replace(/\.?0+$/,"")+"B";
  if (n >= 1_000_000)     return (n/1_000_000).toFixed(2).replace(/\.?0+$/,"")+"M";
  if (n >= 1_000)         return (n/1_000).toFixed(1).replace(/\.?0+$/,"")+"K";
  return n.toLocaleString();
}

function fmtGold(n){
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return (n/1_000_000_000).toFixed(2).replace(/\.?0+$/,"")+"B";
  if (n >= 1_000_000)     return (n/1_000_000).toFixed(2).replace(/\.?0+$/,"")+"M";
  if (n >= 1_000)         return (n/1_000).toFixed(1).replace(/\.?0+$/,"")+"K";
  return n.toLocaleString();
}

function itemImageUrl(snakeName){
  if (!snakeName) return null;
  const packaged = window.location.protocol === "file:";
  return packaged
    ? `asset://gameimages/${snakeName}.png`
    : `/gameimages/${snakeName}.png`;
}

function ItemThumb({ snakeName, name, size=28 }){
  const [fail, setFail] = useState(false);
  const src = !fail ? itemImageUrl(snakeName) : null;
  return src
    ? <img src={src} alt={name} onError={()=>setFail(true)}
        style={{ width:size, height:size, objectFit:"contain", imageRendering:"pixelated", flexShrink:0 }} />
    : <span style={{ fontSize:size*0.7, opacity:0.4, flexShrink:0 }}>📦</span>;
}

// ── main component ────────────────────────────────────────────────────────────

export default function VaultLeaderboardPage(){
  const [itemQuery,   setItemQuery]   = useState("");       // what the user typed
  const [searchTerm,  setSearchTerm]  = useState("");       // committed search
  const [data,        setData]        = useState(null);     // leaderboard result
  const [loading,     setLoading]     = useState(false);
  const [topN,        setTopN]        = useState(50);
  const inputRef = useRef(null);

  const load = useCallback(async (item, n) => {
    setLoading(true);
    try{
      const res = await api.getVaultLeaderboard?.({ itemName: item.trim(), topN: n });
      setData(res || null);
    }catch(e){ console.error("vault leaderboard error", e); setData(null); }
    finally{ setLoading(false); }
  }, []);

  // Load overview on mount
  useEffect(()=>{ load("", topN); }, []); // eslint-disable-line

  function handleSearch(e){
    e.preventDefault();
    const term = itemQuery.trim();
    setSearchTerm(term);
    load(term, topN);
  }

  function handleClear(){
    setItemQuery("");
    setSearchTerm("");
    load("", topN);
  }

  const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":null;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
        flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:13, opacity:0.45 }}>
            Ranked by estimated vault contents across all clans with stored logs.
            {data && <span style={{ marginLeft:6 }}>
              {data.totalClansWithVaultData.toLocaleString()} clan{data.totalClansWithVaultData!==1?"s":""} with vault data.
            </span>}
          </div>
        </div>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ position:"relative", flex:1, minWidth:220 }}>
          <input
            ref={inputRef}
            value={itemQuery}
            onChange={e=>setItemQuery(e.target.value)}
            placeholder="Search by item name… (e.g. Iron Ore, Rare enchantment scroll (farming))"
            style={{ width:"100%", boxSizing:"border-box", padding:"8px 36px 8px 12px",
              borderRadius:8, border:"1px solid rgba(255,255,255,0.12)",
              background:"rgba(0,0,0,0.2)", color:"inherit", fontSize:13 }}
          />
          {itemQuery && (
            <button type="button" onClick={handleClear}
              style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                background:"none", border:"none", cursor:"pointer", opacity:0.45,
                fontSize:16, color:"inherit", lineHeight:1 }}>×</button>
          )}
        </div>
        <button type="submit" className="btn btnPrimary" disabled={loading} style={{ flexShrink:0 }}>
          {loading ? "Loading…" : "Search"}
        </button>
        <button type="button" className="btn" disabled={loading}
          onClick={()=>{ setItemQuery(""); setSearchTerm(""); load("", topN); }}
          style={{ flexShrink:0 }}>
          Overview
        </button>
        {/* Top N selector */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ fontSize:12, opacity:0.45 }}>Show</span>
          {[25,50,100].map(n=>(
            <button key={n} type="button" onClick={()=>{ setTopN(n); load(searchTerm, n); }}
              style={{ padding:"5px 10px", borderRadius:6, border:"none", cursor:"pointer",
                fontSize:12, fontWeight:600,
                background: topN===n ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                color: topN===n ? "#fff" : "rgba(255,255,255,0.4)" }}>
              {n}
            </button>
          ))}
        </div>
      </form>

      {/* Active search badge */}
      {searchTerm && (
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, opacity:0.5 }}>Showing clans with the most:</span>
          <span style={{ fontSize:13, fontWeight:700, padding:"3px 10px", borderRadius:20,
            background:"rgba(var(--info-rgb),0.12)", border:"1px solid rgba(var(--info-rgb),0.25)",
            color:"#93c5fd" }}>
            {searchTerm}
          </span>
          {data?.targetSnake && (
            <ItemThumb snakeName={data.targetSnake} name={searchTerm} size={22} />
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ opacity:0.4, fontSize:13, padding:"32px 0", textAlign:"center" }}>
          Computing vault contents across all clans…
        </div>
      )}

      {/* No results */}
      {!loading && data && data.results.length === 0 && (
        <div style={{ opacity:0.35, fontSize:13, padding:"24px 0" }}>
          {searchTerm
            ? `No clans found with "${searchTerm}" in their vault.`
            : "No vault data found. Scan some clan logs first."}
        </div>
      )}

      {/* Leaderboard table */}
      {!loading && data && data.results.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:0,
          border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, overflow:"hidden" }}>

          {/* Column headers */}
          <div style={{ display:"grid",
            gridTemplateColumns: searchTerm ? "40px 1fr 140px 100px 80px" : "40px 1fr 80px 100px 80px",
            gap:0, padding:"8px 14px",
            background:"rgba(255,255,255,0.03)",
            borderBottom:"1px solid rgba(255,255,255,0.08)",
            fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em" }}>
            <span>#</span>
            <span>Clan</span>
            {searchTerm ? <span style={{ textAlign:"right" }}>Qty</span> : <span style={{ textAlign:"center" }}>Top items</span>}
            <span style={{ textAlign:"right" }}>Gold</span>
            <span style={{ textAlign:"right" }}>Item types</span>
          </div>

          {/* Rows */}
          {data.results.map((row, i) => (
            <div key={row.lowerName} style={{
              display:"grid",
              gridTemplateColumns: searchTerm ? "40px 1fr 140px 100px 80px" : "40px 1fr 80px 100px 80px",
              gap:0, padding:"11px 14px", alignItems:"center",
              borderBottom: i < data.results.length-1 ? "1px solid rgba(255,255,255,0.05)" : "none",
              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
            }}>

              {/* Rank */}
              <div style={{ fontSize:13, fontWeight:700, opacity:0.5 }}>
                {medal(i) || <span style={{ opacity:0.4 }}>{i+1}</span>}
              </div>

              {/* Clan name */}
              <div style={{ minWidth:0 }}>
                <Link to={`/clans/${encodeURIComponent(row.clanName)}`}
                  style={{ fontWeight:700, fontSize:14, textDecoration:"none",
                    borderBottom:"1px dotted rgba(255,255,255,0.3)" }}>
                  {row.clanName}
                </Link>
              </div>

              {/* Item quantity or top-items preview */}
              {searchTerm ? (
                <div style={{ textAlign:"right", fontWeight:800, fontSize:16,
                  color:"rgba(255,220,100,0.95)" }}>
                  {fmtQty(row.qty)}
                </div>
              ) : (
                <div style={{ display:"flex", gap:5, justifyContent:"center", alignItems:"center" }}>
                  {(row.topItems||[]).map(it=>(
                    <div key={it.name} title={`${it.name}: ${it.qty.toLocaleString()}`}
                      style={{ position:"relative" }}>
                      <ItemThumb snakeName={it.snakeName} name={it.name} size={24} />
                    </div>
                  ))}
                </div>
              )}

              {/* Gold */}
              <div style={{ textAlign:"right", fontSize:13,
                color: row.gold > 0 ? "var(--warning2)" : "rgba(255,255,255,0.2)",
                fontWeight: row.gold > 0 ? 700 : 400 }}>
                {fmtGold(row.gold) || "—"}
              </div>

              {/* Item type count */}
              <div style={{ textAlign:"right", fontSize:13, opacity:0.6 }}>
                {row.itemCount.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize:12, opacity:0.25, lineHeight:1.6, marginTop:4 }}>
        Quantities are estimates based on vault log events observed during scans.
        Only clans whose logs have been fetched appear here.
      </div>
    </div>
  );
}
