import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, onChatScanStatus, setChatKeywords, setChatIgnoredChannels } from "../lib/bridge.js";
import { formatAgo } from "../lib/format.js";
import { useToast } from "../components/Toast.jsx";

// ─── helpers ─────────────────────────────────────────────────────────────────


function formatDate(iso){
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday:"short", year:"numeric", month:"short", day:"numeric" });
}

function normalizeMode(n){
  if (n === 1) return "Normal";
  if (n === 2) return "Ironman";
  if (n === 3) return "Group Ironman";
  if (n === 0) return "Not Selected";
  return null;
}

function dateToBeforeTimestamp(dateStr){
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return null;
  // Set to end-of-day, capture all messages on that date
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}


function ExportChatButton({ categories, active, onToggle }){
  const open = active;
  const [fromDate,   setFromDate]   = useState("");
  const [toDate,     setToDate]     = useState("");
  const [selCat,     setSelCat]     = useState("all");
  const [exporting,  setExporting]  = useState(false);
  const [status,     setStatus]     = useState("");

  async function doExport(){
    setExporting(true);
    setStatus("Fetching messages…");
    try{
      const from  = fromDate ? new Date(fromDate + "T00:00:00").toISOString() : null;
      const to    = toDate   ? new Date(toDate   + "T23:59:59").toISOString() : null;
      const cats  = selCat === "all" ? (categories.length ? categories : ["General"]) : [selCat];

      let allMsgs = [];
      for (const cat of cats){
        let before = to || undefined;
        let fetched = 0;
        setStatus(`Fetching ${TAB_LABELS[cat]||cat}…`);
        while(true){
          const rows = await api.getChatMessages({
            category:cat, limit:500,
            beforeTimestamp:before||undefined,
            fromTimestamp:from||undefined,
          });
          if (!rows?.length) break;
          const inRange = rows.filter(m => {
            const ts = m?.timestamp||m?.Timestamp;
            return !!ts;
          });
          // tag with category
          for (const r of inRange) r._cat = cat;
          allMsgs.push(...inRange);
          fetched += rows.length;
          const oldest = rows[rows.length-1]?.timestamp || rows[rows.length-1]?.Timestamp;
          if (!oldest || rows.length < 500) break;

          if (from && oldest < from) break;
          before = oldest;
          setStatus(`Fetching ${TAB_LABELS[cat]||cat} — ${allMsgs.length} so far…`);
        }
      }


      allMsgs.sort((a,b) => {
        const ta = a?.timestamp||a?.Timestamp||"";
        const tb = b?.timestamp||b?.Timestamp||"";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });

      setStatus(`Building export (${allMsgs.length} messages)…`);

      const lines = [];
      let lastDate = "";
      for (const m of allMsgs){
        const ts   = m?.timestamp||m?.Timestamp;
        const d    = ts ? new Date(ts) : null;
        const date = d ? d.toLocaleDateString(undefined,{weekday:"short",year:"numeric",month:"short",day:"numeric"}) : "";
        if (date && date !== lastDate){ lines.push("", `── ${date} ──`, ""); lastDate = date; }

        const msg = m?.message||m?.Message||"";
        lines.push(msg);
      }
      const content = lines.join("\n");

      const dateTag  = fromDate||toDate ? `_${fromDate||"start"}_to_${toDate||"now"}` : "_all";
      const catTag   = selCat === "all" ? "_all_channels" : `_${TAB_LABELS[selCat]||selCat}`.replace(/\s/g,"-");
      const filename = `idleclans_chat${catTag}${dateTag}.txt`;

      const blob = new Blob([content], { type: "text/plain" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);

      setStatus(`Exported ${allMsgs.length} messages.`);
      setTimeout(() => { setStatus(""); onToggle(); }, 1800);
    }catch(e){
      setStatus("Error: " + (e?.message||String(e)));
    }finally{
      setExporting(false);
    }
  }

  return (
    <div style={{ position:"relative" }}>
      <button onClick={()=>{ onToggle(); setStatus(""); }}
        style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6,
          cursor:"pointer", fontSize:13, padding:"4px 10px", color:"inherit" }}
        title="Export chat history to a file">
        📥 Export
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, zIndex:200,
          width:340, background:"var(--surface, rgba(15,22,18,0.98))", border:"1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.18)",
          borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", overflow:"hidden" }}>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize:13, fontWeight:700 }}>Export Chat History</span>
            <button onClick={()=>onToggle()}
              style={{ background:"none", border:"none", cursor:"pointer",
                opacity:0.45, fontSize:18, lineHeight:1, color:"inherit" }}>×</button>
          </div>

          <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
            {/* Channel */}
            <div>
              <div style={{ fontSize:11, opacity:0.45, marginBottom:4 }}>Channel</div>
              <select className="select" value={selCat} onChange={e=>setSelCat(e.target.value)} style={{ width:"100%", fontSize:13 }}>
                <option value="all">All channels</option>
                {(categories||[]).map(c=>(
                  <option key={c} value={c}>{TAB_LABELS[c]||c}</option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, opacity:0.45, marginBottom:4 }}>From</div>
                <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}
                  style={{ width:"100%", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:7, padding:"5px 8px", fontSize:13, color:"inherit", colorScheme:"dark" }} />
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, opacity:0.45, marginBottom:4 }}>To</div>
                <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}
                  style={{ width:"100%", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:7, padding:"5px 8px", fontSize:13, color:"inherit", colorScheme:"dark" }} />
              </div>
            </div>

            {/* Status / export button */}
            {status
              ? <div style={{ fontSize:12, opacity:0.65, padding:"6px 0" }}>{status}</div>
              : <button className="btn btnPrimary" onClick={doExport} disabled={exporting}
                  style={{ width:"100%", justifyContent:"center", marginTop:2 }}>
                  {exporting ? "Exporting…" : "Export"}
                </button>
            }
          </div>
        </div>
      )}
    </div>
  );
}


