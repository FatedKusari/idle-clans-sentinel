import React, { useEffect, useState } from "react";
import { api, onStaleRefreshProgress } from "../lib/bridge.js";
import { useGameData } from "../lib/gameDataContext.jsx";


function fmtBytes(bytes){
  const b = Number(bytes||0);
  if (!isFinite(b) || b <= 0) return "0 B";
  const units = ["B","KB","MB","GB"];
  const i = Math.min(Math.floor(Math.log(b)/Math.log(1024)), units.length-1);
  const v = b / Math.pow(1024, i);
  return `${v.toFixed(v>=100?0:v>=10?1:2)} ${units[i]}`;
}

function fmtTime(iso){
  if (!iso) return "—";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return String(iso);
  return d.toLocaleString();
}


function Section({ title, info, children }){
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
        textTransform: "uppercase", opacity: 0.45, marginBottom: 10,
        display:"flex", alignItems:"center", gap:6,
      }}>
        {title}
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, hint, info, children }){
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, padding: "10px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, display:"flex", alignItems:"center", gap:6 }}>
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        {hint && <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// Small "?" badge that shows tooltip on hover/focus.
function InfoTip({ children }){
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position:"relative", display:"inline-flex" }}
      onMouseEnter={()=>setOpen(true)}
      onMouseLeave={()=>setOpen(false)}
    >
      <span
        tabIndex={0}
        onFocus={()=>setOpen(true)}
        onBlur={()=>setOpen(false)}
        style={{
          display:"inline-flex", alignItems:"center", justifyContent:"center",
          width:14, height:14, borderRadius:"50%", fontSize:10, fontWeight:800,
          lineHeight:1, cursor:"help", flexShrink:0,
          background:"rgba(255,255,255,0.10)", color:"rgba(255,255,255,0.55)",
          border:"1px solid rgba(255,255,255,0.15)",
        }}
        aria-label="More info"
      >
        ?
      </span>
      {open && (
        <div style={{
          position:"absolute", bottom:"calc(100% + 6px)", left:0, zIndex:40,
          width:240, padding:"8px 10px", borderRadius:8, fontSize:12, fontWeight:400,
          lineHeight:1.4, color:"rgba(255,255,255,0.85)",
          background:"#1a1a1f", border:"1px solid rgba(255,255,255,0.12)",
          boxShadow:"0 8px 24px rgba(0,0,0,0.4)",
          whiteSpace:"normal",
        }}>
          {children}
        </div>
      )}
    </span>
  );
}

