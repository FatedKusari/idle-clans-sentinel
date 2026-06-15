
import React, { useEffect, useMemo, useState } from "react";
import * as ReactDOM from "react-dom";
import { Card } from "../components/Card.jsx";
import { nameSimilarity } from "../lib/nameSimilarity.js";
import { xpToLevel } from "../lib/xp.js";
import { useGameData } from "../lib/gameDataContext.jsx";
import { scoreFromCompareSnapshot } from "../utils/caseReport.js";
import { modeLabel } from "../lib/format.js";

// ── Tooltip ─────────────────────────────────────────────────────────────────
// Portal-based — renders into document.body so overflow:hidden parents can't clip it.
function Tooltip({ text, children }){
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  function show(){
    if (ref.current){
      const r = ref.current.getBoundingClientRect();
      setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
    }
  }
  function hide(){ setPos(null); }
  const portal = pos ? ReactDOM.createPortal(
    <span style={{
      position:"fixed", left:pos.x, top:pos.y, transform:"translateX(-50%)",
      background:"rgba(10,10,14,0.97)", border:"1px solid rgba(255,255,255,0.15)",
      borderRadius:8, padding:"7px 11px", fontSize:12, lineHeight:1.5,
      color:"rgba(255,255,255,0.85)", whiteSpace:"pre-wrap", maxWidth:240,
      zIndex:99999, pointerEvents:"none", boxShadow:"0 8px 24px rgba(0,0,0,0.5)",
    }}>{text}</span>,
    document.body
  ) : null;
  return (
    <span ref={ref} style={{ display:"inline-flex", alignItems:"center" }}
      onMouseEnter={show} onMouseLeave={hide}>
      {children}{portal}
    </span>
  );
}

function InfoIcon({ tip }){
  return (
    <Tooltip text={tip}>
      <span style={{
        display:"inline-flex", alignItems:"center", justifyContent:"center",
        width:15, height:15, borderRadius:"50%",
        background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.18)",
        fontSize:9, fontWeight:800, color:"rgba(255,255,255,0.5)",
        cursor:"help", flexShrink:0, lineHeight:1,
      }}>i</span>
    </Tooltip>
  );
}