function MentionHistoryButton({ onJumpToMessage, active, onToggle }){
  const open = active;
  const setOpen = onToggle;
  const [history, setHistory] = useState([]);

  function loadHistory(){
    try{ setHistory(JSON.parse(localStorage.getItem("chat_mentionHistory")||"[]")); }
    catch{ setHistory([]); }
  }
  function clearHistory(){
    try{ localStorage.removeItem("chat_mentionHistory"); }catch{}
    setHistory([]);
  }
  function fmtTs(iso){
    if (!iso) return "";
    try{ return new Date(iso).toLocaleString(undefined,{month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}); }
    catch{ return iso; }
  }

  return (
    <div style={{ position:"relative" }}>
      <button onClick={()=>{ if (!open) loadHistory(); onToggle(); }}
        style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6,
          cursor:"pointer", fontSize:13, padding:"4px 10px", color:"inherit" }}
        title="View mention & keyword alert history (last 50)">
        📋 History
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, zIndex:200,
          width:420, maxHeight:480, display:"flex", flexDirection:"column",
          background:"var(--surface, rgba(15,22,18,0.98))", border:"1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.18)",
          borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", overflow:"hidden" }}>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)", flexShrink:0 }}>
            <span style={{ fontSize:13, fontWeight:700 }}>Alert History</span>
            <div style={{ display:"flex", gap:6 }}>
              {history.length > 0 && (
                <button onClick={()=>{ if(confirm("Clear all mention history?")) clearHistory(); }}
                  style={{ background:"none", border:"1px solid rgba(248,113,113,0.3)", borderRadius:5,
                    cursor:"pointer", fontSize:11, padding:"2px 8px", color:"var(--danger)" }}>
                  Clear
                </button>
              )}
              <button onClick={()=>setOpen(false)}
                style={{ background:"none", border:"none", cursor:"pointer",
                  opacity:0.45, fontSize:18, lineHeight:1, color:"inherit" }}>×</button>
            </div>
          </div>

          <div style={{ overflowY:"auto", flex:1 }}>
            {history.length === 0
              ? <div style={{ padding:"24px 14px", opacity:0.35, fontSize:13, textAlign:"center" }}>
                  No alerts recorded yet. Mention and keyword alerts are saved automatically when chat scanning is active.
                </div>
              : history.map((m, i) => {
                  const isKeyword = !!m.keyword;
                  const uniqueKey = `${m.receivedAt ?? i}-${m.senderName ?? i}-${i}`;
                  return (
                    <div key={uniqueKey}
                      onClick={()=>{ if(onJumpToMessage){ setOpen(false); onJumpToMessage(m); } }}
                      style={{ padding:"10px 14px",
                        borderBottom:"1px solid rgba(255,255,255,0.05)",
                        background: i%2===0 ? "transparent" : "rgba(255,255,255,0.015)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background= i%2===0?"transparent":"rgba(255,255,255,0.015)"; }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3, flexWrap:"wrap" }}>
                        {isKeyword
                          ? <span style={{ fontWeight:700, fontSize:12, color:"var(--info)" }}>🔍 "{m.keyword}"</span>
                          : <span style={{ fontWeight:700, fontSize:12, color:"var(--warning2)" }}>🔔 {m.accountName}</span>
                        }
                        <span style={{ fontSize:11, opacity:0.45 }}>in {TAB_LABELS[m.category]||m.category} by</span>
                        <span style={{ fontSize:11, fontWeight:600 }}>{m.senderName}</span>
                        <span style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5, flexShrink:0 }}>
                          <span style={{ fontSize:10, opacity:0.4 }}>↗ jump</span>
                          <span style={{ fontSize:10, opacity:0.3 }}>{fmtTs(m.receivedAt)}</span>
                        </span>
                      </div>
                      <div style={{ fontSize:11, opacity:0.55, fontFamily:"ui-monospace,monospace",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {m.message}
                      </div>
                    </div>
                  );
                })
            }
          </div>

          {history.length > 0 && (
            <div style={{ padding:"7px 14px", borderTop:"1px solid rgba(255,255,255,0.06)",
              fontSize:11, opacity:0.3, flexShrink:0 }}>
              {history.length} alert{history.length!==1?"s":""} · last 50 saved
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KeywordManagerButton({ keywords, onChange, ignoredChannels, onIgnoredChannelsChange, availableChannels, active, onToggle }){
  const open = active;
  const setOpen = onToggle;
  const [input, setInput] = useState("");

  function add(){
    const kw = input.trim().toLowerCase();
    if (!kw || keywords.includes(kw)) return;
    onChange([...keywords, kw]);
    setInput("");
  }

  function remove(kw){ onChange(keywords.filter(k => k !== kw)); }

  function toggleChannel(ch){
    const lower = ch.toLowerCase();
    if (ignoredChannels.includes(lower)){
      onIgnoredChannelsChange(ignoredChannels.filter(c => c !== lower));
    } else {
      onIgnoredChannelsChange([...ignoredChannels, lower]);
    }
  }

  function handleKey(e){
    if (e.key === "Enter") add();
    if (e.key === "Escape") setOpen(false);
  }

  const activeCount = keywords.length + ignoredChannels.length;

  return (
    <div style={{ position:"relative" }}>
      <button
        onClick={()=>onToggle()}
        style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6,
          cursor:"pointer", fontSize:13, padding:"4px 10px",
          color: activeCount > 0 ? "var(--info)" : "inherit" }}
        title="Manage keyword alerts and ignored channels">
        🔍 Keywords{keywords.length > 0 ? ` (${keywords.length})` : ""}
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, zIndex:200,
          width:360, background:"var(--surface, rgba(15,22,18,0.98))", border:"1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.18)",
          borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", overflow:"hidden" }}>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize:13, fontWeight:700 }}>Keyword Alerts</span>
            <button onClick={()=>setOpen(false)}
              style={{ background:"none", border:"none", cursor:"pointer",
                opacity:0.45, fontSize:18, lineHeight:1, color:"inherit" }}>×</button>
          </div>

          {/* Add keyword */}
          <div style={{ padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize:11, opacity:0.45, marginBottom:8, lineHeight:1.5 }}>
              Alerts fire on whole-word matches only — "cat" won't trigger on "applications".
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <input
                className="input" value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={handleKey} placeholder="e.g. banned, scam, drama…"
                style={{ flex:1, fontSize:13 }} autoFocus />
              <button className="btn btnPrimary" onClick={add}
                style={{ fontSize:13, padding:"4px 12px" }}>Add</button>
            </div>
          </div>

          {/* Keyword list */}
          <div style={{ maxHeight:180, overflowY:"auto" }}>
            {keywords.length === 0
              ? <div style={{ padding:"14px", opacity:0.35, fontSize:13, textAlign:"center" }}>
                  No keywords yet.
                </div>
              : keywords.map(kw => (
                <div key={kw} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"7px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize:13, fontFamily:"ui-monospace,monospace", color:"var(--info)" }}>{kw}</span>
                  <button onClick={()=>remove(kw)}
                    style={{ background:"none", border:"none", cursor:"pointer",
                      opacity:0.45, fontSize:15, lineHeight:1, color:"var(--danger)", padding:"0 2px" }}>×</button>
                </div>
              ))
            }
          </div>

          {/* Ignored channels */}
          {availableChannels.length > 0 && (
            <>
              <div style={{ padding:"8px 14px 6px", borderTop:"1px solid rgba(255,255,255,0.08)",
                fontSize:11, fontWeight:700, opacity:0.5, letterSpacing:"0.05em", textTransform:"uppercase" }}>
                Ignore channels
              </div>
              <div style={{ padding:"4px 14px 10px", display:"flex", flexWrap:"wrap", gap:6 }}>
                {availableChannels.map(ch => {
                  const ignored = ignoredChannels.includes(ch.toLowerCase());
                  const displayName = TAB_LABELS[ch] ?? ch;
                  return (
                    <button key={ch} onClick={()=>toggleChannel(ch)} style={{
                      fontSize:12, padding:"3px 10px", borderRadius:20, cursor:"pointer",
                      border: ignored ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.12)",
                      background: ignored ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.04)",
                      color: ignored ? "var(--danger)" : "rgba(255,255,255,0.6)",
                    }}>
                      {ignored ? "✕ " : ""}{displayName}
                    </button>
                  );
                })}
              </div>
              {ignoredChannels.length > 0 && (
                <div style={{ padding:"0 14px 8px", fontSize:11, opacity:0.35 }}>
                  Alerts suppressed in: {ignoredChannels.join(", ")}
                </div>
              )}
            </>
          )}

          {/* Footer */}
          {(keywords.length > 0 || ignoredChannels.length > 0) && (
            <div style={{ padding:"7px 14px", borderTop:"1px solid rgba(255,255,255,0.06)",
              fontSize:11, opacity:0.3 }}>
              {keywords.length} keyword{keywords.length !== 1 ? "s" : ""}
              {ignoredChannels.length > 0 ? ` · ${ignoredChannels.length} channel${ignoredChannels.length!==1?"s":""} ignored` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE  = 200;  // messages fetched per load
const MAX_MSGS   = 400;  // max kept in DOM — oldest are dropped to prevent freeze

const TAB_ORDER  = ["General","Help","Trade","ClanHub","Clan Recruiting","CombatLFG","RaidLFG"];
const TAB_LABELS = { General:"General", Help:"Help", Trade:"Trade", ClanHub:"Clan Recruiting", CombatLFG:"Combat-LFG", RaidLFG:"Raid-LFG" };

export default function ChatPage(){
  const toast = useToast();
  const [activeTab,    setActiveTab]    = useState("General");
  const [categories,   setCategories]   = useState([]);
  const [msgs,         setMsgs]         = useState([]);
  const [hasMore,      setHasMore]      = useState(true);
  const [senderFilter, setSenderFilter] = useState("");
  const [textFilter,   setTextFilter]   = useState("");
  const [loading,      setLoading]      = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [error,        setError]        = useState("");
  const [chatScan,     setChatScan]     = useState({ running:false, nextRunAt:null, lastOkAt:null, lastError:null });
  // Clock tick — forces re-render every 30s so formatAgo stays current
  const [, setTick] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=> setTick(n => n+1), 30000);
    return ()=> clearInterval(t);
  }, []);
  const [newestByCat,  setNewestByCat]  = useState({});
  const [msgCounts,    setMsgCounts]    = useState({ total:0, byCategory:{} });
  const [jumpDate,     setJumpDate]     = useState(""); // date input value
  const [globalSearch, setGlobalSearch] = useState(false); // search across all categories
  const [globalMsgs,   setGlobalMsgs]   = useState([]);
  const [globalLoading,setGlobalLoading]= useState(false);
  const [globalHasMore,setGlobalHasMore]= useState(false);
  const [globalBefore, setGlobalBefore] = useState(null);
  const [activePanel,  setActivePanel]  = useState(null); // "history"|"export"|"keywords"|null
  function togglePanel(name){ setActivePanel(p => p === name ? null : name); }

  // ─── mention alert state — handled globally in Layout ────────────────────
  // The sound toggle preference is still stored here for the button in the top bar
  const [mentionSoundOn, setMentionSoundOn] = useState(() => {
    try{ return localStorage.getItem("chat_mentionSound") !== "0"; }catch{ return true; }
  });
  const toggleMentionSound = useCallback(() => {
    setMentionSoundOn(prev => {
      const next = !prev;
      try{ localStorage.setItem("chat_mentionSound", next ? "1" : "0"); }catch{}
      return next;
    });
  }, []);

  // ─── keyword alerts ───────────────────────────────────────────────────────
  const [chatKeywords, setChatKeywordsState] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("chat_keywords") || "[]"); }
    catch{ return []; }
  });
  // Persist to localStorage and push to main process whenever keywords change
  useEffect(()=>{
    try{ localStorage.setItem("chat_keywords", JSON.stringify(chatKeywords)); }catch{}
    setChatKeywords(chatKeywords).catch(()=>{});
  }, [chatKeywords]); // eslint-disable-line
  // Also push on mount so main process picks up any saved keywords after restart
  useEffect(()=>{
    setChatKeywords(chatKeywords).catch(()=>{});
  }, []); // eslint-disable-line

  // ─── ignored channels ────────────────────────────────────────────────────
  const [ignoredChannels, setIgnoredChannelsState] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem("chat_ignoredChannels") || "[]"); }
    catch{ return []; }
  });
  const [availableChannels, setAvailableChannels] = useState([]);
  useEffect(()=>{
    try{ localStorage.setItem("chat_ignoredChannels", JSON.stringify(ignoredChannels)); }catch{}
    setChatIgnoredChannels(ignoredChannels).catch(()=>{});
  }, [ignoredChannels]); // eslint-disable-line
  useEffect(()=>{
    setChatIgnoredChannels(ignoredChannels).catch(()=>{});
    // Load known channels from DB
    // availableChannels is derived from categories — kept in a separate effect below
  }, []); // eslint-disable-line

  const [highlightedId, setHighlightedId] = useState(null);
  const msgRefs         = useRef({});
  const highlightTimer  = useRef(null);
  // Set briefly during handleJumpToMessage so the tab-change effect below
  // doesn't immediately overwrite the targeted message window we just
  // fetched via getChatMessagesAroundId with a generic "most recent 200"
  // load for the new tab.
  const suppressNextTabLoadRef = useRef(false);
  const lastSeenRef     = useRef({});
  const sentinelRef     = useRef(null);
  const observerRef     = useRef(null);
  const loadingMoreRef  = useRef(false);
  useEffect(() => {
    try{ lastSeenRef.current = JSON.parse(localStorage.getItem("chat_lastSeenByCat") || "{}"); }
    catch{ lastSeenRef.current = {}; }
  }, []);

  // ── sort categories ────────────────────────────────────────────────────────
  const sortCats = useCallback((cats) => {
    const set = new Set(cats || []);
    const out = TAB_ORDER.filter(k => set.has(k));
    for (const k of (cats || [])) if (!TAB_ORDER.includes(k)) out.push(k);
    return out;
  }, []);

  // ── fetch newest timestamp per category (for unread dots) ─────────────────
  const refreshNewestMap = useCallback(async (cats) => {
    const out = {};
    for (const c of (cats || [])){
      try{
        const r = await api.getChatMessages({ category:c, limit:1 });
        const ts = r?.[0]?.timestamp || r?.[0]?.Timestamp;
        if (ts) out[c] = ts;
      }catch{}
    }
    setNewestByCat(out);
  }, []);

  // ── load initial page ──────────────────────────────────────────────────────
  const loadInitial = useCallback(async (tab, sender, text, beforeTs = null) => {
    const cat = tab || activeTab;
    if (!cat) return;
    setLoading(true);
    setMsgs([]);
    setHasMore(true);
    try{
      const rows = await api.getChatMessages({
        category: cat,
        sender: sender?.trim() || undefined,
        q: text?.trim() || undefined,
        limit: PAGE_SIZE,
        beforeTimestamp: beforeTs || undefined,
      });
      const r = rows || [];
      setMsgs(r);
      setHasMore(r.length === PAGE_SIZE);

      // mark as seen
      const newest = r[0]?.timestamp || r[0]?.Timestamp;
      if (newest && !beforeTs){
        const next = { ...lastSeenRef.current, [cat]: newest };
        lastSeenRef.current = next;
        try{ localStorage.setItem("chat_lastSeenByCat", JSON.stringify(next)); }catch{}
      }
    }catch(e){ setError(String(e?.message || e)); }
    finally{ setLoading(false); }
  }, [activeTab]);

  // ── load next page (called by IntersectionObserver) ───────────────────────
  // Appends older messages but caps total at MAX_MSGS to prevent DOM freeze.
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    setMsgs(prev => {
      const oldest = prev[prev.length - 1];
      const before = oldest?.timestamp || oldest?.Timestamp;
      if (!before) return prev;

      loadingMoreRef.current = true;
      setLoadingMore(true);

      api.getChatMessages({
        category: activeTab,
        sender: senderFilter?.trim() || undefined,
        q: textFilter?.trim() || undefined,
        limit: PAGE_SIZE,
        beforeTimestamp: before,
      }).then(rows => {
        const r = rows || [];
        setMsgs(p => {
          const combined = [...p, ...r];
          // Drop oldest entries beyond the cap to keep DOM size bounded.
          return combined.length > MAX_MSGS ? combined.slice(0, MAX_MSGS) : combined;
        });
        setHasMore(r.length === PAGE_SIZE);
      }).catch(e => setError(String(e?.message || e)))
        .finally(() => { loadingMoreRef.current = false; setLoadingMore(false); });

      return prev;
    });
  }, [activeTab, senderFilter, textFilter]);

  // ── IntersectionObserver: watch sentinel div at bottom of list ─────────────
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMoreRef.current){
          loadMore();
        }
      },
      { rootMargin: "200px" } // start loading before user hits the very bottom
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadMore]);

  // ── initial data load ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try{
        const cats = await api.getChatCategories();
        const nextCats = sortCats(cats || []);
        if (nextCats.length){
          setCategories(nextCats);
          if (!nextCats.includes(activeTab)) setActiveTab(nextCats[0]);
          await refreshNewestMap(nextCats);
        }
      }catch{}
      try{
        const counts = await api.getChatMessageCounts?.();
        if (counts) setMsgCounts(counts);
      }catch{}
      try{
        const s = await api.getChatScanStatus?.();
        if (s) setChatScan({ running:!!s.running, nextRunAt:s.nextRunAt??null, lastOkAt:s.lastOkAt??null, lastError:s.lastError??null });
      }catch{}
    })();
    let lastKnownOkAt = null;
    const unsub = onChatScanStatus?.((s) => {
      if (!s) return;
      setChatScan({ running:!!s.running, nextRunAt:s.nextRunAt??null, lastOkAt:s.lastOkAt??null, lastError:s.lastError??null });
      // When a scan tick completes (lastOkAt changed), immediately refresh messages
      // so the page updates without waiting for the 10s poll interval.
      if (s.lastOkAt && s.lastOkAt !== lastKnownOkAt){
        lastKnownOkAt = s.lastOkAt;
        (async()=>{
          try{
            const cats = await api.getChatCategories();
            const nextCats = sortCats(cats||[]);
            if (nextCats.length) setCategories(nextCats);
            await refreshNewestMap(nextCats);
            const counts = await api.getChatMessageCounts?.();
            if (counts) setMsgCounts(counts);
            const rows = await api.getChatMessages({ category: activeTab, limit: 50 });
            const r = rows || [];
            if (!r.length) return;
            setMsgs(prev => {
              const newestTs = prev[0]?.timestamp || prev[0]?.Timestamp || null;
              const sorted = [...r].sort((a,b)=>{
                const ta=a?.timestamp||a?.Timestamp||""; const tb=b?.timestamp||b?.Timestamp||"";
                return tb>ta?1:tb<ta?-1:0;
              });
              if (!newestTs) return sorted.slice(0, MAX_MSGS);
              const fresh = sorted.filter(m=>{ const ts=m?.timestamp||m?.Timestamp; return ts&&ts>newestTs; });
              if (!fresh.length) return prev;
              const combined = [...fresh, ...prev];
              return combined.length > MAX_MSGS ? combined.slice(0, MAX_MSGS) : combined;
            });
          }catch{}
        })();
      }
    });
    return ()=>{ try{ unsub?.(); }catch{} };
  }, []); // eslint-disable-line

  // ── poll DB while scan is running — refresh counts AND prepend new messages ─
  // We track the newest message timestamp we have so we only fetch what's new.
  const newestMsgTsRef = useRef(null);

  // Keep availableChannels in sync with categories (which updates as new chat arrives)
  useEffect(()=>{
    if (!categories.length) return;
    const sorted = [...categories].sort((a,b)=>{
      const ai = TAB_ORDER.indexOf(a); const bi = TAB_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
    setAvailableChannels(sorted);
  }, [categories]); // eslint-disable-line

  useEffect(() => {
    if (!chatScan.running) return;
    const t = setInterval(async () => {
      try{
        // Update categories, counts and unread dots
        const cats = await api.getChatCategories();
        const nextCats = sortCats(cats || []);
        setCategories(nextCats);
        await refreshNewestMap(nextCats);
        const counts = await api.getChatMessageCounts?.();
        if (counts) setMsgCounts(counts);

        // Prepend any new messages for the active tab since we last saw.
        // Capture the current newest timestamp synchronously before the async fetch.
        const currentNewestTs = (() => {
          // Access msgs via a ref-like approach: read the latest value directly
          return null; // will be set per fetch below
        })();

        // Use a standalone async function so we don't nest setMsgs calls.
        (async () => {
          try{
            // Fetch the latest 50 messages (API returns newest-first)
            const rows = await api.getChatMessages({ category: activeTab, limit: 50 });
            const r = rows || [];
            if (!r.length) return;

            setMsgs(prev => {
              const newestTs = prev[0]?.timestamp || prev[0]?.Timestamp || null;

              // Fresh DB / empty list — just load the first batch directly
              if (!newestTs) {
                const sorted = [...r].sort((a, b) => {
                  const ta = a?.timestamp || a?.Timestamp || "";
                  const tb = b?.timestamp || b?.Timestamp || "";
                  return tb > ta ? 1 : tb < ta ? -1 : 0;
                });
                return sorted.slice(0, MAX_MSGS);
              }

              // Filter to only genuinely new messages
              const fresh = r.filter(m => {
                const ts = m?.timestamp || m?.Timestamp;
                return ts && ts > newestTs;
              });
              if (fresh.length === 0) return prev;

              const freshSorted = [...fresh].sort((a, b) => {
                const ta = a?.timestamp || a?.Timestamp || "";
                const tb = b?.timestamp || b?.Timestamp || "";
                return tb > ta ? 1 : tb < ta ? -1 : 0;
              });

              const combined = [...freshSorted, ...prev];
              return combined.length > MAX_MSGS ? combined.slice(0, MAX_MSGS) : combined;
            });
          }catch{}
        })();
      }catch{}
    }, 10000);
    return () => clearInterval(t);
  }, [chatScan.running, activeTab, sortCats, refreshNewestMap]);

  // ── reload on tab / filter change ─────────────────────────────────────────
  useEffect(() => {
    setJumpDate(""); // clear date jump when switching tabs
    if (suppressNextTabLoadRef.current){
      suppressNextTabLoadRef.current = false;
      return;
    }
    loadInitial(activeTab, senderFilter, textFilter);
  }, [activeTab]); // eslint-disable-line

  useEffect(() => {
    loadInitial(activeTab, senderFilter, textFilter);
  }, [senderFilter, textFilter]); // eslint-disable-line

  // Polls msgRefs for an element to mount (up to ~2s), then scrolls to and
  // highlights it. Replaces a fixed setTimeout — rendering after setMsgs can
  // take longer than expected right after a fresh app launch / large
  // category switch, and a single fixed delay either fires too early (ref
  // not mounted yet, silently does nothing) or is wastefully long otherwise.
  const scrollToAndHighlight = useCallback((id) => {
    clearTimeout(highlightTimer.current);
    const targetId = String(id);
    const deadline = Date.now() + 2000;

    const tick = () => {
      const el = msgRefs.current[targetId];
      if (el){
        setHighlightedId(targetId);
        el.scrollIntoView({ behavior:"smooth", block:"center" });
        highlightTimer.current = setTimeout(() => setHighlightedId(null), 3000);
        return;
      }
      if (Date.now() < deadline){
        highlightTimer.current = setTimeout(tick, 50);
      }
      // Deadline passed and the ref never mounted — give up quietly. This can
      // happen if the message is outside the fetched window for some reason;
      // the row simply won't be highlighted/scrolled to.
    };
    // Wait one frame for React to flush the render from setMsgs before the
    // first ref check.
    requestAnimationFrame(tick);
  }, []);

  // ── jump to a specific message from alert history ────────────────────────
  const handleJumpToMessage = useCallback(async (alert) => {
    if (!alert?.category) return;
    setGlobalSearch(false);
    setSenderFilter("");
    setTextFilter("");
    // Suppress the tab-change effect's generic "most recent 200" load —
    // this function loads the right window itself (either the targeted
    // around-id window, or the date-based fallback). Only relevant if the
    // tab is actually changing — if we're already on this category,
    // setActiveTab is a no-op and the effect won't fire at all, so don't
    // leave the flag set for a future unrelated tab switch.
    if (alert.category !== activeTab){
      suppressNextTabLoadRef.current = true;
      setActiveTab(alert.category);
    }
    clearTimeout(highlightTimer.current);

    // Preferred path: fetch a window of messages centered on the exact
    // message id, regardless of date or how many messages surround it on
    // that day. This is what makes "jump to message" reliable — the old
    // approach paged by a date-derived cutoff with a fixed page size, so a
    // message that wasn't within the most recent 200 messages of that day
    // (or near a local-time midnight boundary) would simply never be
    // fetched, and the jump did nothing.
    if (alert.messageId != null){
      setLoading(true);
      try{
        const res = await api.getChatMessagesAroundId({
          category: alert.category,
          messageId: alert.messageId,
          before: 150,
          after: 50,
        });
        if (res?.found && Array.isArray(res.messages) && res.messages.length){
          setMsgs(res.messages);
          // If we got a full page of older messages, there may be more to
          // load via the usual infinite-scroll path.
          const olderCount = res.messages.filter(m => Number(m.id) < Number(alert.messageId)).length;
          setHasMore(olderCount >= 150);
          setJumpDate("");
          setLoading(false);
          scrollToAndHighlight(alert.messageId);
          return;
        }
      }catch(e){
        console.warn("[ChatPage] getChatMessagesAroundId failed:", e?.message);
      }
      setLoading(false);
      // Fall through to the date-based fallback below if the message wasn't
      // found (e.g. pruned from storage) — best effort, may not land on the
      // exact row but at least gets the user to roughly the right time.
      toast.warning("Couldn't locate the exact message — it may have been pruned. Showing nearby messages instead.");
    }

    // Fallback: jump to that date's messages (original behaviour). Used when
    // there's no messageId at all, or the around-id lookup didn't find it.
    const ts = alert.receivedAt || alert.timestamp;
    const beforeTs = ts ? (() => {
      const d = new Date(ts);
      d.setHours(23,59,59,999);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    })() : null;
    await loadInitial(alert.category, "", "", beforeTs);
    if (alert.messageId != null){
      scrollToAndHighlight(alert.messageId);
    }
  }, [activeTab, loadInitial, scrollToAndHighlight, toast]);

  // ── scan toggle ───────────────────────────────────────────────────────────
  const toggleScan = useCallback(async () => {
    try{
      setError("");
      setLoading(true);
      if (chatScan.running) await api.stopChatScan?.();
      else                  await api.startChatScan?.();
    }catch(e){ setError(String(e?.message || e)); }
    finally{ setLoading(false); }
  }, [chatScan.running]);

  // ── date jump ─────────────────────────────────────────────────────────────
  async function handleJump(){
    if (!jumpDate) return;
    const beforeTs = dateToBeforeTimestamp(jumpDate);
    if (!beforeTs) return;
    await loadInitial(activeTab, senderFilter, textFilter, beforeTs);
  }

  // Global cross-category search
  async function loadGlobal({ reset=true }={}){
    const s = senderFilter?.trim();
    const t = textFilter?.trim();
    if (!s && !t) return;
    setGlobalLoading(true);
    try{
      const before = reset ? null : globalBefore;
      const rows = await api.getChatMessagesGlobal({ sender:s||undefined, q:t||undefined, limit:PAGE_SIZE, beforeTimestamp:before||undefined });
      const r = rows||[];
      if (reset){ setGlobalMsgs(r); } else { setGlobalMsgs(prev=>[...prev,...r]); }
      setGlobalHasMore(r.length===PAGE_SIZE);
      if (r.length) setGlobalBefore(r[r.length-1]?.timestamp||null);
    }catch(e){ setError(String(e?.message||e)); }
    finally{ setGlobalLoading(false); }
  }

  // When globalSearch is on and filters change, re-run
  useEffect(()=>{
    if (!globalSearch) return;
    setGlobalBefore(null);
    setGlobalMsgs([]);
    const s = senderFilter?.trim(), t = textFilter?.trim();
    if (s||t) loadGlobal({ reset:true });
    else setGlobalMsgs([]);
  }, [globalSearch, senderFilter, textFilter]); // eslint-disable-line

  // Group messages by calendar date for date dividers
  const groupedMsgs = React.useMemo(() => {
    const groups = [];
    let lastDate = null;
    for (const m of msgs){
      const iso = m?.timestamp || m?.Timestamp;
      const dateStr = iso ? formatDate(iso) : null;
      if (dateStr && dateStr !== lastDate){
        groups.push({ type:"divider", date: dateStr });
        lastDate = dateStr;
      }
      groups.push({ type:"msg", msg: m });
    }
    return groups;
  }, [msgs]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 80px)", overflow:"hidden" }}>

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, padding:"0 0 12px 0", flexShrink:0, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontWeight:800, fontSize:16 }}>Chat History</span>
          {msgCounts.total > 0 && (
            <span style={{ fontSize:12, fontWeight:700, background:"var(--accent,#2563eb)", color:"#fff", borderRadius:8, padding:"2px 10px" }}>
              {msgCounts.total.toLocaleString()} saved
            </span>
          )}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {/* Mention sound toggle — only meaningful while scan is running */}
          <button
            onClick={toggleMentionSound}
            title={mentionSoundOn ? "Mention alerts: sound on — click to mute" : "Mention alerts: muted — click to enable sound"}
            style={{ background:"none", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6,
              cursor:"pointer", fontSize:13, padding:"4px 10px",
              color: mentionSoundOn ? "var(--success)" : "rgba(255,255,255,0.3)",
              opacity: chatScan.running ? 1 : 0.45 }}>
            {mentionSoundOn ? "🔔 Mentions" : "🔕 Mentions"}
          </button>
          {/* Mention history toggle */}
          <MentionHistoryButton onJumpToMessage={handleJumpToMessage} active={activePanel==="history"} onToggle={()=>togglePanel("history")} />
          {/* Export chat */}
          <ExportChatButton categories={categories} active={activePanel==="export"} onToggle={()=>togglePanel("export")} />
          {/* Keyword alert manager */}
          <KeywordManagerButton active={activePanel==="keywords"} onToggle={()=>togglePanel("keywords")}
            keywords={chatKeywords} onChange={setChatKeywordsState}
            ignoredChannels={ignoredChannels} onIgnoredChannelsChange={setIgnoredChannelsState}
            availableChannels={availableChannels} />
          <button className={chatScan.running ? "btn btnDanger" : "btn"} onClick={toggleScan} disabled={loading}>
            {loading ? "Working…" : chatScan.running ? "Stop scan" : "Start scan"}
          </button>
        </div>
      </div>

      {/* ── Mention alert toasts are shown globally via Layout on any page ── */}

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", flex:1, gap:0, overflow:"hidden" }}>

        {/* ── Category rail ──────────────────────────────────────────────── */}
        <div className="chatRail">
          {categories.map(k => {
            const label    = TAB_LABELS[k] || k;
            const newest   = newestByCat?.[k];
            const lastSeen = lastSeenRef.current?.[k] || null;
            const hasNew   = newest && (!lastSeen || newest > lastSeen);
            const catCount = msgCounts.byCategory?.[k];
            return (
              <button
                key={k}
                className={k === activeTab ? "chatRailItem chatRailItemOn" : "chatRailItem"}
                onClick={() => setActiveTab(k)}
              >
                <span>{label}</span>
                <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                  {catCount > 0 && (
                    <span className="small" style={{ opacity:0.55, fontSize:11 }}>
                      {catCount >= 1000 ? `${Math.floor(catCount/1000)}k` : catCount}
                    </span>
                  )}
                  {hasNew ? <span className="chatDot" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Message area ───────────────────────────────────────────────── */}
        <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* Filter + date jump bar */}
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10, flexShrink:0, flexWrap:"wrap" }}>
            <input className="input" placeholder="Filter by player…" value={senderFilter}
              onChange={e => setSenderFilter(e.target.value)} style={{ width:180 }} />
            <input className="input" placeholder="Filter by keyword…" value={textFilter}
              onChange={e => setTextFilter(e.target.value)} style={{ flex:1, minWidth:140 }} />
            <button
              className={globalSearch ? "btn btnPrimary" : "btn"}
              title={globalSearch ? "Searching across all categories — click to return to tab view" : "Search across all categories"}
              onClick={()=>{ setGlobalSearch(v=>!v); setError(""); }}
            >
              {globalSearch ? "All categories ✓" : "All categories"}
            </button>
            {(senderFilter || textFilter) && (
              <button className="btn" onClick={() => { setSenderFilter(""); setTextFilter(""); }}>Clear</button>
            )}

            {/* Date jump — only relevant in per-category mode */}
            {!globalSearch && <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:"auto" }}>
              <span style={{ fontSize:12, opacity:0.45, whiteSpace:"nowrap" }}>Jump to</span>
              <input type="date" value={jumpDate} onChange={e => setJumpDate(e.target.value)}
                style={{
                  background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)",
                  borderRadius:8, padding:"5px 10px", fontSize:13, color:"inherit", cursor:"pointer",
                  colorScheme:"dark",
                }} />
              <button className="btn" disabled={!jumpDate || loading} onClick={handleJump}>Go</button>
              {jumpDate && (
                <button className="btn" onClick={() => { setJumpDate(""); loadInitial(activeTab, senderFilter, textFilter); }}>
                  Latest
                </button>
              )}
            </div>}
          </div>

          {error && <div style={{ color:"var(--danger)", fontSize:13, marginBottom:8 }}>{error}</div>}

          {/* Scrollable message feed */}
          <div style={{ flex:1, overflowY:"auto", paddingRight:4 }}>
          <div className="chatList compact">

            {/* ── Global search results ───────────────────────── */}
            {globalSearch && (
              <>
                {!(senderFilter?.trim()) && !(textFilter?.trim()) && (
                  <div style={{ textAlign:"center", opacity:0.35, padding:24, fontSize:13 }}>
                    Enter a player name or keyword to search all categories.
                  </div>
                )}
                {(senderFilter?.trim() || textFilter?.trim()) && globalLoading && (
                  <div style={{ textAlign:"center", opacity:0.4, padding:24, fontSize:13 }}>Searching…</div>
                )}
                {!globalLoading && globalMsgs.length===0 && (senderFilter?.trim()||textFilter?.trim()) && (
                  <div style={{ textAlign:"center", opacity:0.35, padding:24, fontSize:13 }}>No results across all categories.</div>
                )}
                {!globalLoading && globalMsgs.map((m, idx) => {
                  const sender = String(m?.sender||m?.Sender||"Unknown");
                  const tsIso  = m?.timestamp||m?.Timestamp;
                  const ts     = tsIso ? new Date(tsIso) : null;
                  const mode   = normalizeMode(m?.gameMode??m?.GameMode);
                  const isMod  = !!(m?.isModerator||m?.IsModerator);
                  const isPrem = !!(m?.Premium??m?.premium);
                  const isGild = !!(m?.Gilded??m?.gilded);
                  const inStorage = !!m?.senderInStorage;
                  return (
                    <div key={m.id??`gs-${idx}`} className="chatRow">
                      <div className="chatRowTop">
                        <div className="chatRowLeft">
                          <Link className="chatSender" to={`/players/${encodeURIComponent(sender.trim())}`}>{sender.trim()}</Link>
                          <span className="chatBadges">
                            <span style={{ fontSize:10, fontWeight:700, padding:"1px 5px", borderRadius:4,
                              background:"rgba(255,255,255,0.07)", color:"rgba(255,255,255,0.5)", marginRight:2 }}>
                              {m.category}
                            </span>
                            {isPrem ? <span className="badge">Premium</span> : null}
                            {isGild ? <span className="badge">Gilded</span> : null}
                            {isMod  ? <span className="badge">Mod</span> : null}
                            {mode   ? <span className="badge">{mode}</span> : null}
                            <span title={inStorage?"Player in storage":"Not in storage"}
                              style={{ display:"inline-block", width:6, height:6, borderRadius:"50%",
                              marginLeft:2, verticalAlign:"middle",
                              background: inStorage?"var(--success)":"rgba(255,255,255,0.2)" }} />
                          </span>
                        </div>
                        <span className="chatTime">{ts?formatAgo(ts):"—"}</span>
                      </div>
                      <div className="chatText">{String(m?.message||m?.Message||"")}</div>
                    </div>
                  );
                })}
                {globalHasMore && !globalLoading && (senderFilter?.trim()||textFilter?.trim()) && (
                  <div style={{ textAlign:"center", padding:12 }}>
                    <button className="btn" onClick={()=>loadGlobal({reset:false})}>Load more</button>
                  </div>
                )}
              </>
            )}

            {/* ── Per-category feed (normal mode) ────────────── */}
            {!globalSearch && loading && (
              <div style={{ textAlign:"center", opacity:0.4, padding:24, fontSize:13 }}>Loading…</div>
            )}

            {!globalSearch && !loading && msgs.length === 0 && (
              <div style={{ textAlign:"center", opacity:0.35, padding:24, fontSize:13 }}>No messages found.</div>
            )}

            {!globalSearch && !loading && groupedMsgs.map((item, idx) => {
              if (item.type === "divider"){
                return (
                  <div key={`divider-${item.date}`} style={{
                    display:"flex", alignItems:"center", gap:10, margin:"14px 0 8px",
                  }}>
                    <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.07)" }} />
                    <span style={{ fontSize:11, fontWeight:700, opacity:0.35, whiteSpace:"nowrap" }}>{item.date}</span>
                    <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.07)" }} />
                  </div>
                );
              }

              const m = item.msg;
              const sender    = String(m?.sender || m?.Sender || "Unknown");
              const tsIso     = m?.timestamp || m?.Timestamp;
              const ts        = tsIso ? new Date(tsIso) : null;
              const mode      = normalizeMode(m?.gameMode ?? m?.GameMode);
              const isMod     = !!(m?.isModerator || m?.IsModerator);
              const isPrem    = !!(m?.Premium ?? m?.premium);
              const isGild    = !!(m?.Gilded ?? m?.gilded);
              const inStorage = !!m?.senderInStorage;

              const timeTitle = [
                m?.receivedAt ? `Saved: ${m.receivedAt}` : null,
                inStorage ? `In storage: ${m?.playerUpdatedAt || "yes"}` : "Not in storage",
              ].filter(Boolean).join("\n");

              const isHighlighted = highlightedId && (String(m.id) === highlightedId);
              return (
                <div key={m.id ?? `${sender}-${tsIso}-${idx}`}
                  ref={el => { if (m.id != null) msgRefs.current[String(m.id)] = el; }}
                  className="chatRow"
                  style={ isHighlighted ? {
                    background:"rgba(var(--warning2-rgb),0.13)",
                    borderLeft:"3px solid rgba(var(--warning2-rgb),0.75)",
                  } : {}}>
                  <div className="chatRowTop">
                    <div className="chatRowLeft">
                      <Link className="chatSender" to={`/players/${encodeURIComponent(sender.trim())}`}>
                        {sender.trim()}
                      </Link>
                      <span className="chatBadges">
                        {isPrem ? <span className="badge">Premium</span> : null}
                        {isGild ? <span className="badge">Gilded</span> : null}
                        {isMod  ? <span className="badge">Mod</span> : null}
                        <span className="badge">{mode}</span>
                        {/* Storage indicator */}
                        <span
                          title={inStorage ? "Player in storage" : "Not in storage"}
                          style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", marginLeft:2, verticalAlign:"middle", background: inStorage ? "var(--success)" : "rgba(255,255,255,0.2)" }}
                        />
                      </span>
                    </div>
                    <span className="chatTime" title={timeTitle}>{ts ? formatAgo(ts) : "—"}</span>
                  </div>
                  <div className="chatText">{String(m?.message || m?.Message || "")}</div>
                </div>
              );
            })}

            </div>{/* end chatList */}

            {!globalSearch && msgs.length >= MAX_MSGS && hasMore && !loadingMore && (
              <div style={{ textAlign:"center", padding:"12px 0", fontSize:12, opacity:0.45 }}>
                Showing {MAX_MSGS} messages. Use <b>Jump to date</b> to go further back.
              </div>
            )}
            {!globalSearch && msgs.length < MAX_MSGS && <div ref={sentinelRef} style={{ height:1 }} />}
            {!globalSearch && loadingMore && (
              <div style={{ textAlign:"center", opacity:0.4, padding:12, fontSize:13 }}>Loading older messages…</div>
            )}
            {!globalSearch && !hasMore && msgs.length > 0 && !loading && (
              <div style={{ textAlign:"center", opacity:0.25, padding:16, fontSize:12 }}>
                — No more messages in this range —
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
