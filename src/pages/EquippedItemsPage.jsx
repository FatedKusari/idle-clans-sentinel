import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/bridge.js";
import { useGameData } from "../lib/gameDataContext.jsx";

// ── Slot metadata ─────────────────────────────────────────────────────────────
// Keys match the player's equipment object; order determines display order.
const SLOT_DEFS = [
  { key: "head",       label: "Head",       icon: "🪖" },
  { key: "body",       label: "Body",       icon: "🛡️" },
  { key: "legs",       label: "Legs",       icon: "👖" },
  { key: "boots",      label: "Boots",      icon: "👢" },
  { key: "gloves",     label: "Gloves",     icon: "🧤" },
  { key: "cape",       label: "Cape",       icon: "🧣" },
  { key: "amulet",     label: "Amulet",     icon: "📿" },
  { key: "earrings",   label: "Earrings",   icon: "💎" },
  { key: "bracelet",   label: "Bracelet",   icon: "🔮" },
  { key: "jewellery",  label: "Jewellery",  icon: "💍" },
  { key: "rightHand",  label: "Weapon",     icon: "⚔️" },
  { key: "leftHand",   label: "Off-hand",   icon: "🛡️" },
  { key: "ammo",       label: "Ammo",       icon: "🏹" },
  { key: "belt",       label: "Belt",       icon: "🔧" },
  { key: "pet",        label: "Pet",        icon: "🐾" },
];
const SLOT_KEY_SET = new Set(SLOT_DEFS.map(s => s.key));
const SLOT_LABEL   = Object.fromEntries(SLOT_DEFS.map(s => [s.key, s.label]));
const SLOT_ICON    = Object.fromEntries(SLOT_DEFS.map(s => [s.key, s.icon]));