// ── How-to-use guide ─────────────────────────────────────────────────────────
function HowToUse(){
  const [open, setOpen] = React.useState(false);

  return (
    <div style={{
      background: open
        ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.04)"
        : "transparent",
      border: open
        ? "1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.18)"
        : "1px solid rgba(255,255,255,0.07)",
      borderRadius:12,
      overflow:"hidden",
      transition:"border-color 0.15s",
    }}>
      {/* Always-visible header — click to toggle */}
      <button
        onClick={()=>setOpen(o=>!o)}
        style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"9px 14px", background:"none", border:"none", cursor:"pointer",
          color:"inherit",
        }}>
        <span style={{ fontSize:13, fontWeight:700, opacity: open ? 1 : 0.45 }}>
          How to use Player Compare
        </span>
        <span style={{ fontSize:12, opacity:0.35, transition:"transform 0.15s",
          display:"inline-block", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
      </button>

      {/* Collapsible body */}
      {open && (
        <div style={{ padding:"0 14px 14px", display:"flex", flexDirection:"column", gap:8 }}>
          {[
            ["1", "Search & add players", "Add two or more suspected alt accounts, mules, or players you want to investigate. Start by searching a username above."],
            ["2", "Check the Suspicion Score", "A score appears once you have players loaded. Green (0-24) = likely fine, Amber (25-49) = worth watching, Red (50+) = strong signals detected. The breakdown tells you exactly what triggered it."],
            ["3", "Review Name Similarity", "Similar usernames between accounts is a common alt-account tell. 90%+ is a very strong match, 80%+ is suspicious."],
            ["4", "Analyse vault activity", "The Vault Analysis section shows who is depositing and withdrawing from clan vaults. A flagged clan means one player is taking the lion's share of withdrawals - a classic mule pattern."],
            ["5", "Save your findings", "Use 'Save to case' to snapshot everything into an investigation case for later review or reporting."],
          ].map(([num, title, desc])=>(
            <div key={num} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{
                flexShrink:0, width:20, height:20, borderRadius:"50%",
                background:"rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.18)",
                border:"1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.35)",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:10, fontWeight:800,
                color:"rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.9)",
              }}>{num}</div>
              <div style={{ fontSize:12, lineHeight:1.55 }}>
                <span style={{ fontWeight:700 }}>{title} — </span>
                <span style={{ opacity:0.65 }}>{desc}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function fmtAgoFromHoursOffline(hours){
  const h = Number(hours);
  if (!isFinite(h)) return "Unknown";
  const mins = h * 60;
  if (mins < 2) return "Recently";
  if (mins < 60) return `${Math.round(mins)} min ago`;
  const hoursR = Math.round(h*10)/10;
  if (hoursR < 48) return `${hoursR} hours ago`;
  const days = Math.round((h/24)*10)/10;
  return `${days} days ago`;
}

function fmtInt(n){
  const x = Number(n);
  if (!isFinite(x)) return "-";
  return x.toLocaleString();
}

function fmtLocalDateTime(iso){
  if (!iso) return "-";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return String(iso);
  // Compact, readable local time; keep ISO available via tooltip where used.
  return d.toLocaleString(undefined, { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function fmtMoveLine(name, qty, item, events, kind){
  const q = Number(qty)||0;
  const e = Math.max(0, Number(events)||0);
  const it = item ? ` ${item}` : "";
  const k = kind === "withdraw" ? "withdrawal" : "deposit";
  const kPlural = e === 1 ? k : `${k}s`;
  if (!e) return `${name}: ${fmtInt(q)}${it}`;
  const avg = Math.round(q / e);
  // "total" removes ambiguity (total vs per-event)
  return `${name}: total ${fmtInt(q)}${it} over ${e} ${kPlural} (avg ${fmtInt(avg)})`;
}

function titleCaseWords(s){
  const str = String(s || "").trim();
  if (!str) return "";
  return str
    .replace(/_/g, " ")
    .split(/\s+/g)
    .map(w=> w ? (w[0].toUpperCase() + w.slice(1)) : w)
    .join(" ");
}


function equipLabel(v, resolveItemName){
  if (v == null) return "—";
  // equipment is typically ItemId number; keep safe for legacy shapes
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))){
    return resolveItemName ? resolveItemName(Number(v)) : `#${String(v)}`;
  }
  if (typeof v === "string") return v;
  if (typeof v === "object"){
    if (v && "id" in v) return resolveItemName ? resolveItemName(v.id) : `#${String(v.id)}`;
    if (v && "name" in v) return String(v.name);
    return JSON.stringify(v);
  }
  return String(v);
}

const EQUIP_ORDER = [
  "head","cape","amulet","earrings","body","legs","gloves","boots",
  "bracelet","belt","leftHand","rightHand","ammo","jewellery","pet"
];

const SKILL_ORDER = [
  "agility","archery","attack","brewing","carpentry","cooking","crafting",
  "defence","enchanting","exterminating","farming","fishing","foraging",
  "health","magic","mining","plundering","smithing","strength","woodcutting", "invocation"
];

function parseVaultEvent(raw){
  // Return { type: "added"|"withdrew", qty, item } or null
  const s = String(raw || "").trim();
  // Examples:
  // "breadman withdrew 1000x Papaya."
  // "breadman added 421x Platinum ore."
  // Gold sometimes may be "withdrew 5000 gold." (no "x")
  const m = s.match(/^(.*?)\s+(added|withdrew)\s+([\d,]+)\s*(x)?\s*(.+?)\.\s*$/i);
  if (!m) return null;
  const type = m[2].toLowerCase() === "added" ? "added" : "withdrew";
  const qty = Number(String(m[3]).replace(/,/g, ""));
  if (!isFinite(qty)) return null;
  const item = String(m[5] || "").trim().toLowerCase();
  return { type, qty, item };
}

function toTs(x){
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
}

function formatEta(ms){
  if (!isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const ss = s%60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

export default function PlayerComparePage(){
  const { resolveItemName } = useGameData();
  const [query,setQuery] = useState("");
  const [selected,setSelected] = useState(()=>{
    try{
      const raw = localStorage.getItem("idleclans_compare_players_v1");
      const a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    }catch{ return []; }
  });

  const [rowsByName,setRowsByName] = useState({}); // name -> {player, logs, error, loading}
  const [suggestions,setSuggestions] = useState([]);
  const [busyAll,setBusyAll] = useState(false);

  // Cases (investigation snapshots)
  const [caseOpen,setCaseOpen] = useState(false);
  const [caseList,setCaseList] = useState([]);
  const [caseId,setCaseId] = useState("");
  const [caseNewTitle,setCaseNewTitle] = useState("");
  const [caseNote,setCaseNote] = useState("");
  const [caseBusy,setCaseBusy] = useState(false);

  // Vault analysis filters
  const [windowDays,setWindowDays] = useState(()=>{
    const raw = localStorage.getItem("idleclans_compare_windowDays_v1");
    const n = Number(raw);
    return Number.isFinite(n) && n>0 ? n : 60;
  });
  const [minQty,setMinQty] = useState(()=>{
    const raw = localStorage.getItem("idleclans_compare_minQty_v1");
    const n = Number(raw);
    return Number.isFinite(n) && n>0 ? n : 5000;
  });

  const [muleSpanHours,setMuleSpanHours] = useState(()=>{
    const raw = localStorage.getItem("idleclans_compare_muleSpanHours_v1");
    const n = Number(raw);
    return Number.isFinite(n) && (n===6 || n===24 || n===72) ? n : 24;
  });

  useEffect(()=>{
    localStorage.setItem("idleclans_compare_players_v1", JSON.stringify(selected));
  }, [selected]);

  useEffect(()=>{
    localStorage.setItem("idleclans_compare_windowDays_v1", String(windowDays));
  }, [windowDays]);

  useEffect(()=>{
    localStorage.setItem("idleclans_compare_minQty_v1", String(minQty));
  }, [minQty]);

  useEffect(()=>{
    localStorage.setItem("idleclans_compare_muleSpanHours_v1", String(muleSpanHours));
  }, [muleSpanHours]);

  async function refreshSuggestions(q){
    const s = String(q||"").trim();
    if (!s){
      setSuggestions([]);
      return;
    }
    try{
      const list = await window.idleclans.listPlayers(s);
      setSuggestions((list?.rows||list||[]).slice(0,8));
    }catch{
      setSuggestions([]);
    }
  }

  useEffect(()=>{
    const t = setTimeout(()=>refreshSuggestions(query), 150);
    return ()=>clearTimeout(t);
  }, [query]);

  async function loadOne(name, { forceScan = false } = {}){
    const nm = String(name||"").trim();
    if (!nm) return;
    setRowsByName(prev=>({ ...prev, [nm]: { ...(prev[nm]||{}), loading: true, error: null } }));
    try{
      if (forceScan){
        await window.idleclans.refreshPlayer(nm);
        await window.idleclans.fetchPlayerLogs(nm);
      }
      let p = await window.idleclans.getPlayer(nm);
      if (!p){
        // try a scan once if missing
        await window.idleclans.refreshPlayer(nm);
        await window.idleclans.fetchPlayerLogs(nm);
        p = await window.idleclans.getPlayer(nm);
      }
      const logs = await window.idleclans.getLogsDetailed("player", nm, { limit: 2000 });
      setRowsByName(prev=>({ ...prev, [nm]: { player: p, logs: logs||[], loading:false, error: null } }));
    }catch(err){
      setRowsByName(prev=>({ ...prev, [nm]: { ...(prev[nm]||{}), loading:false, error: String(err?.message || err || "Failed to fetch") } }));
    }
  }

  useEffect(()=>{
    // load any existing players on first render
    (async()=>{
      for (const n of selected){
        if (!rowsByName[n]) await loadOne(n);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPlayer(n){
    const name = String(n || query || "").trim();
    if (!name) return;
    if (selected.some(x=>String(x).toLowerCase()===name.toLowerCase())){
      setQuery("");
      setSuggestions([]);
      return;
    }
    setSelected(prev=>[...prev, name]);
    setQuery("");
    setSuggestions([]);
    await loadOne(name);
  }

  function removePlayer(name){
    setSelected(prev=>prev.filter(x=>String(x).toLowerCase()!==String(name).toLowerCase()));
    setRowsByName(prev=>{
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  }

  async function reloadAll(){
    if (!selected.length) return;
    setBusyAll(true);
    try{
      for (const n of selected){
        await loadOne(n, { forceScan: true });
      }
    } finally {
      setBusyAll(false);
    }
  }

  const players = useMemo(()=>{
    return selected.map(name=>({
      name,
      ...((rowsByName[name]||{})),
    }));
  }, [selected, rowsByName]);

  const skillsMatrix = useMemo(()=>{
    const cols = players.map(p=>p.name);
    const rows = SKILL_ORDER.map(skill=>{
      const values = {};
      for (const p of players){
        const xp = p?.player?.skillExperiences?.[skill];
        values[p.name] = xp;
      }
      return { skill, values };
    });
    return { cols, rows };
  }, [players]);

  const equipMatrix = useMemo(()=>{
    const cols = players.map(p=>p.name);
    const rows = EQUIP_ORDER.map(slot=>{
      const values = {};
      for (const p of players){
        const eq = p?.player?.equipment || {};
        values[p.name] = eq[slot] ?? eq[slot?.toUpperCase?.()] ?? eq[slot?.toLowerCase?.()];
      }
      return { slot, values };
    });
    return { cols, rows };
  }, [players]);

  const namePairs = useMemo(()=>{
    const out = [];
    for (let i=0;i<players.length;i++){
      for (let j=i+1;j<players.length;j++){
        const a = players[i], b = players[j];
        const sim = nameSimilarity(a.name, b.name);
        const clanA = a?.player?.guildName || null;
        const clanB = b?.player?.guildName || null;
        const sameClan = clanA && clanB && String(clanA).toLowerCase()===String(clanB).toLowerCase();
        const hA = Number(a?.player?.hoursOffline);
        const hB = Number(b?.player?.hoursOffline);
        let gapHours = null;
        if (isFinite(hA) && isFinite(hB)) gapHours = Math.abs(hA-hB);
        out.push({
          a: a.name, b: b.name,
          sim,
          sameClan,
          clan: sameClan ? clanA : null,
          gapHours,
        });
      }
    }
    out.sort((x,y)=> y.sim - x.sim);
    return out;
  }, [players]);

  const vaultFindings = useMemo(()=>{
    const cutoff = Date.now() - (Number(windowDays)||0)*24*3600*1000;
    const clans = new Map(); // clanLower -> {clanName, events:[]}

    for (const p of players){
      const pName = p.name;
      const logs = Array.isArray(p.logs) ? p.logs : [];
      for (const row of logs){
        const ts = toTs(row.timestamp);
        if (!ts || ts < cutoff) continue;

        let raw = null;
        try{ raw = row.rawJson ? JSON.parse(row.rawJson) : null; }catch{}
        const msg = raw?.message || row.message;
        const ev = parseVaultEvent(msg);
        if (!ev) continue;

        const clanName = raw?.clanName || raw?.guildName || p?.player?.guildName || null;
        if (!clanName) continue;

        // Strict same-clan rule: only count if this player's current clan matches the log clan (when available)
        const currentClan = p?.player?.guildName || null;
        if (currentClan && String(currentClan).toLowerCase() !== String(clanName).toLowerCase()){
          continue;
        }

        const member = raw?.memberUsername || pName;

        const key = String(clanName).toLowerCase();
        if (!clans.has(key)) clans.set(key, { clanName, events: [] });
        clans.get(key).events.push({
          clanName,
          clanLower: key,
          player: member,
          type: ev.type,
          qty: ev.qty,
          item: ev.item,
          ts,
          tsIso: row.timestamp,
          message: msg,
        });
      }
    }

    const findings = [];

    for (const [,c] of clans){
      const events = c.events.sort((a,b)=>a.ts-b.ts);
      const byPlayer = new Map();
      for (const e of events){
        const pl = String(e.player);
        if (!byPlayer.has(pl)) byPlayer.set(pl, { addedQty:0, withdrewQty:0, addedEvents:0, withdrewEvents:0, addedItems: new Map(), withdrewItems: new Map(), addedItemEvents: new Map(), withdrewItemEvents: new Map() });
        const st = byPlayer.get(pl);
        if (e.type === "added"){ st.addedQty += e.qty; st.addedEvents += 1; }
        else { st.withdrewQty += e.qty; st.withdrewEvents += 1; }
        const itemKey = e.item;
        if (e.type === "added"){
          st.addedItems.set(itemKey, (st.addedItems.get(itemKey)||0) + e.qty);
          st.addedItemEvents.set(itemKey, (st.addedItemEvents.get(itemKey)||0) + 1);
        } else {
          st.withdrewItems.set(itemKey, (st.withdrewItems.get(itemKey)||0) + e.qty);
          st.withdrewItemEvents.set(itemKey, (st.withdrewItemEvents.get(itemKey)||0) + 1);
        }
}

      const depositors = [...byPlayer.entries()].filter(([_,s])=>s.addedEvents>0);
      const withdrawers = [...byPlayer.entries()].filter(([_,s])=>s.withdrewEvents>0);

      const totalAdded = depositors.reduce((a,[,s])=>a+s.addedQty,0);
      const totalWithdrew = withdrawers.reduce((a,[,s])=>a+s.withdrewQty,0);

      const topW = withdrawers.sort((a,b)=>b[1].withdrewQty - a[1].withdrewQty)[0] || null;
      const topWName = topW?.[0] || null;
      const topWQty = topW?.[1]?.withdrewQty || 0;
      const topWithdrawerShare = totalWithdrew>0 ? topWQty/totalWithdrew : 0;

      // Detect "large movements"
      const hasLargeAdd = events.some(e=>e.type==="added" && e.qty>=minQty);
      const hasLargeWithdrew = events.some(e=>e.type==="withdrew" && e.qty>=minQty);

      // --- FLAG LOGIC ---
      // Original signal: multiple depositors, one dominant withdrawer.
      const flagMultiDepositor =
        depositors.length >= 2 &&
        totalWithdrew >= minQty &&
        (hasLargeAdd || totalAdded >= minQty) &&
        (hasLargeWithdrew || totalWithdrew >= minQty) &&
        topWithdrawerShare >= 0.7 &&
        topWQty >= minQty;

      // NEW: 1-to-1 high-volume transfer — one player deposits, one different player
      // withdraws, and the withdrawn qty is substantial. Catches single-alt feeding a main.
      const flag1to1 = (() => {
        if (depositors.length !== 1 || withdrawers.length !== 1) return false;
        const depName = depositors[0]?.[0];
        const witName = withdrawers[0]?.[0];
        if (!depName || !witName || depName === witName) return false;
        return totalAdded >= minQty && totalWithdrew >= minQty;
      })();

      // NEW: many-to-one — any number of depositors (≥1), one dominant withdrawer
      // taking ≥60% of all withdrawals. Catches multi-alt feeding a main even when
      // the depositor count is 1 (covers the gap in the original ≥2 check).
      const flagManyToOne =
        depositors.length >= 1 &&
        withdrawers.length >= 1 &&
        totalWithdrew >= minQty &&
        totalAdded >= minQty &&
        topWithdrawerShare >= 0.6 &&
        topWQty >= minQty &&
        // Ensure the top withdrawer is NOT the top depositor (would be normal play)
        depositors[0]?.[0] !== topWName;

      const flag = flagMultiDepositor || flag1to1 || flagManyToOne;

      // Derive a human-readable signal label for display
      const flagReason = flag
        ? (flag1to1
            ? "1-to-1 transfer"
            : (flagMultiDepositor
                ? "Dominant withdrawer (multi-depositor)"
                : "Dominant withdrawer"))
        : null;

      // Build summaries: top depositors/withdrawers and top moved items
      const topDepositors = depositors
        .sort((a,b)=>b[1].addedQty - a[1].addedQty)
        .slice(0, 6)
        .map(([name, s])=>{
          const topEntry = [...(s.addedItems||new Map()).entries()].sort((a,b)=>b[1]-a[1])[0];
          const topItem = topEntry?.[0] || null;
          const topItemQty = topItem ? (s.addedItems.get(topItem)||0) : 0;
          const topItemEvents = topItem ? (s.addedItemEvents.get(topItem)||0) : 0;
          return ({ name, qty: s.addedQty, events: s.addedEvents, topItem, topItemQty, topItemEvents });
        });

      const topWithdrawers = withdrawers
        .sort((a,b)=>b[1].withdrewQty - a[1].withdrewQty)
        .slice(0, 6)
        .map(([name, s])=>{
          const topEntry = [...(s.withdrewItems||new Map()).entries()].sort((a,b)=>b[1]-a[1])[0];
          const topItem = topEntry?.[0] || null;
          const topItemQty = topItem ? (s.withdrewItems.get(topItem)||0) : 0;
          const topItemEvents = topItem ? (s.withdrewItemEvents.get(topItem)||0) : 0;
          return ({ name, qty: s.withdrewQty, events: s.withdrewEvents, topItem, topItemQty, topItemEvents });
        });

      const memberFlows = [...byPlayer.entries()]
        .map(([name, s])=>{
          const added = Number(s.addedQty)||0;
          const withdrew = Number(s.withdrewQty)||0;
          return {
            name,
            added,
            withdrew,
            net: added - withdrew,
            withdrawShare: totalWithdrew > 0 ? withdrew / totalWithdrew : 0,
            depositShare: totalAdded > 0 ? added / totalAdded : 0,
          };
        })
        .sort((a,b)=> (b.withdrew - a.withdrew) || (b.added - a.added));

      // Item totals (so users can immediately see what moved)
      const byItem = new Map(); // item -> {addedQty, withdrewQty, addedEvents, withdrewEvents}
      for (const e of events){
        if (!byItem.has(e.item)) byItem.set(e.item, { addedQty:0, withdrewQty:0, addedEvents:0, withdrewEvents:0 });
        const st = byItem.get(e.item);
        if (e.type === "added"){
          st.addedQty += e.qty;
          st.addedEvents += 1;
        } else {
          st.withdrewQty += e.qty;
          st.withdrewEvents += 1;
        }
      }

      
      const topActorForItem = (item, which)=>{
        let bestName = null;
        let bestQty = 0;
        let bestEvents = 0;
        for (const [name, st] of byPlayer.entries()){
          const qty = which==="added" ? (st.addedItems.get(item)||0) : (st.withdrewItems.get(item)||0);
          if (!qty) continue;
          const ev = which==="added" ? (st.addedItemEvents.get(item)||0) : (st.withdrewItemEvents.get(item)||0);
          if (qty > bestQty){
            bestQty = qty;
            bestName = name;
            bestEvents = ev;
          }
        }
        return { name: bestName, qty: bestQty, events: bestEvents };
      };
const topAddedItems = [...byItem.entries()]
        .map(([item, s])=>{
          const top = topActorForItem(item, "added");
          return ({ item, qty: s.addedQty, events: s.addedEvents, topName: top.name, topQty: top.qty, topEvents: top.events });
        })
        .filter(x=>x.qty>0)
        .sort((a,b)=>b.qty-a.qty)
        .slice(0, 8);

      const topWithdrewItems = [...byItem.entries()]
        .map(([item, s])=>{
          const top = topActorForItem(item, "withdrew");
          return ({ item, qty: s.withdrewQty, events: s.withdrewEvents, topName: top.name, topQty: top.qty, topEvents: top.events });
        })
        .filter(x=>x.qty>0)
        .sort((a,b)=>b.qty-a.qty)
        .slice(0, 8);

      const evidenceSequences = [];
      if (flag && topWName){
        // For each item, look for deposit burst then withdraw burst by top withdrawer within 24h.
        const byItemForEvidence = new Map();
        for (const e of events){
          const k = e.item;
          if (!byItemForEvidence.has(k)) byItemForEvidence.set(k, []);
          byItemForEvidence.get(k).push(e);
        }
        for (const [item, arr] of byItemForEvidence){
          // rolling window
          let i=0;
          while (i < arr.length){
            // find a deposit burst start
            if (arr[i].type !== "added"){ i++; continue; }
            const startTs = arr[i].ts;
            let j=i, depSum=0;
            while (j < arr.length && arr[j].type==="added" && (arr[j].ts - startTs) <= 6*3600*1000){
              depSum += arr[j].qty;
              j++;
            }
            if (depSum >= minQty){
              // search for withdraws by top withdrawer within 24h after end of burst
              const endTs = arr[j-1].ts;
              let k=j, wSum=0, firstW=null, lastW=null;
              while (k < arr.length && (arr[k].ts - endTs) <= 24*3600*1000){
                if (arr[k].type==="withdrew" && String(arr[k].player).toLowerCase()===String(topWName).toLowerCase()){
                  wSum += arr[k].qty;
                  firstW = firstW || arr[k];
                  lastW = arr[k];
                }
                k++;
              }
              if (wSum >= minQty){
                evidenceSequences.push({
                  item,
                  deposits: depSum,
                  withdrawals: wSum,
                  depositStart: arr[i].tsIso,
                  withdrawStart: firstW?.tsIso,
                  withdrawEnd: lastW?.tsIso,
                });
              }
            }
            i = j;
          }
        }
      }

      // Mule-movement signals: deposits by one/many players followed by withdrawals by a
      // different player within a short span (default 24h) OR a very large withdrawal
      // shortly after deposits. Also detects slow drip-deposit patterns where many small
      // deposits from multiple accounts accumulate before a single large withdrawal.
      const muleMoves = [];
      const muleSpanMs = (Number(muleSpanHours)||24) * 3600 * 1000;

      // Group events by item (already chronological in `events`)
      const byItemForMule = new Map();
      for (const e of events){
        const k = e.item;
        if (!byItemForMule.has(k)) byItemForMule.set(k, []);
        byItemForMule.get(k).push(e);
      }

      for (const [item, arr] of byItemForMule){
        // Rolling window of deposits (added) in the last muleSpanMs
        const depWindow = [];
        let depWindowStartIdx = 0;

        for (let idxEv = 0; idxEv < arr.length; idxEv++){
          const ev = arr[idxEv];

          if (ev.type === "added"){
            depWindow.push(ev);
          }

          // Evict deposits older than the span
          const cutoffTs = ev.ts - muleSpanMs;
          while (depWindowStartIdx < depWindow.length && depWindow[depWindowStartIdx].ts < cutoffTs){
            depWindowStartIdx++;
          }

          if (ev.type !== "withdrew") continue;

          // Sum deposits by OTHER players in the window (catches multi-alt feeding)
          const byDep = new Map();
          let depSumOther = 0;
          let oldestTs = null;
          let uniqueDepositors = 0;

          for (let k = depWindowStartIdx; k < depWindow.length; k++){
            const d = depWindow[k];
            if (String(d.player).toLowerCase() === String(ev.player).toLowerCase()) continue;
            if (!byDep.has(d.player)) uniqueDepositors++;
            depSumOther += d.qty;
            if (oldestTs == null || d.ts < oldestTs) oldestTs = d.ts;
            byDep.set(d.player, (byDep.get(d.player) || 0) + d.qty);
          }

          if (!oldestTs) continue;

          const bigWithdrawal = ev.qty >= (minQty * 2);
          const enoughDeposits = depSumOther >= minQty;
          const someDeposits = depSumOther >= Math.max(1, Math.floor(minQty * 0.25));

          // Trigger conditions:
          // 1. Normal: large deposits + large withdrawal within span by different player
          // 2. Big-withdrawal: very large withdrawal with at least some recent deposits by others
          // 3. Multi-account: 2+ unique depositors contributing to one withdrawer (even small qty each)
          const multiAccountFeed = uniqueDepositors >= 2 && depSumOther >= Math.floor(minQty * 0.5) && ev.qty >= Math.floor(minQty * 0.5);
          if (!((enoughDeposits && ev.qty >= minQty) || (bigWithdrawal && someDeposits) || multiAccountFeed)) continue;

          const topDep = [...byDep.entries()].sort((a,b)=>b[1]-a[1])[0] || null;
          const depositor = topDep ? topDep[0] : "(multiple)";
          const depositorQty = topDep ? topDep[1] : depSumOther;

          muleMoves.push({
            depositor,
            depositorQty,
            depositorShare: depSumOther > 0 ? depositorQty / depSumOther : 0,
            depositorsInvolved: byDep.size,
            uniqueDepositors,
            withdrawer: String(ev.player),
            item,
            deposited: depSumOther,
            withdrawn: ev.qty,
            depositStart: new Date(oldestTs).toISOString(),
            withdrawAt: ev.tsIso,
            deltaMs: ev.ts - oldestTs,
          });
        }
      }

      muleMoves.sort((a,b)=> (b.withdrawn - a.withdrawn) || (a.deltaMs - b.deltaMs));



      findings.push({
        clanName: c.clanName,
        eligiblePlayers: players.filter(p=>String(p?.player?.guildName||"").toLowerCase()===String(c.clanName).toLowerCase()).map(p=>p.name),
        totalAdded,
        totalWithdrew,
        depositors: depositors.length,
        withdrawers: withdrawers.length,
        topWithdrawer: topWName,
        topWithdrawerQty: topWQty,
        topWithdrawerShare,
        topDepositors,
        topWithdrawers,
        topAddedItems,
        topWithdrewItems,
        flag,
        flagReason,
        memberFlows,
        evidenceSequences: evidenceSequences.slice(0, 10),
        muleMoves: muleMoves.slice(0, 12),
      });
    }

    // Only show clans where we actually have any vault events among selected players
    return findings
      .filter(f=> (f.depositors + f.withdrawers) > 0)
      .sort((a,b)=>{
        // flagged first, then by share/qty
        if (a.flag !== b.flag) return a.flag ? -1 : 1;
        return (b.topWithdrawerQty||0) - (a.topWithdrawerQty||0);
      });
  }, [players, windowDays, minQty, muleSpanHours]);

  // Vault totals (for reports): per clan, compute per-player totals and top moved items
  const vaultTotalsByClan = useMemo(()=>{
    const cutoff = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
    // Build events by clan from vault logs (same source as vaultFindings)
    const clans = [];
    const seen = new Set();
    for (const p of players){
      const c = p?.player?.guildName;
      if (!c) continue;
      const key = String(c).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clans.push({ clanName: String(c) });
    }

    const out = [];
    for (const c of clans){
      const byPlayer = new Map(); // player -> {addedQty, withdrewQty}
      const byItem = new Map();   // item -> {addedQty, withdrewQty}
      let any = false;

      for (const p of players){
        const clan = p?.player?.guildName;
        if (!clan || String(clan).toLowerCase() !== String(c.clanName).toLowerCase()) continue;

        const logs = Array.isArray(p.logs) ? p.logs : [];
        for (const row of logs){
          if (!row || row.type !== "vault") continue;
          const ts = Number(row.ts);
          if (isFinite(ts) && ts < cutoff) continue;

          let raw = null;
          try{ raw = row.rawJson ? JSON.parse(row.rawJson) : null; }catch{}
          if (!raw) continue;

          // Expected fields: raw.vaultEventType, raw.amount, raw.itemName
          const t = String(raw.vaultEventType || row.vaultEventType || "").toLowerCase();
          const type = (t === "added" || t === "withdrew") ? t : null;
          if (!type) continue;

          const qty = Number(raw.amount ?? row.amount);
          if (!isFinite(qty)) continue;

          const itemName = String(raw.itemName ?? row.itemName ?? "Unknown");
          any = true;

          if (!byPlayer.has(p.name)) byPlayer.set(p.name, { addedQty:0, withdrewQty:0 });
          const ps = byPlayer.get(p.name);
          if (type === "added") ps.addedQty += qty;
          else ps.withdrewQty += qty;

          if (!byItem.has(itemName)) byItem.set(itemName, { addedQty:0, withdrewQty:0 });
          const it = byItem.get(itemName);
          if (type === "added") it.addedQty += qty;
          else it.withdrewQty += qty;
        }
      }

      if (!any) continue;

      const playerTotals = [...byPlayer.entries()].map(([player, s])=>({
        player,
        addedQty: s.addedQty,
        withdrewQty: s.withdrewQty,
        netQty: s.addedQty - s.withdrewQty,
      })).sort((a,b)=>(b.withdrewQty + b.addedQty) - (a.withdrewQty + a.addedQty));

      const topItems = [...byItem.entries()].map(([item, s])=>({
        item,
        addedQty: s.addedQty,
        withdrewQty: s.withdrewQty,
        movedQty: s.addedQty + s.withdrewQty,
      })).sort((a,b)=>b.movedQty - a.movedQty).slice(0, 15);

      out.push({ clanName: c.clanName, playerTotals, topItems });
    }
    return out;
  }, [players, windowDays, minQty, muleSpanHours]);

  const compareSnapshot = useMemo(()=>({
    settings: { windowDays, minQty, muleSpanHours },
    players: players.map(p=>({
      name: p.name,
      gameMode: p?.player?.gameMode || null,
      clan: p?.player?.guildName || null,
      hoursOffline: p?.player?.hoursOffline ?? null,
      logCount: Array.isArray(p.logs) ? p.logs.length : null,
    })),
    namePairs: namePairs.slice(0, 30),
    vaultFindings: vaultFindings.slice(0, 20),
    vaultTotalsByClan: vaultTotalsByClan || [],
  }), [players, windowDays, minQty, namePairs, vaultFindings, vaultTotalsByClan]);

  const compareScore = useMemo(()=>scoreFromCompareSnapshot(compareSnapshot), [compareSnapshot]);



  async function openCaseModal(){
    setCaseOpen(true);
    setCaseBusy(true);
    try{
      const list = await window.idleclans.listCases();
      setCaseList(Array.isArray(list) ? list : []);
    } catch{
      setCaseList([]);
    } finally{
      setCaseBusy(false);
    }
  }

  async function saveToCase(){
    if (!selected.length) return;
    setCaseBusy(true);
    try{
      let id = caseId ? Number(caseId) : null;
      if (!id && caseNewTitle.trim()){
        const created = await window.idleclans.createCase(caseNewTitle.trim());
        id = created?.caseId || null;
      }
      if (!id) return;

      // Attach selected players (and any current clans referenced)
      for (const p of players){
        await window.idleclans.attachCaseEntity(id, "player", p.name);
        const c = p?.player?.guildName;
        if (c) await window.idleclans.attachCaseEntity(id, "clan", String(c));
      }

      if (caseNote.trim()){
        await window.idleclans.addCaseNote(id, caseNote.trim());
      }

      const snapshot = {
        ...compareSnapshot,
        score: compareScore,
      };

      const title = `Compare snapshot (${players.length} players)`;
      await window.idleclans.addCaseSnapshot(id, "compare", title, snapshot);

      setCaseOpen(false);
      setCaseId(String(id));
      setCaseNewTitle("");
      setCaseNote("");
    } finally{
      setCaseBusy(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}> 
      <HowToUse />

      {/* ── Add player bar ─────────────────────────────────────────────── */}
      <div className="card" style={{ overflow:"visible" }}>
        <div className="cardHeader" style={{ justifyContent:"space-between" }}>
          <div className="cardTitle">Player Compare</div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <Tooltip text={"Re-fetches live data for all added players."}>
              <button className="btn" onClick={reloadAll} disabled={busyAll||selected.length===0}>
                {busyAll?"Reloading…":"Refresh all"}
              </button>
            </Tooltip>
            <Tooltip text={"Save this comparison as an investigation case."}>
              <button className="btn btnPrimary" onClick={openCaseModal} disabled={selected.length===0}>
                Save to case
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="cardBody">
          {/* Search input */}
          <div style={{ position:"relative", display:"flex", gap:8 }}>
            <div style={{ flex:1, position:"relative" }}>
              <input className="input" style={{ width:"100%" }}
                placeholder="Search for a player to add…"
                value={query}
                onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") addPlayer(); }}
              />
              {suggestions.length>0 && (
                <div style={{
                  position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:200,
                  background:"rgba(6,22,14,0.98)", border:"1px solid rgba(255,255,255,0.14)",
                  borderRadius:10, overflow:"hidden", boxShadow:"0 12px 32px rgba(0,0,0,0.5)",
                }}>
                  {suggestions.map(s=>(
                    <div key={s.username}
                      onMouseDown={()=>addPlayer(s.username)}
                      style={{ padding:"10px 14px", cursor:"pointer", fontSize:13,
                        borderBottom:"1px solid rgba(255,255,255,0.05)" }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{ fontWeight:700, display:"flex", gap:8, alignItems:"center" }}>
                        <span>{s.username}</span>
                        {s.bannedAt && <span style={{ fontSize:11, fontWeight:700, padding:"1px 6px", borderRadius:4, background:"rgba(var(--danger-rgb),0.15)", color:"var(--danger)" }}>BANNED</span>}
                      </div>
                      <div style={{ fontSize:12, opacity:0.5 }}>{modeLabel(s.gameMode)} · {s.guildName||"No clan"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn" onClick={()=>addPlayer()} disabled={!String(query||"").trim()}>Add</button>
          </div>

          {/* Player chips */}
          {selected.length>0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:10 }}>
              {players.map(p=>(
                <div key={p.name} style={{
                  display:"flex", alignItems:"center", gap:6,
                  padding:"4px 10px", borderRadius:8,
                  background: p.loading ? "rgba(255,255,255,0.04)"
                    : p.error ? "rgba(var(--danger-rgb),0.1)"
                    : p?.player?.bannedAt ? "rgba(var(--danger-rgb),0.1)"
                    : "rgba(255,255,255,0.07)",
                  border: p.error ? "1px solid rgba(var(--danger-rgb),0.3)"
                    : p?.player?.bannedAt ? "1px solid rgba(var(--danger-rgb),0.3)"
                    : "1px solid rgba(255,255,255,0.1)",
                  fontSize:13, fontWeight:600,
                }}>
                  {p.loading && <span style={{ opacity:0.4, fontSize:11 }}>⟳</span>}
                  <span>{p.name}</span>
                  {p?.player?.guildName && <span style={{ opacity:0.45, fontSize:12 }}>· {p.player.guildName}</span>}
                  {p?.player?.bannedAt  && <span style={{ fontSize:11, color:"var(--danger)" }}>BANNED</span>}
                  {p.error && <span style={{ fontSize:11, color:"var(--danger)" }} title={p.error}>⚠</span>}
                  <button onClick={()=>loadOne(p.name,{forceScan:true})} disabled={!!p.loading}
                    style={{ background:"none", border:"none", cursor:"pointer", opacity:0.45, fontSize:12, padding:"0 2px" }} title="Refresh">⟳</button>
                  <button onClick={()=>removePlayer(p.name)}
                    style={{ background:"none", border:"none", cursor:"pointer", opacity:0.45, fontSize:14, padding:"0 2px" }} title="Remove">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Save to case modal ─────────────────────────────────────────── */}
      {caseOpen && (
        <div className="modalBackdrop" onMouseDown={()=>setCaseOpen(false)}>
          <div className="modal" onMouseDown={e=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ fontWeight:800, fontSize:17 }}>Save Compare Snapshot</div>
              <button className="btn" style={{ fontSize:16, padding:"0 8px" }} onClick={()=>setCaseOpen(false)}>×</button>
            </div>
            <div style={{ fontSize:13, opacity:0.5, marginBottom:16 }}>
              Captures vault findings, name similarity, and compare settings into a case.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Choose existing case</div>
                <select className="select" style={{ width:"100%" }} value={caseId} onChange={e=>setCaseId(e.target.value)}>
                  <option value="">— Select —</option>
                  {(caseList||[]).map(c=>(
                    <option key={c.id} value={String(c.id)}>{c.title} ({c.status})</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Or create new case</div>
                <input className="input" style={{ width:"100%" }} value={caseNewTitle}
                  onChange={e=>setCaseNewTitle(e.target.value)} placeholder="New case title…" />
              </div>
              <div>
                <div style={{ fontSize:12, opacity:0.5, marginBottom:4 }}>Optional note</div>
                <input className="input" style={{ width:"100%" }} value={caseNote}
                  onChange={e=>setCaseNote(e.target.value)} placeholder="e.g. suspected mule vault funnel" />
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:16 }}>
              <button className="btn" onClick={()=>setCaseOpen(false)} disabled={caseBusy}>Cancel</button>
              <button className="btn btnPrimary" onClick={saveToCase}
                disabled={caseBusy||(!caseId&&!caseNewTitle.trim())}>
                {caseBusy?"Saving…":"Save snapshot"}
              </button>
            </div>
          </div>
        </div>
      )}

      {players.length===0 && (
        <div style={{
          textAlign:"center", padding:"48px 24px",
          border:"1px dashed rgba(255,255,255,0.1)", borderRadius:14,
          background:"rgba(255,255,255,0.01)",
        }}>
          <div style={{ fontSize:32, marginBottom:12, opacity:0.2 }}>⚖</div>
          <div style={{ fontSize:14, fontWeight:700, opacity:0.5, marginBottom:6 }}>No players added yet</div>
          <div style={{ fontSize:12, opacity:0.3, maxWidth:340, margin:"0 auto", lineHeight:1.65 }}>
            Search for a player above to begin. Add two or more accounts to compare skills, equipment, and vault activity — useful for spotting alt accounts or mule activity.
          </div>
        </div>
      )}

      {/* ── Results summary bar ──────────────────────────────────────────── */}
      {players.length>0 && players.some(p=>p.player) && (() => {
        const loaded = players.filter(p=>p.player).length;
        const flaggedClans = vaultFindings.filter(f=>f.flag).length;
        const highSim = namePairs.filter(p=>p.sim>=0.9).length;
        const score = compareScore.groupScore ?? 0;
        const banned = players.filter(p=>p?.player?.bannedAt).length;
        return (
          <div style={{
            display:"flex", gap:8, flexWrap:"wrap", alignItems:"center",
            padding:"10px 14px", borderRadius:10,
            background: score>=50 ? "rgba(var(--danger-rgb),0.06)" : score>=25 ? "rgba(var(--warning-rgb),0.05)" : "rgba(var(--success-rgb),0.04)",
            border: score>=50 ? "1px solid rgba(var(--danger-rgb),0.2)" : score>=25 ? "1px solid rgba(var(--warning-rgb),0.18)" : "1px solid rgba(var(--success-rgb),0.15)",
            fontSize:12,
          }}>
            <span style={{ fontWeight:700, opacity:0.7 }}>Summary:</span>
            <span style={{ opacity:0.6 }}>{loaded} of {players.length} player{players.length!==1?"s":""} loaded</span>
            {banned>0 && <span style={{ color:"var(--danger)", fontWeight:700 }}>· {banned} banned</span>}
            {flaggedClans>0
              ? <span style={{ color:"var(--danger)", fontWeight:700 }}>· {flaggedClans} clan{flaggedClans!==1?"s":""} flagged ⚠</span>
              : vaultFindings.length>0 && <span style={{ color:"var(--success)", opacity:0.8 }}>· No vault flags</span>}
            {highSim>0 && <span style={{ color:"var(--warning)", fontWeight:700 }}>· {highSim} high-similarity name pair{highSim!==1?"s":""}</span>}
            {score>0 && <span style={{ fontWeight:700, color: score>=50?"var(--danger)":score>=25?"var(--warning)":"var(--success)" }}>· Suspicion score: {score}/100</span>}
          </div>
        );
      })()}

      {/* ── Player summary cards ───────────────────────────────────────── */}
      {players.length>0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
          {players.map(p=>(
            <div key={p.name} style={{
              background: p?.player?.bannedAt ? "rgba(var(--danger-rgb),0.06)" : "rgba(255,255,255,0.02)",
              border: p?.player?.bannedAt ? "1px solid rgba(var(--danger-rgb),0.25)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius:12, padding:"12px 14px",
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{p.name}</div>
                  {p?.player?.bannedAt && (
                    <div style={{ fontSize:11, color:"var(--danger)", marginTop:2 }}>BANNED</div>
                  )}
                </div>
                <div style={{ display:"flex", gap:4 }}>
                  <button onClick={()=>loadOne(p.name,{forceScan:true})} disabled={!!p.loading}
                    style={{ background:"none", border:"none", cursor:"pointer", opacity:0.45, fontSize:14, padding:"2px 4px" }} title="Refresh">⟳</button>
                  <button onClick={()=>removePlayer(p.name)}
                    style={{ background:"none", border:"none", cursor:"pointer", opacity:0.45, fontSize:16, padding:"2px 4px" }} title="Remove">×</button>
                </div>
              </div>
              {p.error && <div style={{ fontSize:12, color:"var(--danger)", marginBottom:8 }}>{p.error}</div>}
              {p.loading && <div style={{ fontSize:12, opacity:0.4 }}>Loading…</div>}
              {p.player && (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"3px 0" }}>
                    <span style={{ opacity:0.5 }}>Clan</span>
                    <span style={{ fontWeight:600 }}>{p.player.guildName||"—"}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"3px 0" }}>
                    <span style={{ opacity:0.5 }}>Mode</span>
                    <span style={{ fontWeight:600 }}>{modeLabel(p.player.gameMode)}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"3px 0" }}>
                    <span style={{ opacity:0.5 }}>Last seen</span>
                    <span style={{ fontWeight:600 }}>{fmtAgoFromHoursOffline(p.player.hoursOffline)}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"3px 0" }}>
                    <span style={{ opacity:0.5 }}>Log entries</span>
                    <span style={{ fontWeight:600 }}>{Array.isArray(p.logs)?p.logs.length.toLocaleString():0}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Suspicion score summary ────────────────────────────────────── */}
      {players.length>0 && (compareScore.groupScore>0 || Object.keys(compareScore.perPlayer||{}).length>0) && (
        <div className="card">
          <div className="cardHeader" style={{ justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="cardTitle">Suspicion Score</div>
              <InfoIcon tip={"0–100 composite score across all players.\n🟢 0–24 = Low  🟡 25–49 = Medium  🔴 50+ = High"} />
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              {/* Legend */}
              <div style={{ display:"flex", gap:10, fontSize:11 }}>
                {[["var(--success)","Low"],["var(--warning)","Medium"],["var(--danger)","High"]].map(([col,label])=>(
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:4, opacity:0.6 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:col }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:28, fontWeight:900,
                color: compareScore.groupScore>=50 ? "var(--danger)" : compareScore.groupScore>=25 ? "var(--warning)" : "var(--success)" }}>
                {compareScore.groupScore??0}<span style={{ fontSize:14, opacity:0.4 }}>/100</span>
              </div>
            </div>
          </div>
          <div className="cardBody">
            {compareScore.groupReasons?.length>0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>
                  Group signals
                  <span style={{ marginLeft:6, fontWeight:400, textTransform:"none", fontSize:11 }}>— behaviours detected across the group as a whole</span>
                </div>
                <ul style={{ margin:0, paddingLeft:16, display:"flex", flexDirection:"column", gap:3 }}>
                  {compareScore.groupReasons.slice(0,8).map((r,i)=>(
                    <li key={i} style={{ fontSize:13, opacity:0.75 }}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {Object.keys(compareScore.perPlayer||{}).length>0 && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                  Per player
                  <span style={{ marginLeft:6, fontWeight:400, textTransform:"none", fontSize:11 }}>— individual signals for each account</span>
                </div>
                {Object.entries(compareScore.perPlayer)
                  .sort((a,b)=>(b[1]?.score||0)-(a[1]?.score||0))
                  .map(([nm,v])=>{
                    const pct = Math.min(100, v?.score||0);
                    return (
                      <div key={nm} style={{ marginBottom:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
                          <span style={{ fontWeight:700 }}>{nm}</span>
                          <span style={{ fontWeight:700, color: pct>=50?"var(--danger)":pct>=25?"var(--warning)":"rgba(255,255,255,0.6)" }}>{pct}/100</span>
                        </div>
                        <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden", marginBottom:5 }}>
                          <div style={{ width:`${pct}%`, height:"100%", borderRadius:999, background: pct>=50?"var(--danger)":pct>=25?"var(--warning)":"var(--success)", transition:"width 0.3s" }} />
                        </div>
                        {v?.reasons?.length>0 && (
                          <div style={{ fontSize:11, opacity:0.5 }}>{v.reasons.slice(0,3).join(" · ")}</div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Name similarity ────────────────────────────────────────────── */}
      {players.length>1 && namePairs.length>0 && (
        <div className="card">
          <div className="cardHeader">
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="cardTitle">Name Similarity</div>
              <InfoIcon tip={"Compares usernames across all added players.\n90%+ = likely same person · 80–89% = suspicious"} />
            </div>
            <div style={{ display:"flex", gap:10, fontSize:11, alignItems:"center" }}>
              {[["var(--danger)","90%+ Very high"],["var(--warning)","80%+ Suspicious"],["rgba(255,255,255,0.35)","Below 80%"]].map(([col,label])=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:4, opacity:0.7 }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:col }} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="cardBody">
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {namePairs.slice(0,30).map((pair,idx)=>{
                const pct = Math.round(pair.sim*100);
                return (
                  <div key={idx} style={{
                    display:"flex", alignItems:"center", gap:12,
                    padding:"8px 10px", borderRadius:8,
                    background: pair.sameClan ? "rgba(var(--warning-rgb),0.06)" : "rgba(255,255,255,0.02)",
                    border: pair.sameClan ? "1px solid rgba(var(--warning-rgb),0.2)" : "1px solid rgba(255,255,255,0.05)",
                  }}>
                    <span style={{ fontWeight:700, fontSize:13, flex:1 }}>{pair.a} ↔ {pair.b}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                      {pair.sameClan && (
                        <span style={{ fontSize:11, color:"var(--warning)", fontWeight:700 }}>Same clan: {pair.clan}</span>
                      )}
                      {pair.gapHours!=null && (
                        <span style={{ fontSize:12, opacity:0.45 }}>{pair.gapHours.toFixed(1)}h gap</span>
                      )}
                      <span style={{
                        fontSize:13, fontWeight:800, minWidth:44, textAlign:"right",
                        color: pct>=90?"var(--danger)":pct>=80?"var(--warning)":"rgba(255,255,255,0.6)",
                      }}>{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Skills comparison ──────────────────────────────────────────── */}
      {players.length>0 && (
        <div className="card">
          <div className="cardHeader">
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="cardTitle">Skills</div>
              <InfoIcon tip={"Side-by-side skill levels. Identical profiles across accounts can indicate the same player."} />
            </div>
          </div>
          <div className="cardBody" style={{ overflowX:"auto" }}>
            <table className="table" style={{ minWidth:400 }}>
              <thead>
                <tr>
                  <th style={{ width:120 }}>Skill</th>
                  {skillsMatrix.cols.map(c=><th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {skillsMatrix.rows.map(r=>(
                  <tr key={r.skill}>
                    <td style={{ fontWeight:600, textTransform:"capitalize" }}>{r.skill}</td>
                    {skillsMatrix.cols.map(c=>(
                      <td key={c} title={`${fmtInt(r.values[c])} XP`}
                        style={{ fontWeight:600 }}>{xpToLevel(r.values[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Equipment comparison ───────────────────────────────────────── */}
      {players.length>0 && (
        <div className="card">
          <div className="cardHeader">
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="cardTitle">Equipment</div>
              <InfoIcon tip={"Slot-by-slot gear comparison. Identical rare items across accounts is a strong alt signal."} />
            </div>
          </div>
          <div className="cardBody" style={{ overflowX:"auto" }}>
            <table className="table" style={{ minWidth:400 }}>
              <thead>
                <tr>
                  <th style={{ width:120 }}>Slot</th>
                  {equipMatrix.cols.map(c=><th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {equipMatrix.rows.map(r=>(
                  <tr key={r.slot}>
                    <td style={{ fontWeight:600, textTransform:"capitalize" }}>{r.slot}</td>
                    {equipMatrix.cols.map(c=>(
                      <td key={c}>{equipLabel(r.values[c], resolveItemName)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Vault analysis ─────────────────────────────────────────────── */}
      {players.length>1 && (
        <div className="card">
          <div className="cardHeader" style={{ justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="cardTitle">Vault Analysis</div>
              <InfoIcon tip={"Flags clans where one player dominates withdrawals — a classic mule pattern."} />
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ fontSize:11, opacity:0.5 }}>Window</span>
                <InfoIcon tip={"How many days back to scan vault logs."} />
                <input className="input" style={{ width:70, marginLeft:3 }} value={windowDays}
                  onChange={e=>setWindowDays(e.target.value)} />
                <span style={{ fontSize:11, opacity:0.5 }}>days</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ fontSize:11, opacity:0.5 }}>Min qty</span>
                <InfoIcon tip={"Ignore vault movements smaller than this amount."} />
                <input className="input" style={{ width:85, marginLeft:3 }} value={minQty}
                  onChange={e=>setMinQty(e.target.value)} />
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <span style={{ fontSize:11, opacity:0.5 }}>Mule span</span>
                <InfoIcon tip={"Flag if a deposit → withdrawal pair occurs within this window.\n6h = tight · 24h = standard · 72h = slow drip"} />
                <select className="select" style={{ width:75, marginLeft:3 }} value={muleSpanHours}
                  onChange={e=>setMuleSpanHours(Number(e.target.value))}>
                  <option value={6}>6h</option>
                  <option value={24}>24h</option>
                  <option value={72}>72h</option>
                </select>
              </div>
            </div>
          </div>
          <div className="cardBody">
            {vaultFindings.length===0 ? (
              <div style={{ opacity:0.4, fontSize:13 }}>No vault activity found in the selected window. Try increasing the Window (days) or lowering Min qty.</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {vaultFindings.map((f,idx)=>(
                  <div key={idx} style={{
                    border: f.flag ? "1px solid rgba(var(--danger-rgb),0.35)" : "1px solid rgba(255,255,255,0.07)",
                    borderRadius:10, overflow:"hidden",
                  }}>
                    {/* Clan header */}
                    <div style={{
                      padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center",
                      background: f.flag ? "rgba(var(--danger-rgb),0.07)" : "rgba(255,255,255,0.03)",
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontWeight:800, fontSize:14 }}>{f.clanName}</span>
                        {f.flag && (() => {
                          const tipMap = {
                            "1-to-1 transfer": "One account deposited, a different account withdrew shortly after.",
                            "Dominant withdrawer (multi-depositor)": "Multiple depositors, but one player took 70%+ of all withdrawals.",
                            "Dominant withdrawer": "One player withdrew 60%+ of vault activity without depositing proportionally.",
                          };
                          const tip = tipMap[f.flagReason] || "Suspicious vault activity pattern detected. Review the breakdown below for details.";
                          return (
                            <Tooltip text={tip}>
                              <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:5,
                                background:"rgba(var(--danger-rgb),0.2)", color:"var(--danger)", cursor:"help" }}>
                                ⚠ {f.flagReason||"Flagged"}
                              </span>
                            </Tooltip>
                          );
                        })()}
                      </div>
                      <div style={{ fontSize:12, opacity:0.5 }}>{f.eligiblePlayers.length} player{f.eligiblePlayers.length!==1?"s":""} in compare</div>
                    </div>

                    <div style={{ padding:"12px 14px" }}>
                      {/* KPI row */}
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:12 }}>
                        {[
                          ["Total deposited",   fmtInt(f.totalAdded),   "All items added to the vault in this period."],
                          ["Total withdrawn",   fmtInt(f.totalWithdrew), "All items taken from the vault in this period."],
                          ["Depositors",        f.depositors,            "Distinct players who made at least one deposit."],
                          ["Withdrawers",       f.withdrawers,           "Distinct players who made at least one withdrawal."],
                          ["Top withdrawer %",  f.totalWithdrew>0 ? `${Math.round((f.topWithdrawerShare||0)*100)}%` : "—", "Share of total withdrawals taken by the top withdrawer. 70%+ is flagged."],
                          ["Net balance",       fmtInt((f.totalAdded||0)-(f.totalWithdrew||0)), "Total deposited minus total withdrawn."],
                        ].map(([label,val,tip])=>(
                          <div key={label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"8px 10px" }}>
                            <div style={{ fontSize:11, opacity:0.45, marginBottom:3, display:"flex", alignItems:"center", gap:4 }}>
                              {label}
                              <InfoIcon tip={tip} />
                            </div>
                            <div style={{ fontSize:16, fontWeight:800 }}>{val}</div>
                          </div>
                        ))}
                      </div>

                      {/* Top withdrawer line */}
                      {f.topWithdrawer && (
                        <div style={{ fontSize:13, marginBottom:12 }}>
                          Top withdrawer: <b>{f.topWithdrawer}</b> withdrew <b>{fmtInt(f.topWithdrawerQty)}</b>
                          {f.totalWithdrew>0 && <span style={{ opacity:0.5 }}> ({Math.round(f.topWithdrawerShare*100)}% of all withdrawals)</span>}
                        </div>
                      )}

                      {/* Member flow table */}
                      {f.memberFlows?.length>0 && (
                        <details style={{ marginBottom:10 }}>
                          <summary style={{ fontSize:13, fontWeight:700, cursor:"pointer", opacity:0.8, marginBottom:6 }}>
                            Member flow — who deposited vs withdrew
                            <span style={{ fontWeight:400, fontSize:12, opacity:0.55, marginLeft:8 }}>Shows net gain/loss per player. A net negative (red) means they took out more than they put in.</span>
                          </summary>
                          <div style={{ overflowX:"auto", marginTop:8 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Member</th>
                                  <th style={{ textAlign:"right" }}>Added</th>
                                  <th style={{ textAlign:"right" }}>Withdrew</th>
                                  <th style={{ textAlign:"right" }}>Net</th>
                                  <th style={{ textAlign:"right" }}>% withdrawals</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.memberFlows.slice(0,12).map(r=>(
                                  <tr key={r.name}>
                                    <td style={{ fontWeight:700 }}>{r.name}</td>
                                    <td style={{ textAlign:"right" }}>{fmtInt(r.added)}</td>
                                    <td style={{ textAlign:"right" }}>{fmtInt(r.withdrew)}</td>
                                    <td style={{ textAlign:"right", fontWeight:700,
                                      color: r.net<0?"var(--danger)":r.net>0?"var(--success)":"rgba(255,255,255,0.4)" }}>
                                      {fmtInt(r.net)}
                                    </td>
                                    <td style={{ textAlign:"right", opacity:0.6 }}>
                                      {f.totalWithdrew>0?`${Math.round((r.withdrawShare||0)*100)}%`:"—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}

                      {/* Mule moves */}
                      {f.muleMoves?.length>0 && (
                        <details style={{ marginBottom:10 }}>
                          <summary style={{ fontSize:13, fontWeight:700, cursor:"pointer", opacity:0.8, marginBottom:6 }}>
                            Suspected mule movements ({f.muleMoves.length})
                            <span style={{ fontWeight:400, fontSize:12, opacity:0.55, marginLeft:8 }}>One player deposited, a different player withdrew shortly after. Δt = time between deposit and withdrawal.</span>
                          </summary>
                          <div style={{ overflowX:"auto", marginTop:8 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Depositor</th><th>Withdrawer</th><th>Item</th>
                                  <th style={{ textAlign:"right" }}>Deposited</th>
                                  <th style={{ textAlign:"right" }}>Withdrawn</th>
                                  <th>Δt</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.muleMoves.slice(0,10).map((m,i)=>(
                                  <tr key={i}>
                                    <td style={{ fontWeight:700 }}>
                                      {m.depositor}
                                      {m.depositorShare!=null&&isFinite(m.depositorShare)&&<span style={{ opacity:0.5 }}> ({Math.round(m.depositorShare*100)}%)</span>}
                                      {m.uniqueDepositors>1&&<span style={{ opacity:0.4, fontSize:11 }}> · {m.uniqueDepositors} accts</span>}
                                    </td>
                                    <td style={{ fontWeight:700 }}>{m.withdrawer}</td>
                                    <td>{titleCaseWords(m.item)}</td>
                                    <td style={{ textAlign:"right" }}>{fmtInt(m.deposited)}</td>
                                    <td style={{ textAlign:"right" }}>{fmtInt(m.withdrawn)}</td>
                                    <td style={{ opacity:0.6 }}>{formatEta(m.deltaMs)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}

                      {/* Top depositors + withdrawers */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                        {[["Top depositors", f.topDepositors||[], "added"],
                          ["Top withdrawers", f.topWithdrawers||[], "withdrew"]].map(([label, rows])=>(
                          <div key={label}>
                            <div style={{ fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>{label}</div>
                            {rows.length===0
                              ? <div style={{ fontSize:12, opacity:0.35 }}>None</div>
                              : <table className="table">
                                  <thead><tr><th>Member</th><th style={{ textAlign:"right" }}>Qty</th><th>Top item</th></tr></thead>
                                  <tbody>
                                    {rows.map(d=>(
                                      <tr key={d.name}>
                                        <td style={{ fontWeight:700 }}>{d.name}</td>
                                        <td style={{ textAlign:"right" }}>{fmtInt(d.qty)}</td>
                                        <td style={{ fontSize:11, opacity:0.5 }}>{d.topItem?titleCaseWords(d.topItem):"—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                            }
                          </div>
                        ))}
                      </div>

                      {/* Top items */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                        {[["Top deposited items", f.topAddedItems||[]],
                          ["Top withdrawn items", f.topWithdrewItems||[]]].map(([label, rows])=>(
                          <div key={label}>
                            <div style={{ fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>{label}</div>
                            {rows.length===0
                              ? <div style={{ fontSize:12, opacity:0.35 }}>None</div>
                              : <table className="table">
                                  <thead><tr><th>Item</th><th style={{ textAlign:"right" }}>Qty</th><th>Top member</th></tr></thead>
                                  <tbody>
                                    {rows.map(it=>(
                                      <tr key={it.item}>
                                        <td style={{ fontWeight:700 }}>{titleCaseWords(it.item)}</td>
                                        <td style={{ textAlign:"right" }}>{fmtInt(it.qty)}</td>
                                        <td style={{ fontSize:11, opacity:0.5 }}>{it.topName||"—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                            }
                          </div>
                        ))}
                      </div>

                      {/* Evidence sequences */}
                      {f.evidenceSequences?.length>0 && (
                        <details>
                          <summary style={{ fontSize:13, fontWeight:700, cursor:"pointer", opacity:0.8, marginBottom:6 }}>
                            Evidence sequences ({f.evidenceSequences.length})
                            <span style={{ fontWeight:400, fontSize:12, opacity:0.55, marginLeft:8 }}>Specific item-level deposit→withdrawal chains involving the top withdrawer, within 24h of each other.</span>
                          </summary>
                          <div style={{ overflowX:"auto", marginTop:8 }}>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th style={{ textAlign:"right" }}>Deposited</th>
                                  <th style={{ textAlign:"right" }}>Withdrawn</th>
                                  <th>Deposited at</th><th>Withdrawn at</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.evidenceSequences.map((e,i)=>(
                                  <tr key={i}>
                                    <td style={{ fontWeight:700 }}>{titleCaseWords(e.item)}</td>
                                    <td style={{ textAlign:"right" }}>{fmtInt(e.deposits)}</td>
                                    <td style={{ textAlign:"right" }}>{fmtInt(e.withdrawals)}</td>
                                    <td style={{ fontSize:12, opacity:0.6 }}>{fmtLocalDateTime(e.depositStart)}</td>
                                    <td style={{ fontSize:12, opacity:0.6 }}>{fmtLocalDateTime(e.withdrawStart)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}

                      {!f.flag && (
                        <div style={{ fontSize:12, opacity:0.4, marginTop:8, padding:"8px 10px", background:"rgba(var(--success-rgb),0.04)", border:"1px solid rgba(var(--success-rgb),0.12)", borderRadius:8 }}>
                          ✓ Not flagged — vault patterns look normal at the current thresholds. If you suspect activity, try lowering Min qty or increasing the Window.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
