import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api, onBulkScanProgress, onChatMention, onChatScanStatus } from "../lib/bridge.js";
import { GameDataProvider } from "../lib/gameDataContext.jsx";

// ── Remote config (QR / announcement feature) ────────────────────────────────
const SENTINEL_CONFIG_URL = "";
const QR_POLL_MS          = 1 * 60 * 1000;

const MAX_TRIGGER_LEN = 32;

async function sha256Hex(text){
  const enc  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── QR Modal ──────────────────────────────────────────────────────────────────
function QrModal({ config, onClose }){
  useEffect(()=>{
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:99998,
        background:"rgba(0,0,0,0.65)", backdropFilter:"blur(4px)",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:"var(--card)", border:"1px solid var(--border)",
          borderRadius:16, padding:"28px 32px",
          display:"flex", flexDirection:"column", alignItems:"center",
          gap:16, minWidth:220, maxWidth:320,
          boxShadow:"0 8px 40px rgba(0,0,0,0.6)",
          animation:"toast-in 0.2s ease",
        }}
      >
        <div style={{ fontSize:15, fontWeight:700, opacity:0.9 }}>You Made It</div>

        {config.qrUrl && (
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(config.qrUrl)}&bgcolor=ffffff&color=000000&margin=4`}
            alt="Scan QR code"
            width={180} height={180}
            style={{ borderRadius:10, display:"block" }}
          />
        )}

        {config.qrText && (
          <div style={{ fontSize:13, opacity:0.75, textAlign:"center", lineHeight:1.6, whiteSpace:"pre-wrap", maxWidth:260 }}>
            {config.qrText}
          </div>
        )}

        <button
          className="btn"
          onClick={onClose}
          style={{ marginTop:4, fontSize:12, padding:"5px 20px" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// Generate a two-tone ping via Web Audio — no audio file needed.
function playMentionSound(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, start, dur, gain=0.18)=>{
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env); env.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.setValueAtTime(freq, start);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(gain, start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start); osc.stop(start + dur);
    };
    const t = ctx.currentTime;
    playTone(880, t, 0.18); playTone(1100, t + 0.1, 0.22);
  }catch{}
}

export default function Layout(){
  const loc = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Global bulk-scan progress (stays visible across pages)
  const [bulkScan, setBulkScan] = useState({ running:false, done:0, total:0, current:null, canceled:false, error:null });

  // Global chat scan status (stays visible across pages)
  const [chatScan, setChatScan] = useState({ running:false, nextRunAt:null, lastOkAt:null, lastError:null });

  // Global mention alerts — fires even when user is not on the Chat page
  const [mentionAlerts, setMentionAlerts] = useState([]);
  const mentionIdRef = useRef(0);

  // ── Remote config + keyword trigger ────────────────────────────────────────
  const [qrConfig,    setQrConfig]    = useState(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const keyBufferRef = useRef("");
  const keyTimerRef  = useRef(null);

  // Poll the Gist for config updates
  useEffect(()=>{
    let cancelled = false;
    async function fetchConfig(){
      try{
        const res  = await fetch(`${SENTINEL_CONFIG_URL}?_=${Date.now()}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setQrConfig({
          qrEnabled:    json?.qrEnabled !== false,
          qrTriggerHash: json?.qrTriggerHash
            ? String(json.qrTriggerHash).trim().toLowerCase()
            : null,
          qrUrl:  json?.qrUrl  ? String(json.qrUrl).trim()  : null,
          qrText: json?.qrText ? String(json.qrText).trim() : null,
        });
        // Legacy fallback: qrTrigger
        if (!cancelled && !json?.qrTriggerHash && json?.qrTrigger){
          const legacyHash = await sha256Hex(String(json.qrTrigger).trim().toLowerCase());
          setQrConfig(prev => prev ? { ...prev, qrTriggerHash: legacyHash } : prev);
        }
      }catch{}
    }
    fetchConfig();
    const id = setInterval(fetchConfig, QR_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Listen for the trigger word being typed anywhere — ignores input/textarea focus.
  useEffect(()=>{
    function onKeyDown(e){
      // Ignore if user is typing in an input, textarea, or contenteditable
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
      // Only listen to printable single characters
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      const targetHash = qrConfig?.qrTriggerHash;
      if (!targetHash || !qrConfig?.qrEnabled || (!qrConfig?.qrUrl && !qrConfig?.qrText)) return;

      // Append character to a fixed-size rolling buffer
      keyBufferRef.current = (keyBufferRef.current + e.key.toLowerCase()).slice(-MAX_TRIGGER_LEN);

      // Clear buffer after 2 seconds of inactivity
      if (keyTimerRef.current) clearTimeout(keyTimerRef.current);
      keyTimerRef.current = setTimeout(() => { keyBufferRef.current = ""; }, 2000);

      const buf = keyBufferRef.current;
      (async () => {
        for (let len = buf.length; len >= 1; len--){
          const suffix = buf.slice(buf.length - len);
          const h = await sha256Hex(suffix);
          if (h === targetHash){
            keyBufferRef.current = "";
            setQrModalOpen(true);
            return;
          }
        }
      })();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [qrConfig]);

  // Persist mention history to localStorage (last 50 entries)
  function saveMentionHistory(entry){
    try{
      const stored = JSON.parse(localStorage.getItem("chat_mentionHistory") || "[]");
      const updated = [entry, ...stored].slice(0, 50);
      localStorage.setItem("chat_mentionHistory", JSON.stringify(updated));
    }catch{}
  }

  // Mention alert duration (loaded from settings, default 12s)
  const [mentionAlertDurationMs, setMentionAlertDurationMs] = useState(12000);
  useEffect(()=>{
    api.getSettings?.().then(s=>{
      const secs = Math.max(5, Math.min(120, Number(s?.mentionAlertDurationSecs ?? 12)));
      setMentionAlertDurationMs(secs * 1000);
    }).catch(()=>{});
  }, []);

  useEffect(()=>{
    const unsub = onChatMention?.((hit)=>{
      if (!hit) return;
      const id = ++mentionIdRef.current;
      const entry = { id, ...hit, receivedAt: new Date().toISOString() };
      try{
        const soundOn = localStorage.getItem("chat_mentionSound") !== "0";
        if (soundOn) playMentionSound();
      }catch{}
      saveMentionHistory(entry);
      setMentionAlerts(prev => [entry, ...prev].slice(0, 5));
      setTimeout(()=> setMentionAlerts(prev => prev.filter(a => a.id !== id)), mentionAlertDurationMs);
    });
    return ()=>{ try{ unsub?.(); }catch{} };
  }, [mentionAlertDurationMs]); // eslint-disable-line

  // Auto-update banner
  const [updateInfo, setUpdateInfo] = useState(null); // { latest, downloadUrl, changelog }
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // Global market alerts — fires even when user is not on the Market page
  const [marketAlert, setMarketAlert] = useState(null);
  const marketAlertTimerRef = useRef(null);

  useEffect(()=>{
    const off = api.onMarketAlert?.((d)=>{
      if (!d) return;
      if (marketAlertTimerRef.current) clearTimeout(marketAlertTimerRef.current);
      playMentionSound();
      setMarketAlert(d);
      marketAlertTimerRef.current = setTimeout(()=> setMarketAlert(null), 10000);
    });
    return ()=>{ try{ off?.(); }catch{} };
  }, []); // eslint-disable-line

  useEffect(()=>{
    async function check(){
      try{
        const res = await api.appCheckForUpdate?.();
        if (res?.ok && res.hasUpdate) setUpdateInfo(res);
      }catch{}
    }
    // Initial check after 3s (don't block startup)
    const startup = setTimeout(check, 3000);
    // Re-check every hour
    const interval = setInterval(check, 60 * 60 * 1000);
    // Also check when the window regains focus (user comes back after update published)
    window.addEventListener("focus", check);
    return ()=>{ clearTimeout(startup); clearInterval(interval); window.removeEventListener("focus", check); };
  }, []); // eslint-disable-line

  useEffect(()=>{
    const unsub = onBulkScanProgress?.((p)=>{
      if (!p) return;
      setBulkScan({
        running: !!p.running,
        done: Number(p.done||0),
        total: Number(p.total||0),
        current: p.current ?? null,
        canceled: !!p.canceled,
        error: p.error ?? null,
      });
    });
    return ()=>{ try{ unsub?.(); }catch{} };
  }, []);

  useEffect(()=>{
    // initial load
    (async()=>{
      try{
        const s = await api.getChatScanStatus?.();
        if (s) setChatScan({
          running: !!s.running,
          nextRunAt: s.nextRunAt ?? null,
          lastOkAt: s.lastOkAt ?? null,
          lastError: s.lastError ?? null,
        });
      }catch{}
    })();
    const unsub = onChatScanStatus?.((s)=>{
      if (!s) return;
      setChatScan({
        running: !!s.running,
        nextRunAt: s.nextRunAt ?? null,
        lastOkAt: s.lastOkAt ?? null,
        lastError: s.lastError ?? null,
      });
    });
    return ()=>{ try{ unsub?.(); }catch{} };
  }, []);

  const formatBulkCurrent = (c)=>{
    if (!c) return "";
    if (typeof c === "string") return c;
    if (typeof c === "number") return String(c);
    if (typeof c === "object"){
      // Common shapes emitted by services scanAll()
      const et = c.entityType || c.type || "";
      const nm = c.name || c.username || c.clanName || c.entity || "";
      if (et && nm) return `${et === "player" ? "Player" : (et === "clan" ? "Clan" : et)}: ${nm}`;
      if (nm) return String(nm);
      if (c.label) return String(c.label);
      try{ return JSON.stringify(c); }catch{ return "[item]"; }
    }
    return String(c);
  };

  const bulkScanCurrentLabel = useMemo(()=>formatBulkCurrent(bulkScan.current), [bulkScan.current]);
const bulkScanPct = useMemo(()=>{
    const total = Number(bulkScan.total||0);
    const done = Number(bulkScan.done||0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done/total)*100)));
  }, [bulkScan.total, bulkScan.done]);

  const chatScanShown = !!(chatScan.running || chatScan.lastError || chatScan.lastOkAt);
  const bulkShown = !!(bulkScan.running || (bulkScan.total && bulkScan.done) || bulkScan.error || bulkScan.canceled);

  // Label the shared bulk-scan bar based on the emitting phase.
  // Name Matches emits phase === 'playersList'.
  const bulkTaskLabel = useMemo(() => {
    if (bulkScan?.label) return String(bulkScan.label);
    if (bulkScan?.phase === "playersList") return "Name match scan";
    if (bulkScan?.phase === "playersOnly") return "Scan players";
    if (bulkScan?.phase === "clansWithMembers") return "Scan clans";
    return "Scan all";
  }, [bulkScan?.label, bulkScan?.phase]);

  const fmtTime = (iso)=>{
    if (!iso) return "";
    try{
      const d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return "";
      return d.toLocaleString();
    }catch{ return ""; }
  };

  const title = loc.pathname.startsWith("/players") ? "Players"
    : loc.pathname.startsWith("/clans") ? "Clans"
    : loc.pathname.startsWith("/potential-clans") ? "Clan Log Leads"
    : loc.pathname.startsWith("/compare") ? "Compare"
    : loc.pathname.startsWith("/discover") ? "Search"
    : loc.pathname.startsWith("/leaderboards") ? "Leaderboards"
    : loc.pathname.startsWith("/chat") ? "Chat"
    : loc.pathname.startsWith("/name-matches") ? "Name Matches"
    : loc.pathname.startsWith("/cross-clan-matches") ? "Cross-Clan Matches"
    : loc.pathname.startsWith("/reports") ? "Reports"
    : loc.pathname.startsWith("/pvm-correlation") ? "PvM Correlation"
    : loc.pathname.startsWith("/cases") ? "Cases"
    : loc.pathname.startsWith("/clan-skill-signals") ? "Clan Skill Signals"
    : loc.pathname.startsWith("/player-inspector") ? "Player Inspector"
    : loc.pathname.startsWith("/market") ? "Market"
    : loc.pathname.startsWith("/my-accounts") ? "My Accounts"
    : loc.pathname.startsWith("/settings") ? "Settings"
    : loc.pathname.startsWith("/equipped-items") ? "Equipped Items"
    : loc.pathname.startsWith("/task-activity") ? "Task Activity"
    : loc.pathname.startsWith("/vault-leaderboard") ? "Vault Leaderboard"
    : "Home";

  const nl = (to, icon, label, end=false) => (
    <NavLink to={to} end={end} className={({isActive})=>isActive?"active":""} title={sidebarCollapsed ? label : undefined}>
      {sidebarCollapsed && <span className="navIcon">{icon}</span>}
      <span className="navLabel">{label}</span>
    </NavLink>
  );

  return (
    <div className={`appShell${sidebarCollapsed ? " sidebarCollapsed" : ""}`}>
      <aside className="sidebar">
        <button className="sidebarToggle" onClick={()=>setSidebarCollapsed(c=>!c)} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {sidebarCollapsed ? "→" : "←"}
        </button>

        <div className="brand">
          <img className="brandLogo" src={new URL("../assets/sentinel-logo.png", import.meta.url).toString()} alt="Idle Clans Sentinel logo" />
          <div>
            <div className="brandTitle">Idle Clans Sentinel</div>
            <div className="brandSub">Local profiles • Logs • Evidence</div>
          </div>
        </div>

        <nav className="nav">
          {nl("/", "🏠", "Home", true)}
          {nl("/my-accounts", "👤", "My Accounts")}

          <div className="navSection">Data</div>
          {nl("/discover",         "🔍", "Search")}
          {nl("/chat",             "💬", "Chat")}
          {nl("/players",          "👥", "Players")}
          {nl("/clans",            "🏰", "Clans")}
          {nl("/leaderboards",     "🎖️", "Leaderboards")}
          {nl("/player-inspector", "🔬", "Player Compare")}

          <div className="navSection">Extras</div>
          {nl("/vault-leaderboard", "🏆", "Vault Rankings")}
          {nl("/equipped-items",    "🛡️", "Equipped Items")}
          {nl("/task-activity",     "🛠️", "Task Activity")}
          {nl("/market",            "📈", "Market")}

          <div className="navSection">Investigate</div>
          {nl("/compare", "⚖️",  "Compare")}
          {nl("/cases",   "📁",  "Cases")}
          {nl("/reports", "📊",  "Reports")}

          <div className="navSection">Detection</div>
          {nl("/pvm-correlation",    "⚔️",  "PvM Correlation")}
          {nl("/cross-clan-matches", "🔗",  "Cross-Clan Matches")}
          {nl("/name-matches",       "📛",  "Name Matches")}
          {nl("/potential-clans",    "💡",  "Clan Log Leads")}
          {nl("/clan-skill-signals", "📉",  "Clan Skill Signals")}

          <div className="navSection">System</div>
          {nl("/settings", "⚙️", "Settings")}
        </nav>
      </aside>

      <div className="content">
        <div className="topBar">
          <div className="pageTitle">{title}</div>
        </div>
        <GameDataProvider>
          <Outlet />
        </GameDataProvider>

      </div>

      {chatScanShown ? (
        <div className="chatScanBar" style={{ bottom: bulkShown ? 60 : 0 }}>
          <div className="chatScanBarInner">
            <div className="bulkScanMeta">
              <div className="bulkScanTitle">
                {chatScan.running ? "Chat scan running" : (chatScan.lastError ? "Chat scan error" : "Chat scan idle")}
              </div>
              <div className="bulkScanSub">
                {chatScan.running && chatScan.nextRunAt ? `Next: ${fmtTime(chatScan.nextRunAt)}` : chatScan.running ? "Scanning…" : ""}
                {!chatScan.running && chatScan.lastOkAt ? `Last ok: ${fmtTime(chatScan.lastOkAt)}` : ""}
                {chatScan.lastError ? ` • ${chatScan.lastError}` : ""}
              </div>
            </div>

            <div className="bulkScanControls">
              {chatScan.running ? (
                <button className="btn btnGhost" onClick={()=>api.stopChatScan?.()}>
                  Stop
                </button>
              ) : (
                <button className="btn btnGhost" onClick={()=>api.startChatScan?.()}>
                  Start
                </button>
              )}
            </div>
          </div>
          <div className="bulkScanTrack">
            <div className="bulkScanFill" style={{ width: chatScan.running ? "40%" : "0%" }} />
          </div>
        </div>
      ) : null}

      {bulkShown ? (
        <div className="bulkScanBar">
          <div className="bulkScanBarInner">
            <div className="bulkScanMeta">
              <div className="bulkScanTitle">
                {bulkScan.running
                  ? `${bulkTaskLabel} running`
                  : (bulkScan.error
                    ? `${bulkTaskLabel} error`
                    : (bulkScan.canceled
                      ? `${bulkTaskLabel} canceled`
                      : `${bulkTaskLabel} finished`))}
              </div>
              <div className="bulkScanSub">
                {bulkScan.total ? `${bulkScan.done}/${bulkScan.total} • ${bulkScanPct}%` : (bulkScan.running ? "Starting…" : "Waiting for progress…")}
                {bulkScanCurrentLabel ? ` • ${bulkScanCurrentLabel}` : (bulkScan.message ? ` • ${bulkScan.message}` : "")}
              </div>
            </div>

            <div className="bulkScanControls">
              {bulkScan.running ? (
                <button className="btn btnGhost" onClick={()=>api.cancelScanAll?.()}>
                  Cancel
                </button>
              ) : (
                (bulkScan.total || bulkScan.error || bulkScan.canceled) ? (
                  <button className="btn btnGhost" onClick={()=>setBulkScan({ running:false, done:0, total:0, current:null, canceled:false, error:null })}>
                    Dismiss
                  </button>
                ) : null
              )}
            </div>
          </div>

          <div className="bulkScanTrack">
            <div className="bulkScanFill" style={{ width: `${bulkScanPct}%` }} />
          </div>
        </div>
      ) : null}

      {/* ── Update available banner ─────────────────────────────────────────── */}
      {updateInfo && !updateDismissed && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000,
          background: "linear-gradient(90deg, rgba(16,185,129,0.95), rgba(5,150,105,0.95))",
          backdropFilter: "blur(8px)",
          color: "#fff", display: "flex", alignItems: "center",
          padding: "10px 16px", gap: 12, fontSize: 13,
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        }}>
          <span style={{ fontSize: 18 }}></span>
          <div style={{ flex: 1 }}>
            <strong>Idle Clans Sentinel v{updateInfo.latest} is available</strong>
            {updateInfo.changelog && (
              <span style={{ opacity: 0.85, marginLeft: 8 }}>— {updateInfo.changelog}</span>
            )}
          </div>
          {updateInfo.downloadUrl && (
            <button
              onClick={()=>{ api.shellOpenExternal?.(updateInfo.downloadUrl); }}
              style={{
                background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
                color: "#fff", borderRadius: 6, padding: "5px 14px", cursor: "pointer",
                fontWeight: 600, fontSize: 12, whiteSpace: "nowrap",
              }}>
              Download
            </button>
          )}
          <button
            onClick={()=> setUpdateDismissed(true)}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.7)",
              cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px",
            }}
            title="Dismiss">✕</button>
        </div>
      )}

      {/* ── Global market price alerts — visible on any page ─────────────── */}
      {marketAlert && (
        <div style={{ position:"fixed", bottom: mentionAlerts.length > 0 ? `${16 + mentionAlerts.length * 80}px` : 16,
          right:16, zIndex:9999, maxWidth:380, transition:"bottom 0.2s ease" }}>
          <div style={{
            display:"flex", alignItems:"flex-start", gap:10,
            padding:"11px 14px", borderRadius:10,
            background:"rgba(15,30,15,0.97)",
            border:"1px solid rgba(var(--success-rgb),0.35)",
            boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
            animation:"fadeIn 0.15s ease",
          }}>
            <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>📉</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"var(--success)", marginBottom:2 }}>
                Market alert — {marketAlert.count} item{marketAlert.count !== 1 ? "s" : ""} below avg by ≥{marketAlert.pct}%
              </div>
              <div style={{ fontSize:11, opacity:0.55 }}>
                Check the Market page for details.
              </div>
            </div>
            <button onClick={()=>setMarketAlert(null)}
              style={{ background:"none", border:"none", cursor:"pointer",
                opacity:0.4, fontSize:16, padding:"0 2px", lineHeight:1, flexShrink:0, color:"inherit" }}>
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Global mention alerts — visible on any page ───────────────────── */}
      {mentionAlerts.length > 0 && (
        <div style={{ position:"fixed", bottom:16, right:16, zIndex:9999,
          display:"flex", flexDirection:"column", gap:8, maxWidth:380 }}>
          {mentionAlerts.map(alert => {
            const isKeyword = !!alert.keyword;
            const borderCol = isKeyword ? "rgba(var(--info-rgb),0.35)" : "rgba(var(--warning2-rgb),0.35)";
            const labelCol  = isKeyword ? "var(--info)" : "var(--warning2)";
            const icon      = isKeyword ? "🔍" : "🔔";
            return (
              <div key={alert.id} style={{
                display:"flex", alignItems:"flex-start", gap:10,
                padding:"11px 14px", borderRadius:10,
                background:"rgba(15,30,15,0.97)",
                border:`1px solid ${borderCol}`,
                boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
                animation:"fadeIn 0.15s ease",
              }}>
                <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{icon}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:labelCol, marginBottom:2 }}>
                    {isKeyword
                      ? <><b>"{alert.keyword}"</b> mentioned in {alert.category} by {alert.senderName}</>
                      : <><b>{alert.accountName}</b> mentioned in {alert.category}<span style={{ fontWeight:400, opacity:0.6 }}> by {alert.senderName}</span></>
                    }
                  </div>
                  <div style={{ fontSize:11, opacity:0.65, fontFamily:"ui-monospace,monospace",
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {alert.message}
                  </div>
                </div>
                <button onClick={()=>setMentionAlerts(prev=>prev.filter(a=>a.id!==alert.id))}
                  style={{ background:"none", border:"none", cursor:"pointer",
                    opacity:0.4, fontSize:16, padding:"0 2px", lineHeight:1, flexShrink:0, color:"inherit" }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── QR / Announcement modal — triggered by keyword ─────────────────── */}
      {qrModalOpen && qrConfig && (
        <QrModal config={qrConfig} onClose={()=>setQrModalOpen(false)} />
      )}

    </div>
  );

}