export default function EquippedItemsPage() {
  const { resolveItemName } = useGameData();

  // bySlot: { [slotKey]: [ [itemId, count], ... ] sorted desc }
  const [bySlot, setBySlot]             = useState({});
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [loading, setLoading]           = useState(false);
  const [search, setSearch]             = useState("");
  const [activeSlot, setActiveSlot]     = useState("all");

  // Drill-down
  const [selectedItem, setSelectedItem] = useState(null);
  const [drillPlayers, setDrillPlayers] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillSearch, setDrillSearch]   = useState("");

  const [activeOnly, setActiveOnly] = useState(()=>{
    try{ return localStorage.getItem("equippedItems_activeOnly") === "1"; }catch{ return false; }
  });
  const [staleDays, setStaleDays] = useState(7);

  // Load staleDays from settings once
  useEffect(()=>{
    api.getSettings?.().then(s=>{
      const d = Number(s?.dormantThresholdDays ?? s?.autoRefreshStaleDays ?? 14);
      if (Number.isFinite(d) && d > 0) setStaleDays(d);
    }).catch(()=>{});
  }, []);

  // Persist activeOnly toggle
  function toggleActiveOnly(){
    setActiveOnly(v=>{
      const next = !v;
      try{ localStorage.setItem("equippedItems_activeOnly", next ? "1" : "0"); }catch{}
      return next;
    });
  }

  // ── LOAD ────────────────────────────────────────────────────────────────────
  async function loadAll() {
    setLoading(true);
    setSelectedItem(null);
    setDrillPlayers([]);
    setSearch("");
    try {
      const rows = await api.listPlayersWithEquipment({ activeOnly, staleDays });
      // counts per slot: { slotKey: { itemId: count } }
      const slotCounts = {};
      let validCount = 0;

      for (const r of rows) {
        try {
          const equipment = JSON.parse(r.equipmentJson);
          let hasAny = false;
          for (const [slot, rawVal] of Object.entries(equipment)) {
            if (!SLOT_KEY_SET.has(slot)) continue;
            const id = Number(rawVal);
            if (!Number.isFinite(id) || id === -1 || id === 0) continue;
            hasAny = true;
            if (!slotCounts[slot]) slotCounts[slot] = {};
            slotCounts[slot][id] = (slotCounts[slot][id] || 0) + 1;
          }
          if (hasAny) validCount++;
        } catch {}
      }

      // Sort each slot by count desc — no artificial limit
      const built = {};
      for (const slot of SLOT_DEFS.map(s => s.key)) {
        if (!slotCounts[slot]) continue;
        built[slot] = Object.entries(slotCounts[slot])
          .sort((a, b) => b[1] - a[1]);
      }
      setBySlot(built);
      setTotalPlayers(validCount);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [activeOnly, staleDays]); // eslint-disable-line

  // ── DRILL-DOWN ──────────────────────────────────────────────────────────────
  const handleItemClick = useCallback(async (itemId) => {
    if (selectedItem === itemId) {
      setSelectedItem(null);
      setDrillPlayers([]);
      setDrillSearch("");
      return;
    }
    setSelectedItem(itemId);
    setDrillPlayers([]);
    setDrillSearch("");
    setDrillLoading(true);
    try {
      const result = await api.getPlayersWithItem(itemId, { activeOnly, staleDays });
      setDrillPlayers(result ?? []);
    } catch { setDrillPlayers([]); }
    finally { setDrillLoading(false); }
  }, [selectedItem]);

  // ── FILTERED VIEW ───────────────────────────────────────────────────────────
  // Build a flat list for search mode, or return per-slot data for normal mode
  const searchQ = search.trim().toLowerCase();

  const slotsToShow = useMemo(() => {
    if (activeSlot !== "all") {
      const slotData = bySlot[activeSlot];
      if (!slotData) return [];
      return [{ key: activeSlot, items: slotData }];
    }
    return SLOT_DEFS
      .filter(s => bySlot[s.key]?.length)
      .map(s => ({ key: s.key, items: bySlot[s.key] }));
  }, [bySlot, activeSlot]);

  const filteredSlots = useMemo(() => {
    if (!searchQ) return slotsToShow;
    return slotsToShow
      .map(s => ({
        ...s,
        items: s.items.filter(([itemId]) =>
          resolveItemName(itemId).toLowerCase().includes(searchQ)
        ),
      }))
      .filter(s => s.items.length > 0);
  }, [slotsToShow, searchQ, resolveItemName]);

  const totalVisible = useMemo(() =>
    filteredSlots.reduce((acc, s) => acc + s.items.length, 0),
  [filteredSlots]);

  const filteredDrillPlayers = useMemo(() => {
    const q = drillSearch.trim().toLowerCase();
    if (!q) return drillPlayers;
    return drillPlayers.filter(p => p.username?.toLowerCase().includes(q));
  }, [drillPlayers, drillSearch]);

  // ── RENDER ──────────────────────────────────────────────────────────────────
  const slotsWithData = SLOT_DEFS.filter(s => bySlot[s.key]?.length);

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16, gap:10, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:18 }}>Equipped Items</div>
          <div style={{ fontSize:13, opacity:0.5, marginTop:2 }}>
            {totalPlayers > 0 ? `${totalPlayers.toLocaleString()} players with equipment data` : ""}
          </div>
        </div>
        <button className="btn" onClick={loadAll} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>

      {/* Search + slot filter bar */}
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
        <input
          className="input"
          placeholder="Search all items…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width:240 }}
          autoComplete="off"
        />
        {search && (
          <span style={{ fontSize:12, opacity:0.45 }}>
            {totalVisible.toLocaleString()} item{totalVisible !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Slot tabs */}
      {slotsWithData.length > 0 && (
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:16 }}>
          <button
            onClick={() => setActiveSlot("all")}
            style={{
              padding:"4px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
              background: activeSlot === "all" ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.08)",
              color: activeSlot === "all" ? "#fff" : "rgba(255,255,255,0.6)",
            }}
          >
            All slots
          </button>
          {slotsWithData.map(s => (
            <button
              key={s.key}
              onClick={() => setActiveSlot(s.key)}
              style={{
                padding:"4px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, fontWeight:600,
                background: activeSlot === s.key ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.08)",
                color: activeSlot === s.key ? "#fff" : "rgba(255,255,255,0.6)",
              }}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ opacity:0.4, textAlign:"center", padding:32 }}>Loading equipment data…</div>
      )}

      {!loading && filteredSlots.length === 0 && (
        <div style={{ opacity:0.4, textAlign:"center", padding:32 }}>
          {search ? "No items match your search." : "No data. Click Reload."}
        </div>
      )}

      {/* Slot sections */}
      {!loading && filteredSlots.map(({ key, items }) => (
        <div key={key} style={{ marginBottom:20 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:8, marginBottom:8,
            fontSize:13, fontWeight:800, opacity:0.7,
            textTransform:"uppercase", letterSpacing:"0.06em",
          }}>
            <span>{SLOT_ICON[key]}</span>
            <span>{SLOT_LABEL[key]}</span>
            <span style={{ fontWeight:400, opacity:0.5 }}>({items.length.toLocaleString()})</span>
          </div>

          <div className="card">
            <div className="cardBody">
              {items.map(([itemId, count]) => {
                const isOpen = selectedItem === itemId;
                const name   = resolveItemName(itemId);

                return (
                  <div key={itemId} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    <div
                      style={{
                        display:"flex", alignItems:"center", justifyContent:"space-between",
                        padding:"7px 4px", cursor:"pointer", borderRadius:6,
                        background: isOpen ? "rgba(var(--info-rgb),0.07)" : "transparent",
                        transition:"background 0.1s",
                      }}
                      onClick={() => handleItemClick(itemId)}
                    >
                      <span style={{ fontWeight:600, fontSize:13 }}>{name}</span>
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
                              <div style={{ maxHeight:220, overflowY:"auto", display:"flex", flexWrap:"wrap", gap:"3px 14px" }}>
                                {filteredDrillPlayers.slice(0, 400).map(p => (
                                  <Link
                                    key={p.username}
                                    to={`/players/${encodeURIComponent(p.username)}`}
                                    style={{ fontSize:13, fontWeight:600, textDecoration:"none", color:"var(--accent,#60a5fa)" }}
                                  >
                                    {p.username}
                                  </Link>
                                ))}
                                {filteredDrillPlayers.length > 400 && (
                                  <span style={{ fontSize:12, opacity:0.4, alignSelf:"center" }}>
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
        </div>
      ))}
    </div>
  );
}