function Toggle({ checked, onChange, disabled }){
  return (
    <label style={{ position: "relative", display: "inline-flex", alignItems: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
      <div style={{
        width: 40, height: 22, borderRadius: 11,
        background: checked ? "var(--accent, #2563eb)" : "rgba(255,255,255,0.12)",
        transition: "background 0.2s",
        position: "relative",
      }}>
        <div style={{
          position: "absolute", top: 3, left: checked ? 21 : 3,
          width: 16, height: 16, borderRadius: "50%",
          background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </div>
    </label>
  );
}

function NumInput({ value, onChange, min, max, width = 90, disabled }){
  return (
    <input
      className="input"
      type="number"
      min={min} max={max}
      value={value}
      disabled={disabled}
      onChange={onChange}
      style={{ width, textAlign: "right" }}
    />
  );
}


const TABS = [
  { id: "general",    label: "General" },
  { id: "automation", label: "Automation" },
  { id: "alerts",     label: "Alerts" },
  { id: "database",   label: "Database" },
  { id: "scheduler",  label: "Scheduler" },
];


function CloseBehaviourSetting(){
  const [pref, setPref] = React.useState("ask");

  React.useEffect(()=>{
    window.idleclans?.getCloseBehaviour?.().then(v => setPref(v || "ask")).catch(()=>{});
  }, []);

  function choose(id){
    setPref(id);
    try{ window.idleclans?.setCloseBehaviour?.(id); }catch{}
  }

  const OPTIONS = [
    { id:"ask",  label:"Ask every time" },
    { id:"tray", label:"Always minimise to tray" },
    { id:"quit", label:"Always quit" },
  ];

  return (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
      {OPTIONS.map(o => (
        <button key={o.id} onClick={()=>choose(o.id)} style={{
          padding:"6px 14px", borderRadius:20, cursor:"pointer", fontSize:13,
          border: pref===o.id
            ? "1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.5)"
            : "1px solid var(--border)",
          background: pref===o.id
            ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.12)"
            : "rgba(var(--dk),0.08)",
          color: pref===o.id ? "var(--text)" : "var(--muted)",
          fontWeight: pref===o.id ? 700 : 400,
        }}>{o.label}</button>
      ))}
    </div>
  );
}

export default function SettingsPage(){
  const { info: gameDataInfo, refresh: refreshGameData } = useGameData();

  const [tab, setTab] = useState("general");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Theme ────────────────────────────────────────────────────────────────
  const THEMES = [
    { id:"origreen",   label:"Original Green",   dot:"#22c55e" },
    { id:"midnight", label:"Midnight", dot:"#3b82f6" },
    { id:"crimson",  label:"Crimson",  dot:"#ef4444" },
    { id:"void",     label:"Void",     dot:"#8b5cf6" },
    { id:"amber",    label:"Amber",    dot:"var(--warning)" },
  ];
  const [theme, setTheme] = useState(()=>{
    try{ return localStorage.getItem("app_theme") || "origreen"; }catch{ return "origreen"; }
  });
  const [lightMode, setLightMode] = useState(()=>{
    try{ return localStorage.getItem("app_light") === "1"; }catch{ return false; }
  });
  useEffect(()=>{
    const t = theme === "origreen" ? null : theme;
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    try{ localStorage.setItem("app_theme", theme); }catch{}
  }, [theme]);
  useEffect(()=>{
    if (lightMode) document.documentElement.setAttribute("data-light", "");
    else document.documentElement.removeAttribute("data-light");
    try{ localStorage.setItem("app_light", lightMode ? "1" : "0"); }catch{}
  }, [lightMode]);
  const [gameBusy, setGameBusy] = useState(false);
  const [gameMsg, setGameMsg] = useState("");

  const [dbInfo, setDbInfo] = useState({ path: "", sizeBytes: 0 });
  const [dbBreakdown, setDbBreakdown] = useState(null);
  const [dbBreakdownBusy, setDbBreakdownBusy] = useState(false);
  const [dbBreakdownError, setDbBreakdownError] = useState(null);
  const [dbBreakdownOpen, setDbBreakdownOpen] = useState(false);

  const [pvmSampleStats, setPvmSampleStats] = useState({ totalSamples: 0, maxSamplesPerPlayer: 0 });

  const [schedOpen, setSchedOpen] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);
  const [sched, setSched] = useState(null);
  const [stalePending, setStalePending] = useState(null); // null = not yet loaded
  const [staleStatus, setStaleStatus] = useState({
    running: false, total: 0, remaining: 0, current: null, lastRunAt: null, lastCount: 0, nextRunAt: null,
  });

  const [settings, setSettings] = useState({
    apiCallsPerMinute: 15,
    trackIntervalMinutes: 10,
    chatScanIntervalMinutes: 2,
    dormantThresholdDays: 14,
    accountSnapshotHours: 6,
    serverInfoEnabled: true,
    serverInfoPollSeconds: 60,
    serverInfoShowAddresses: false,
    marketPollMinutes: 15,
    marketAlertPct: 5,
    newsPollHours: 6,
    pvmSnapshotTime: "02:00",
    pvmSampleRetentionDays: 14,
    alertsEnabled: true,
    alertInactiveDays: 7,
    alertJoinLeaveEnabled: true,
    alertsOnlyTracked: true,
    gameDataAutoUpdate: false,
    gameDataMaxAgeDays: 7,
    autoRefreshStaleEnabled: false,
    autoRefreshStaleDays: 7,
    autoRefreshWaveSize: 100,
    autoRefreshIntervalMinutes: 30,
    backupsEnabled: true,
    backupsCustomDir: "",
    backupsKeepNumbered: 3,
    backupsKeepDays: 3,
    mentionAlertDurationSecs: 12,
  });

  const set = (key, val) => setSettings(s => ({ ...s, [key]: val }));

  const [rateStats, setRateStats] = useState({ configuredPerMin:null, observedPerMin:null, minDelayMs:null, recentCalls:0, lastCallAt:null });
  useEffect(()=>{
    let alive = true;
    async function poll(){
      try{
        const s = await api.getApiRateStats?.();
        if (alive && s) setRateStats(s);
      }catch{}
    }
    poll();
    const t = setInterval(poll, 3000);
    return ()=>{ alive=false; clearInterval(t); };
  }, []);

  async function load(){
    setDbInfo(await api.getDbInfo());
    const s = await api.getSettings();
    setSettings({
      apiCallsPerMinute:      Number(s.apiCallsPerMinute ?? 15),
      trackIntervalMinutes:   Number(s.trackIntervalMinutes ?? 10),
      chatScanIntervalMinutes: Math.max(1, Math.min(60, Number(s.chatScanIntervalMinutes ?? 2))),
      mentionAlertDurationSecs: Math.max(5, Math.min(120, Number(s.mentionAlertDurationSecs ?? 12))),
      dormantThresholdDays:    Math.max(1, Math.min(365, Number(s.dormantThresholdDays ?? 14))),
      accountSnapshotHours:    Math.max(0, Math.min(168, Number(s.accountSnapshotHours ?? 6))),
      serverInfoEnabled:      String(s.serverInfoEnabled ?? "1") !== "0",
      serverInfoPollSeconds:  Number(s.serverInfoPollSeconds ?? 60),
      serverInfoShowAddresses:("serverInfoShowAddresses" in (s||{}))
        ? String(s.serverInfoShowAddresses ?? "0") !== "0"
        : String(s.serverInfoMaskIp ?? "1") === "0",
      marketPollMinutes:      Math.max(0, Number(s.marketPollMinutes ?? 15)),
      marketAlertPct:         Math.max(0, Number(s.marketAlertPct ?? 5)),
      newsPollHours:          Math.max(1, Number(s.newsPollHours ?? 6)),
      pvmSnapshotTime:        String(s.pvmSnapshotTime ?? "02:00"),
      pvmSampleRetentionDays: Number(s.pvmSampleRetentionDays ?? 14),
      alertsEnabled:          String(s.alertsEnabled ?? "1") !== "0",
      alertInactiveDays:      Number(s.alertInactiveDays ?? 7),
      alertJoinLeaveEnabled:  String(s.alertJoinLeaveEnabled ?? "1") !== "0",
      alertsOnlyTracked:      String(s.alertsOnlyTracked ?? "1") !== "0",
      gameDataAutoUpdate:     String(s.gameDataAutoUpdate ?? "0") === "1",
      gameDataMaxAgeDays:     Number(s.gameDataMaxAgeDays ?? 7),
      autoRefreshStaleEnabled:String(s.autoRefreshStaleEnabled ?? "0") === "1",
      autoRefreshStaleDays:   Number(s.autoRefreshStaleDays ?? 7),
      autoRefreshWaveSize:    Math.max(1, Number(s.autoRefreshWaveSize ?? 100)),
      autoRefreshIntervalMinutes: Math.max(1, Number(s.autoRefreshIntervalMinutes ?? 30)),
      backupsEnabled:         String(s.backupsEnabled ?? "1") !== "0",
      backupsCustomDir:       String(s.backupsCustomDir ?? ""),
      backupsKeepNumbered:    Math.max(1, Math.min(10, Number(s.backupsKeepNumbered ?? 3) || 3)),
      backupsKeepDays:        Math.max(0, Math.min(30, Number(s.backupsKeepDays ?? 3) || 3)),
    });
    try{
      setPvmSampleStats(await api.getPvmSampleStats?.() || { totalSamples: 0, maxSamplesPerPlayer: 0 });
    }catch{}
  }

  async function save(){
    setBusy(true);
    try{
      const pairs = [
        ["apiCallsPerMinute",      String(settings.apiCallsPerMinute)],
        ["trackIntervalMinutes",   String(settings.trackIntervalMinutes)],
        ["chatScanIntervalMinutes", String(settings.chatScanIntervalMinutes)],
        ["mentionAlertDurationSecs",  String(settings.mentionAlertDurationSecs)],
        ["dormantThresholdDays",    String(settings.dormantThresholdDays)],
        ["accountSnapshotHours",     String(settings.accountSnapshotHours)],
        ["serverInfoEnabled",      settings.serverInfoEnabled ? "1" : "0"],
        ["serverInfoPollSeconds",  String(settings.serverInfoPollSeconds)],
        ["serverInfoShowAddresses",settings.serverInfoShowAddresses ? "1" : "0"],
        ["marketPollMinutes",        String(settings.marketPollMinutes)],
        ["marketAlertPct",           String(settings.marketAlertPct)],
        ["newsPollHours",           String(settings.newsPollHours)],
        ["pvmSnapshotTime",        String(settings.pvmSnapshotTime || "02:00")],
        ["pvmSampleRetentionDays", String(settings.pvmSampleRetentionDays || 14)],
        ["alertsEnabled",          settings.alertsEnabled ? "1" : "0"],
        ["alertInactiveDays",      String(settings.alertInactiveDays)],
        ["alertJoinLeaveEnabled",  settings.alertJoinLeaveEnabled ? "1" : "0"],
        ["alertsOnlyTracked",      settings.alertsOnlyTracked ? "1" : "0"],
        ["gameDataAutoUpdate",     settings.gameDataAutoUpdate ? "1" : "0"],
        ["gameDataMaxAgeDays",     String(settings.gameDataMaxAgeDays)],
        ["autoRefreshStaleEnabled",settings.autoRefreshStaleEnabled ? "1" : "0"],
        ["autoRefreshStaleDays",   String(settings.autoRefreshStaleDays)],
        ["autoRefreshWaveSize",    String(settings.autoRefreshWaveSize)],
        ["autoRefreshIntervalMinutes", String(settings.autoRefreshIntervalMinutes)],
        ["backupsEnabled",         settings.backupsEnabled ? "1" : "0"],
        ["backupsCustomDir",       String(settings.backupsCustomDir ?? "")],
        ["backupsKeepNumbered",    String(settings.backupsKeepNumbered)],
        ["backupsKeepDays",        String(settings.backupsKeepDays)],
      ];
      for (const [k, v] of pairs) await api.setSetting(k, v);
      await api.marketRestartPoll();
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  }

  async function wipe(){
    if (!confirm("Delete ALL local data? This cannot be undone.")) return;
    await api.deleteAllData();
    await load();
  }

  async function updateGameDataNow(){
    setGameBusy(true);
    setGameMsg("");
    try{
      const r = await refreshGameData({ force: true });
      setGameMsg(r?.ok ? `Updated — ${Number(r.itemCount||0).toLocaleString()} items` : "Update finished.");
    }catch(err){ setGameMsg(String(err?.message||err)); }
    finally { setGameBusy(false); }
  }

  async function loadScheduler(){
    setSchedBusy(true);
    try{ setSched(await api.getSchedulerStatus?.() || null); }
    catch(err){ setSched({ ok: false, error: String(err?.message||err) }); }
    finally { setSchedBusy(false); }
  }

  async function loadStalePending(){
    try{
      const s = await api.getSettings();
      const staleDays = Math.max(1, Number(s?.autoRefreshStaleDays ?? 7));
      const r = await api.getStaleEntities?.({ staleDays, limit: 999999 });
      if (r) setStalePending((r.players?.length || 0) + (r.clans?.length || 0));
    }catch{}
  }

  async function loadDbBreakdown(){
    if (dbBreakdownBusy) return;
    setDbBreakdownBusy(true);
    setDbBreakdownError(null);
    try{
      const r = await api.getStorageBreakdown?.();
      if (r?.ok) setDbBreakdown(r);
      else setDbBreakdownError(r?.error || "Failed to load breakdown");
    }catch(err){ setDbBreakdownError(String(err?.message||err)); }
    finally { setDbBreakdownBusy(false); }
  }

  useEffect(() => {
    load();
    api.getStaleRefreshStatus?.().then(s => { if (s) setStaleStatus(s); }).catch(() => {});
    // Subscribe to live progress events
    const unsub = onStaleRefreshProgress?.((s) => {
      if (s) setStaleStatus(prev => {
        // When a run finishes, refresh the pending count so it reflects new count
        if (prev.running && !s.running) loadStalePending();
        return s;
      });
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!schedOpen) return;
    loadScheduler();
    loadStalePending();
    const t = setInterval(loadScheduler, 2000);
    return () => clearInterval(t);
  }, [schedOpen]);

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 16px", fontSize: 14, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "var(--accent, #60a5fa)" : "rgba(255,255,255,0.5)",
              borderBottom: tab === t.id ? "2px solid var(--accent, #60a5fa)" : "2px solid transparent",
              marginBottom: -1, transition: "color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div>
          <Section title="Appearance">
            <Row label="Colour theme" hint="Sets the accent colour. Takes effect immediately.">
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {THEMES.map(t=>(
                  <button key={t.id} onClick={()=>setTheme(t.id)} style={{
                    display:"flex", alignItems:"center", gap:7,
                    padding:"6px 14px", borderRadius:20, cursor:"pointer", fontSize:13,
                    border: theme===t.id ? `1px solid ${t.dot}` : "1px solid var(--border)",
                    background: theme===t.id ? `${t.dot}22` : "rgba(var(--dk),0.08)",
                    color: theme===t.id ? t.dot : "var(--muted)",
                    fontWeight: theme===t.id ? 700 : 400,
                  }}>
                    <span style={{ width:10, height:10, borderRadius:"50%",
                      background:t.dot, flexShrink:0, display:"inline-block" }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Mode" hint="Dark is near-black; Light is white/grey. Works with any colour theme.">
              <div style={{ display:"flex", gap:8 }}>
                {[{id:false,label:"🌙 Dark"},{id:true,label:"☀️ Light"}].map(m=>(
                  <button key={String(m.id)} onClick={()=>setLightMode(m.id)} style={{
                    padding:"6px 18px", borderRadius:20, cursor:"pointer", fontSize:13,
                    border: lightMode===m.id ? "1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.5)" : "1px solid var(--border)",
                    background: lightMode===m.id ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.12)" : "rgba(var(--dk),0.08)",
                    color: lightMode===m.id ? "var(--text)" : "var(--muted)",
                    fontWeight: lightMode===m.id ? 700 : 400,
                  }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </Row>
          </Section>
          <Section title="Window behaviour">
            <Row label="When closing the window" hint="Controls what happens when you click the × button. Change this if you ticked 'Remember my choice' and want to switch.">
              <CloseBehaviourSetting />
            </Row>
          </Section>
          <Section title="API">
            <Row label="Calls per minute" hint="Max API requests Sentinel makes per minute. Lower = safer, higher = faster scans.">
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <NumInput value={settings.apiCallsPerMinute} min={1} max={60}
                  onChange={e => set("apiCallsPerMinute", e.target.value)} />
                <span style={{ fontSize:12, opacity:0.45 }}>
                  ≈ {Math.ceil(60000 / Math.max(1, Number(settings.apiCallsPerMinute||15)))}s between calls
                </span>
              </div>
            </Row>
            <Row label="Observed rate" hint="Calls/min seen across all running scans (bulk, tracked, stale, chat) over the last 2 minutes. Updates every 3 seconds.">
              {rateStats.lastCallAt ? (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:15, fontWeight:700 }}>{rateStats.observedPerMin.toFixed(1)}</span>
                  <span style={{ fontSize:12, opacity:0.5 }}>calls/min</span>
                  <span style={{ fontSize:12, opacity:0.35 }}>({rateStats.recentCalls} calls / 2min window)</span>
                </div>
              ) : (
                <span style={{ fontSize:13, opacity:0.35, fontStyle:"italic" }}>No API calls in last 2 min</span>
              )}
            </Row>
            <Row label="Flag refresh interval" hint="How often flagged players and clans are auto-refreshed.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.trackIntervalMinutes} min={1} max={1440}
                  onChange={e => set("trackIntervalMinutes", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>min</span>
              </div>
            </Row>
            <Row label="Chat scan interval" hint="How often the chat scanner fetches new messages. Lower = more frequent but uses more API calls. Takes effect on the next scan cycle — no restart needed. Minimum 1 min.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.chatScanIntervalMinutes} min={1} max={60}
                  onChange={e => set("chatScanIntervalMinutes", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>min</span>
              </div>
            </Row>
            <Row label="Mention alert duration" hint="How long a mention notification stays on screen before auto-dismissing. 5–120 seconds.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.mentionAlertDurationSecs} min={5} max={120}
                  onChange={e => set("mentionAlertDurationSecs", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>sec</span>
              </div>
            </Row>
          </Section>

          <Section title="PvM tracking">
            <Row label="Daily snapshot time" hint="When Sentinel takes the daily PvM baseline snapshot.">
              <input className="input" type="time" value={settings.pvmSnapshotTime}
                onChange={e => set("pvmSnapshotTime", e.target.value)}
                style={{ width: 110, textAlign: "right" }} />
            </Row>
            <Row label="Sample retention" hint={`${Number(pvmSampleStats?.totalSamples||0).toLocaleString()} samples stored • max ${Number(pvmSampleStats?.maxSamplesPerPlayer||0).toLocaleString()} per player. Lowering prunes on save.`}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.pvmSampleRetentionDays} min={1} max={365}
                  onChange={e => set("pvmSampleRetentionDays", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>days</span>
              </div>
            </Row>
          </Section>

          <Section title="Homepage server status">
            <Row label="Enable server status check" hint="Polls /api/Startup/info to show load, availability and build info.">
              <Toggle checked={settings.serverInfoEnabled}
                onChange={e => set("serverInfoEnabled", e.target.checked)} />
            </Row>
            <Row label="Poll interval" hint="How often to check server status.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.serverInfoPollSeconds} min={10} max={3600}
                  disabled={!settings.serverInfoEnabled}
                  onChange={e => set("serverInfoPollSeconds", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>sec</span>
              </div>
            </Row>
            <Row label="Show server addresses" hint="Display IP addresses on the homepage server panel.">
              <Toggle checked={settings.serverInfoShowAddresses}
                disabled={!settings.serverInfoEnabled}
                onChange={e => set("serverInfoShowAddresses", e.target.checked)} />
            </Row>
            <Row label="Game news refresh" hint="How often the homepage fetches the latest game news. Set to 0 to disable auto-refresh.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.newsPollHours} min={0} max={168}
                  onChange={e => set("newsPollHours", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>hours (0 = manual only)</span>
              </div>
            </Row>
          </Section>

          <Section title="Market">
            <Row label="Auto-refresh interval" hint="How often market prices are fetched in the background (0 = manual only). Changes take effect immediately when saved.">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <NumInput value={settings.marketPollMinutes} min={0} max={1440}
                  onChange={e => set("marketPollMinutes", e.target.value)} />
                <span style={{ opacity:0.5, fontSize:13 }}>min</span>
              </div>
            </Row>
            <Row label="Profitable alert threshold" hint="Play a sound and show a notification when any item's profit margin reaches this % (0 = disabled). Uses game sell price vs market buy price.">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <NumInput value={settings.marketAlertPct} min={0} max={100}
                  onChange={e => set("marketAlertPct", e.target.value)} />
                <span style={{ opacity:0.5, fontSize:13 }}>% (0 = off)</span>
              </div>
            </Row>
          </Section>

          <Section title="Game data">
            <Row
              label="Status"
              hint={gameDataInfo?.path ? `Path: ${gameDataInfo.path}` : undefined}
            >
              <span style={{ fontSize: 13, opacity: 0.8 }}>
                {gameDataInfo?.ok
                  ? `${Number(gameDataInfo.itemCount||0).toLocaleString()} items loaded`
                  : "Not loaded"}
              </span>
            </Row>
            <Row label="Last updated">
              <span style={{ fontSize: 12, opacity: 0.6 }}>{gameDataInfo?.updatedAt || "—"}</span>
            </Row>
            <Row label="Auto-update on start" hint={`Refresh if data is older than ${settings.gameDataMaxAgeDays} days.`}>
              <Toggle checked={settings.gameDataAutoUpdate}
                onChange={e => set("gameDataAutoUpdate", e.target.checked)} />
            </Row>
            <Row label="Max age before auto-update">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.gameDataMaxAgeDays} min={1} max={365}
                  disabled={!settings.gameDataAutoUpdate}
                  onChange={e => set("gameDataMaxAgeDays", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>days</span>
              </div>
            </Row>
            {gameDataInfo?.error && (
              <div style={{ fontSize: 12, color: "#ffb3b3", padding: "6px 0" }}>{String(gameDataInfo.error)}</div>
            )}
          </Section>

          <SaveBar busy={busy} saved={saved} onSave={save}>
            <button className="btn" onClick={updateGameDataNow} disabled={gameBusy}>
              {gameBusy ? "Updating…" : "Update game data now"}
            </button>
            {gameMsg && <span style={{ fontSize: 12, opacity: 0.7 }}>{gameMsg}</span>}
          </SaveBar>
        </div>
      )}

      {/* ── AUTOMATION tab ────────────────────────────────────────────────── */}
      {tab === "automation" && (
        <div>
          <Section title="Auto-refresh stale data">
            <Row label="Enable auto-refresh" hint="Checks every 30 min for players and clans not updated within the threshold. Runs in background, respects API rate limit, skips during bulk scans.">
              <Toggle checked={settings.autoRefreshStaleEnabled}
                onChange={e => set("autoRefreshStaleEnabled", e.target.checked)} />
            </Row>
            <Row label="Stale threshold" hint="Entities not updated within this many days will be queued for refresh.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.autoRefreshStaleDays} min={1} max={365}
                  disabled={!settings.autoRefreshStaleEnabled}
                  onChange={e => set("autoRefreshStaleDays", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>days</span>
              </div>
            </Row>
            <Row label="Wave size" hint="How many players and clans to refresh per run (split evenly between players and clans).">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.autoRefreshWaveSize} min={1} max={5000}
                  disabled={!settings.autoRefreshStaleEnabled}
                  onChange={e => set("autoRefreshWaveSize", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>entities</span>
              </div>
            </Row>
            <Row label="Interval between runs" hint="How long to wait between each wave. Shorter = faster coverage but more API usage.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.autoRefreshIntervalMinutes} min={1} max={1440}
                  disabled={!settings.autoRefreshStaleEnabled}
                  onChange={e => set("autoRefreshIntervalMinutes", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>min</span>
              </div>
            </Row>
          </Section>

          <Section title="Dormant players">
            <Row label="Dormant threshold" hint="Players offline for at least this many days are automatically marked dormant and excluded from full scans and stale refresh. They appear in Reports → Dormant for manual review and re-scanning.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.dormantThresholdDays} min={1} max={365}
                  onChange={e => set("dormantThresholdDays", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>days</span>
              </div>
            </Row>
          </Section>

          <Section title="Linked account snapshots">
            <Row label="Auto-snapshot interval" hint="How often Sentinel automatically takes a skill snapshot for each linked account. Snapshots read from the last stored scan — make sure the account is scanned regularly. Set to 0 to disable.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.accountSnapshotHours} min={0} max={168}
                  onChange={e => set("accountSnapshotHours", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>hrs (0 = off)</span>
              </div>
            </Row>
          </Section>

          <SaveBar busy={busy} saved={saved} onSave={save} />
        </div>
      )}

      {/* ── ALERTS tab ────────────────────────────────────────────────────── */}
      {tab === "alerts" && (
        <div>
          <Section title="Alert settings">
            <Row label="Enable alerts" hint="Generate alerts during tracked refreshes and clan member scans.">
              <Toggle checked={settings.alertsEnabled}
                onChange={e => set("alertsEnabled", e.target.checked)} />
            </Row>
            <Row label="Only for flagged entities" hint="When on, alerts are only generated for players and clans you have flagged.">
              <Toggle checked={settings.alertsOnlyTracked}
                disabled={!settings.alertsEnabled}
                onChange={e => set("alertsOnlyTracked", e.target.checked)} />
            </Row>
            <Row label="Inactivity threshold" hint="Alert when a tracked player hasn't been online for this many days.">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <NumInput value={settings.alertInactiveDays} min={1} max={365}
                  disabled={!settings.alertsEnabled}
                  onChange={e => set("alertInactiveDays", e.target.value)} />
                <span style={{ opacity: 0.5, fontSize: 13 }}>days</span>
              </div>
            </Row>
            <Row label="Alert on clan joins / leaves" hint="Create an alert when a member joins or leaves a tracked clan.">
              <Toggle checked={settings.alertJoinLeaveEnabled}
                disabled={!settings.alertsEnabled}
                onChange={e => set("alertJoinLeaveEnabled", e.target.checked)} />
            </Row>
          </Section>

          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 20 }}>
            View alerts in <b>Reports → Alerts</b>.
          </div>

          <SaveBar busy={busy} saved={saved} onSave={save} />
        </div>
      )}

      {/* ── DATABASE tab ──────────────────────────────────────────────────── */}
      {tab === "database" && (
        <div>
          <Section title="Storage">
            <Row label="Database path">
              <span style={{ fontSize: 11, opacity: 0.6, maxWidth: 320, textAlign: "right", wordBreak: "break-all" }}>
                {dbInfo.path || "—"}
              </span>
            </Row>
            <Row label="Database size">
              <span style={{ fontSize: 13, opacity: 0.8 }}>
                {dbInfo.sizeBytes ? `${Math.round(dbInfo.sizeBytes/1024).toLocaleString()} KB` : "—"}
              </span>
            </Row>
          </Section>

          <Section title="Storage breakdown">
            <div style={{ marginBottom: 10 }}>
              <button
                className="btn"
                onClick={async () => {
                  setDbBreakdownOpen(o => !o);
                  if (!dbBreakdownOpen && !dbBreakdown && !dbBreakdownBusy) await loadDbBreakdown();
                }}
              >
                {dbBreakdownOpen ? "Hide breakdown" : "Show breakdown"}
              </button>
            </div>

            {dbBreakdownOpen && (
              <>
                {dbBreakdownBusy && <div style={{ opacity: 0.7, padding: "8px 0" }}>Loading…</div>}
                {dbBreakdownError && <div style={{ color: "#ffb3b3", fontSize: 13 }}>Error: {dbBreakdownError}</div>}
                {!dbBreakdownBusy && dbBreakdown?.ok && (
                  <>
                    <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 8 }}>
                      {dbBreakdown.tables?.length || 0} tables
                      {dbBreakdown.totalBytes != null ? ` • Est. ${fmtBytes(dbBreakdown.totalBytes)}` : ""}
                      {dbBreakdown.warning ? ` • ${dbBreakdown.warning}` : ""}
                    </div>
                    <div style={{ maxHeight: 280, overflow: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                      <table className="table" style={{ width: "100%" }}>
                        <thead>
                          <tr>
                            <th>Table</th>
                            <th style={{ textAlign: "right" }}>Rows</th>
                            <th style={{ textAlign: "right" }}>Est. size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(dbBreakdown.tables || []).map(t => (
                            <tr key={t.table}>
                              <td>{t.table}</td>
                              <td style={{ textAlign: "right" }}>{t.rows == null ? "—" : Number(t.rows).toLocaleString()}</td>
                              <td style={{ textAlign: "right" }}>{t.bytes == null ? "—" : fmtBytes(t.bytes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </Section>

          <Section title="Backups">
            <Row label="Enable backups" hint="Automatically back up the database on a regular schedule.">
              <Toggle checked={settings.backupsEnabled}
                onChange={e => set("backupsEnabled", e.target.checked)} />
            </Row>
            <Row label="Keep rolling backups" hint="Number of numbered rotating snapshots to keep (newest overwrites oldest). Min 1, max 10.">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <NumInput value={settings.backupsKeepNumbered} min={1} max={10}
                  disabled={!settings.backupsEnabled}
                  onChange={e => set("backupsKeepNumbered", Math.max(1, Math.min(10, Number(e.target.value)||3)))} />
                <span style={{ opacity:0.5, fontSize:13 }}>files</span>
              </div>
            </Row>
            <Row label="Keep daily backups" hint="Number of daily dated backups to keep. Set to 0 to disable daily backups.">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <NumInput value={settings.backupsKeepDays} min={0} max={30}
                  disabled={!settings.backupsEnabled}
                  onChange={e => set("backupsKeepDays", Math.max(0, Math.min(30, Number(e.target.value)||3)))} />
                <span style={{ opacity:0.5, fontSize:13 }}>days</span>
              </div>
            </Row>
            <Row
              label="Backup location"
              hint={settings.backupsCustomDir
                ? "Using custom folder. Clear to restore default (next to the database file)."
                : "Default: backups/ folder next to the database file."}
            >
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {settings.backupsCustomDir ? (
                  <span style={{ fontSize:11, opacity:0.6, maxWidth:200, textAlign:"right", wordBreak:"break-all", fontFamily:"ui-monospace,monospace" }}>
                    {settings.backupsCustomDir}
                  </span>
                ) : (
                  <span style={{ fontSize:12, opacity:0.4, fontStyle:"italic" }}>Default</span>
                )}
                <button className="btn" style={{ fontSize:12, whiteSpace:"nowrap" }}
                  onClick={async () => {
                    const r = await api.pickBackupFolder?.();
                    if (r?.ok && r.path) set("backupsCustomDir", r.path);
                  }}>
                  Browse…
                </button>
                {settings.backupsCustomDir && (
                  <button className="btn" style={{ fontSize:12 }}
                    title="Clear custom location and use default"
                    onClick={() => set("backupsCustomDir", "")}>
                    ✕
                  </button>
                )}
              </div>
            </Row>
          </Section>

          <Section title="Danger zone">
            <Row label="Delete all local data" hint="Permanently wipes all stored players, clans, logs, and settings.">
              <button className="btn btnDanger" onClick={wipe}>Delete all data</button>
            </Row>
          </Section>
        </div>
      )}

      {/* ── SCHEDULER tab ─────────────────────────────────────────────────── */}
      {tab === "scheduler" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, opacity: 0.6 }}>Live view of running tasks, tracked refresh queue, and leaderboard watches.</div>
            <button className="btn" disabled={schedBusy} onClick={() => { setSchedOpen(true); loadScheduler(); }}>
              {schedBusy ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {!sched ? (
            <div style={{ opacity: 0.5, fontSize: 13 }}>Click Refresh to load scheduler status.</div>
          ) : (
            <>
              <Section title="Active scans" info="Shows whether a leaderboard or bulk player/clan scan is currently running in the background. Only one of each kind can run at a time.">
                <Row label="Leaderboard scan" info="Running if a leaderboard board scan (single board, Scan All, or a custom job) is currently in progress.">
                  <StatusPill active={sched?.scans?.leaderboard?.running} />
                </Row>
                <Row label="Bulk scan" info="Running if a bulk player/clan scan (started from the Home page) is currently in progress.">
                  <StatusPill active={sched?.scans?.bulk?.running} />
                </Row>
              </Section>

              <Section title="Tracked refresh" info="Players and clans you've marked as 'tracked' are automatically re-scanned in a repeating cycle, so their data stays up to date without manual rescans. Configure the interval in the Automation tab.">
                <Row label="Enabled entities" info="The total number of players and clans currently marked as tracked, broken down by type.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>
                    {Number(sched?.tracked?.enabledCount||0).toLocaleString()}
                    <span style={{ opacity: 0.55 }}> ({Number(sched?.tracked?.enabledPlayers||0).toLocaleString()} players, {Number(sched?.tracked?.enabledClans||0).toLocaleString()} clans)</span>
                  </span>
                </Row>
                <Row label="Cycle progress" info="How far through the current tracked-refresh cycle the scheduler is. Once every tracked entity has been refreshed, a new cycle begins after the configured interval.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>
                    {sched?.tracked?.cycle
                      ? `${Math.min(Number(sched.tracked.cycle.done||0) + (sched?.tracked?.current ? 1 : 0), Number(sched.tracked.cycle.total||0))} / ${Number(sched.tracked.cycle.total||0)}`
                      : "—"}
                  </span>
                </Row>
                <Row label="Current refresh" info="The tracked entity currently being refreshed right now, if any.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>
                    {sched?.tracked?.current
                      ? <><b>{sched.tracked.current.entityType}</b>: {sched.tracked.current.entityName}</>
                      : "Idle"}
                  </span>
                </Row>
                <Row label="Last refresh" info="The most recently completed tracked refresh, and whether it succeeded or hit an error.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>
                    {sched?.tracked?.last
                      ? <>{sched.tracked.last.ok ? "✅" : "⚠️"} {sched.tracked.last.entityType}: {sched.tracked.last.entityName}</>
                      : "—"}
                  </span>
                </Row>
                <Row label="Next due" info="If a tracked-refresh cycle is currently running, shows how many entities are left in it. Otherwise shows the countdown until the next cycle begins.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>
                    {(() => {
                      const cycle = sched?.tracked?.cycle;
                      const next = sched?.tracked?.nextDueAny;
                      // If a cycle is actively running, show position within it
                      if (cycle && cycle.total > 0){
                        const done = Number(cycle.done||0);
                        const total = Number(cycle.total||0);
                        const remaining = total - done;
                        if (remaining <= 0) return <span style={{ color:"var(--success)" }}>Cycle complete — waiting for next interval</span>;
                        return <>{remaining} remaining in current cycle</>;
                      }
                      // No active cycle — show when the next one starts
                      if (!next) return "—";
                      const secs = next.dueInSec ?? null;
                      if (secs === 0) return <span style={{ color:"var(--warning2)" }}>Due now</span>;
                      return <>Next cycle in {secs != null ? `${secs}s` : "?"}</>;
                    })()}
                  </span>
                </Row>
              </Section>

              <Section title="Leaderboard watches" info="Watches periodically re-scan a specific leaderboard board (e.g. to detect rank changes over time) and can save a snapshot for comparison. Manage watches from the Leaderboards page.">
                <Row label="Enabled watches" info="The number of leaderboard watches currently enabled and running on a schedule.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>{Number(sched?.watches?.enabledCount||0).toLocaleString()}</span>
                </Row>
                <Row label="Next due" info="The next leaderboard watch scheduled to run, and how soon, in seconds.">
                  <span style={{ fontSize: 13, opacity: 0.8 }}>
                    {sched?.watches?.nextDue
                      ? `#${sched.watches.nextDue.id} — ${sched.watches.nextDue.boardKey} — ${sched.watches.nextDue.dueInSec ?? "?"}s`
                      : "—"}
                  </span>
                </Row>

                {(sched?.watches?.items||[]).length > 0 && (
                  <div style={{ marginTop: 10, maxHeight: 220, overflow: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                    <table className="table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}>ID</th>
                          <th>Board</th>
                          <th style={{ width: 90 }}>Due</th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 150 }}>Last run</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sched.watches.items.map(w => (
                          <tr key={w.id}>
                            <td>{w.id}</td>
                            <td style={{ fontFamily: "monospace", fontSize: 12 }}>{w.boardKey}</td>
                            <td>{w.dueInSec == null ? "—" : `${w.dueInSec}s`}</td>
                            <td>{w.lastStatus || "—"}</td>
                            <td style={{ fontSize: 12 }}>{w.lastRunAt ? fmtTime(w.lastRunAt) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}

          {/* ── Stale auto-refresh status ─────────────────────────────── */}
          <Section title="Stale auto-refresh" info="Periodically finds players/clans that haven't been updated in a while and refreshes them automatically in small waves, separate from the tracked-refresh cycle. Configure thresholds in the Automation tab.">
            {!settings.autoRefreshStaleEnabled ? (
              <div style={{ fontSize:13, opacity:0.45, padding:"6px 0" }}>
                Disabled — enable in the <b>Automation</b> tab.
              </div>
            ) : (
              <>
                <Row label="Status" info="Whether a stale-refresh wave is currently in progress.">
                  <StatusPill active={staleStatus.running} />
                </Row>

                <Row label="Total stale accounts" info="The number of players/clans whose data is older than the stale threshold and are waiting to be refreshed. Click the refresh button to recheck this count." hint={`Entities not updated in >${settings.autoRefreshStaleDays} days · Wave size: ${settings.autoRefreshWaveSize} · Interval: ${settings.autoRefreshIntervalMinutes}min`}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {stalePending === null ? (
                      <span style={{ fontSize:13, opacity:0.4 }}>Loading…</span>
                    ) : (
                      <>
                        <span style={{
                          fontSize:16, fontWeight:800,
                          color: stalePending === 0 ? "var(--success)" : stalePending > 50 ? "var(--danger)" : "var(--warning)",
                        }}>
                          {stalePending.toLocaleString()}
                        </span>
                        <span style={{ fontSize:12, opacity:0.45 }}>
                          {stalePending === 0 ? "all up to date" : stalePending === 1 ? "account" : "accounts"}
                        </span>
                        <button
                          className="btn"
                          style={{ fontSize:11, padding:"2px 8px" }}
                          onClick={loadStalePending}
                        >
                          ↻
                        </button>
                      </>
                    )}
                  </div>
                </Row>

                {staleStatus.running && (
                  <>
                    <Row label="Progress" info="How many entities remain in the current stale-refresh wave, out of the total being processed this wave.">
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:13, fontWeight:700 }}>
                          {staleStatus.remaining} remaining
                        </span>
                        <span style={{ fontSize:12, opacity:0.45 }}>
                          of {staleStatus.total}
                        </span>
                        {/* Progress bar */}
                        <div style={{ width:100, height:6, borderRadius:3, background:"rgba(255,255,255,0.1)", overflow:"hidden" }}>
                          <div style={{
                            height:"100%", borderRadius:3,
                            background:"var(--accent,#2563eb)",
                            width: staleStatus.total > 0
                              ? `${Math.round(((staleStatus.total - staleStatus.remaining) / staleStatus.total) * 100)}%`
                              : "0%",
                            transition:"width 0.4s ease",
                          }} />
                        </div>
                      </div>
                    </Row>
                    <Row label="Currently scanning" info="The player or clan currently being refreshed as part of the stale-refresh wave.">
                      <span style={{ fontSize:13, opacity:0.8, fontStyle: staleStatus.current ? "normal" : "italic" }}>
                        {staleStatus.current || "—"}
                      </span>
                    </Row>
                  </>
                )}

                {!staleStatus.running && staleStatus.lastRunAt && (
                  <Row label="Last run" info="When the most recent stale-refresh wave ran, and how many entities it refreshed.">
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:13, opacity:0.8 }}>{fmtTime(staleStatus.lastRunAt)}</div>
                      {staleStatus.lastCount > 0 && (
                        <div style={{ fontSize:11, opacity:0.45 }}>{staleStatus.lastCount} entities refreshed</div>
                      )}
                    </div>
                  </Row>
                )}

                <Row label="Next scheduled run" info="When the next stale-refresh wave is scheduled to start, based on the configured interval in the Automation tab.">
                  <span style={{ fontSize:13, opacity:0.5 }}>
                    {staleStatus.nextRunAt ? fmtTime(staleStatus.nextRunAt) : "—"}
                  </span>
                </Row>

                <Row label="Stale threshold" info="Entities not updated within this many days are considered 'stale' and eligible for the next refresh wave. Configure this in the Automation tab.">
                  <span style={{ fontSize:13, opacity:0.7 }}>
                    {settings.autoRefreshStaleDays} day{settings.autoRefreshStaleDays !== 1 ? "s" : ""}
                  </span>
                </Row>
              </>
            )}
          </Section>
        </div>
      )}

    </div>
  );
}

// ─── small shared sub-components ─────────────────────────────────────────────

function SaveBar({ busy, saved, onSave, children }){
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)",
    }}>
      <button className="btn btnPrimary" onClick={onSave} disabled={busy} style={{ minWidth: 110 }}>
        {busy ? "Saving…" : saved ? "✓ Saved" : "Save settings"}
      </button>
      {children}
    </div>
  );
}

function StatusPill({ active }){
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 8,
      background: active ? "rgba(var(--success-rgb),0.15)" : "rgba(255,255,255,0.07)",
      color: active ? "var(--success)" : "rgba(255,255,255,0.4)",
    }}>
      {active ? "Running" : "Idle"}
    </span>
  );
}