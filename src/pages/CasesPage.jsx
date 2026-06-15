import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildCaseReport } from "../utils/caseReport.js";
import { useToast } from "../components/Toast.jsx";

function fmtTs(ts){
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString(undefined, {
    year:"numeric", month:"short", day:"2-digit",
    hour:"2-digit", minute:"2-digit"
  });
}

function fmtAgo(ts){
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24)     return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function slugify(input){
  const s = String(input ?? "").trim().toLowerCase();
  let out = "", dash = false;
  for (const ch of s){
    const code = ch.charCodeAt(0);
    const isAlNum = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    const isSep   = ch === " " || ch === "-" || ch === "_";
    if (isAlNum){ out += ch; dash = false; }
    else if (isSep && !dash && out.length){ out += "-"; dash = true; }
    if (out.length >= 48) break;
  }
  return out.replace(/-+$/, "") || "case";
}

function StatusBadge({ status }){
  const isOpen = status === "open";
  return (
    <span style={{
      fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:6,
      background: isOpen ? "rgba(var(--success-rgb),0.15)" : "rgba(255,255,255,0.07)",
      color: isOpen ? "var(--success)" : "rgba(255,255,255,0.4)",
    }}>{status || "unknown"}</span>
  );
}

function SectionHeading({ children }){
  return (
    <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase", opacity:0.4, marginBottom:8, marginTop:20 }}>
      {children}
    </div>
  );
}

export default function CasesPage(){
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam   = String(searchParams.get("status") || "").toLowerCase();
  const initialStatus = ["open","closed"].includes(statusParam) ? statusParam : "all";

  const [cases,       setCases]       = useState([]);
  const [activeId,    setActiveId]    = useState(null);
  const [active,      setActive]      = useState(null);
  const [busy,        setBusy]        = useState(false);
  const [redactNames, setRedactNames] = useState(false);
  const [includeAppendix, setIncludeAppendix] = useState(false);
  const [newTitle,    setNewTitle]    = useState("");
  const [noteText,    setNoteText]    = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [autoSnapBusy, setAutoSnapBusy] = useState(false);

  async function refreshList(){
    const list = await window.idleclans.listCases();
    setCases(Array.isArray(list) ? list : []);
  }
  async function loadCase(id){
    if (!id){ setActiveId(null); setActive(null); return; }
    setActive(await window.idleclans.getCase(id));
    setActiveId(id);
  }

  useEffect(() => { refreshList(); }, []);

  useEffect(() => {
    const sp = String(searchParams.get("status") || "").toLowerCase();
    if (sp === "open" || sp === "closed") setStatusFilter(sp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  useEffect(() => { if (activeId) loadCase(activeId); }, [activeId]); // eslint-disable-line

  const openCount     = useMemo(() => cases.filter(c => c.status === "open").length, [cases]);
  const filteredCases = useMemo(() => {
    if (statusFilter === "open")   return cases.filter(c => c.status === "open");
    if (statusFilter === "closed") return cases.filter(c => c.status === "closed");
    return cases;
  }, [cases, statusFilter]);

  useEffect(() => {
    if (!activeId && filteredCases.length) setActiveId(filteredCases[0].id);
  }, [filteredCases, activeId]); // eslint-disable-line

  async function create(){
    const title = String(newTitle || "").trim();
    if (!title) return;
    setBusy(true);
    try{
      const res = await window.idleclans.createCase(title);
      await refreshList();
      if (res?.caseId) setActiveId(res.caseId);
      setNewTitle("");
    }catch(e){ toast.error("Create failed: " + (e?.message || String(e))); }
    finally { setBusy(false); }
  }

  async function addNote(){
    if (!activeId) return;
    const text = String(noteText || "").trim();
    if (!text) return;
    setBusy(true);
    try{
      await window.idleclans.addCaseNote(activeId, text);
      setNoteText("");
      await loadCase(activeId);
      await refreshList();
    } finally { setBusy(false); }
  }

  async function setStatus(next){
    if (!activeId) return;
    setBusy(true);
    try{
      await window.idleclans.updateCase({ caseId: activeId, status: next });
      await loadCase(activeId);
      await refreshList();
    }catch(e){ toast.error("Status update failed: " + (e?.message || String(e))); }
    finally { setBusy(false); }
  }

  async function remove(){
    if (!activeId || !confirm("Delete this case? This cannot be undone.")) return;
    setBusy(true);
    try{
      await window.idleclans.deleteCase(activeId);
      setActiveId(null); setActive(null);
      await refreshList();
    }catch(e){ toast.error("Delete failed: " + (e?.message || String(e))); }
    finally { setBusy(false); }
  }

  async function updateAutoSnapshot(patch){
    if (!activeId) return;
    setAutoSnapBusy(true);
    try{
      await window.idleclans.updateCaseAutoSnapshot({ caseId: activeId, ...patch });
      await loadCase(activeId);
      await refreshList();
    }catch(e){ toast.error("Auto-snapshot update failed: " + (e?.message || String(e))); }
    finally{ setAutoSnapBusy(false); }
  }

  async function takeSnapshotNow(){
    if (!activeId) return;
    setAutoSnapBusy(true);
    try{
      // Trigger the global runner — it will pick up this case if it has players attached
      // (or it's a manual trigger so we also force it directly)
      await window.idleclans.runCaseAutoSnapshots();
      await loadCase(activeId);
      await refreshList();
    }catch(e){ toast.error("Snapshot failed: " + (e?.message || String(e))); }
    finally{ setAutoSnapBusy(false); }
  }

  async function openSnapshot(snap){
    if (!snap?.id) return;
    setBusy(true);
    try{
      const full = await window.idleclans.getCaseSnapshot(snap.id);
      const txt  = JSON.stringify(full?.data ?? null, null, 2);
      await window.idleclans.saveTextFile(`case_${activeId}_snapshot_${snap.id}.json`, txt);
    } finally { setBusy(false); }
  }

  async function doExport(format){
    if (!activeId) return;
    setBusy(true);
    try{
      const c = await window.idleclans.getCase(activeId);
      if (!c) return;
      const snaps = [];
      for (const s of (c.snapshots || []).slice(0, 20)){
        try{ snaps.push({ ...s, data: (await window.idleclans.getCaseSnapshot(s.id))?.data ?? null }); }
        catch{ snaps.push({ ...s, data: null }); }
      }
      const { md, html, baseName } = buildCaseReport({ caseObj: c, snapshots: snaps, options: { redactNames, includeAppendix } });
      if (format === "md")  await window.idleclans.saveTextFile(`${baseName}.md`, md);
      else {
        const res = await window.idleclans.exportHtml(`${baseName}.${format}`, html, format);
        if (res?.ok === false) throw new Error(res.error || `Export ${format} failed`);
      }
    }catch(e){ toast.error(`Export ${format} failed: ` + (e?.message || String(e))); }
    finally { setBusy(false); }
  }

  const ac = active;

  return (
    <div style={{ display:"flex", gap:0, height:"calc(100vh - 100px)", minHeight:500 }}>

      {/* ── LEFT PANEL: case list ──────────────────────────────────────── */}
      <div style={{
        width:280, flexShrink:0, display:"flex", flexDirection:"column",
        borderRight:"1px solid rgba(255,255,255,0.07)", paddingRight:16, marginRight:20,
      }}>
        {/* Header */}
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontWeight:800, fontSize:16 }}>Cases</span>
            <span style={{ fontSize:12, opacity:0.45 }}>{openCount} open · {cases.length} total</span>
          </div>
          {/* Filter tabs */}
          <div style={{ display:"flex", gap:4, marginBottom:10 }}>
            {[["all","All"],["open","Open"],["closed","Closed"]].map(([val, label]) => (
              <button key={val} onClick={() => { setStatusFilter(val); setSearchParams(val === "all" ? {} : { status: val }); }}
                style={{
                  flex:1, padding:"4px 0", fontSize:12, fontWeight:600, borderRadius:6, border:"none", cursor:"pointer",
                  background: statusFilter === val ? "var(--accent,#2563eb)" : "rgba(255,255,255,0.07)",
                  color: statusFilter === val ? "#fff" : "rgba(255,255,255,0.5)",
                }}>
                {label}
              </button>
            ))}
          </div>
          {/* New case input */}
          <div style={{ display:"flex", gap:6 }}>
            <input className="input" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="New case title…"
              onKeyDown={e => e.key === "Enter" && create()}
              style={{ flex:1, fontSize:13 }} />
            <button className="btn btnPrimary" disabled={busy || !newTitle.trim()} onClick={create}
              style={{ padding:"0 12px", fontSize:13 }}>+</button>
          </div>
        </div>

        {/* Case list */}
        <div style={{ flex:1, overflowY:"auto" }}>
          {filteredCases.length === 0 ? (
            <div style={{ opacity:0.4, fontSize:13, textAlign:"center", paddingTop:24 }}>No cases.</div>
          ) : filteredCases.map(c => {
            const isActive = c.id === activeId;
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} style={{
                width:"100%", textAlign:"left", background: isActive ? "rgba(var(--info-rgb),0.1)" : "transparent",
                border: isActive ? "1px solid rgba(var(--info-rgb),0.25)" : "1px solid transparent",
                borderRadius:8, padding:"9px 10px", marginBottom:3, cursor:"pointer",
                transition:"background 0.1s",
              }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:6, justifyContent:"space-between" }}>
                  <div style={{ fontWeight:700, fontSize:13, flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"rgba(255,255,255,0.92)" }}>
                    {c.title}
                  </div>
                  {c.entityCount > 0 && (
                    <span style={{ fontSize:11, background:"rgba(255,255,255,0.1)", borderRadius:6, padding:"1px 6px", flexShrink:0 }}>
                      {c.entityCount}
                    </span>
                  )}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                  <StatusBadge status={c.status} />
                  {c.autoSnapshotEnabled ? (
                    <span style={{
                      fontSize:10, fontWeight:700, padding:"1px 5px", borderRadius:4,
                      background:"rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.15)",
                      color:`rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.85)`,
                    }}>AUTO</span>
                  ) : null}
                  <span style={{ fontSize:11, opacity:0.35 }}>{fmtAgo(c.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL: case detail ───────────────────────────────────── */}
      <div style={{ flex:1, minWidth:0, overflowY:"auto" }}>
        {!ac ? (
          <div style={{ opacity:0.35, fontSize:14, paddingTop:40, textAlign:"center" }}>Select a case to view details.</div>
        ) : (
          <>
            {/* Case header — title row */}
            <div style={{ marginBottom:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:3 }}>
                <span style={{ fontWeight:800, fontSize:20, color:"rgba(255,255,255,0.95)" }}>{ac.title}</span>
                <StatusBadge status={ac.status} />
              </div>
              <div style={{ fontSize:12, opacity:0.4 }}>
                Created {fmtTs(ac.createdAt)} &nbsp;·&nbsp; Updated {fmtTs(ac.updatedAt)}
              </div>
            </div>

            {/* Case header — action row */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:18,
              paddingBottom:14, borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
              <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, cursor:"pointer", opacity:0.6,
                padding:"5px 10px", borderRadius:7, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.04)" }}>
                <input type="checkbox" checked={redactNames} onChange={e => setRedactNames(e.target.checked)} />
                Redact
              </label>
              <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, cursor:"pointer", opacity:0.6,
                padding:"5px 10px", borderRadius:7, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.04)" }}>
                <input type="checkbox" checked={includeAppendix} onChange={e => setIncludeAppendix(e.target.checked)} />
                Appendix
              </label>
              <button className="btn" disabled={busy} onClick={() => doExport("pdf")} style={{ fontSize:12 }}>Export PDF</button>
              <button className="btn" disabled={busy} onClick={() => doExport("png")} style={{ fontSize:12 }}>Export PNG</button>
              <div style={{ flex:1 }} />
              {ac.status !== "open"   && <button className="btn" disabled={busy} onClick={() => setStatus("open")}>Reopen</button>}
              {ac.status !== "closed" && <button className="btn" disabled={busy} onClick={() => setStatus("closed")}>Close</button>}
              <button className="btn btnDanger" disabled={busy} onClick={remove}>Delete</button>
            </div>

            {ac.summary && <div style={{ fontSize:14, opacity:0.6, marginBottom:16 }}>{ac.summary}</div>}

            {/* Participants */}
            <SectionHeading>Participants</SectionHeading>
            {!ac.entities?.length ? (
              <div style={{ fontSize:13, opacity:0.4, marginBottom:16 }}>
                No participants yet. Save a Compare snapshot or attach from a player/clan page.
              </div>
            ) : (() => {
              const clans   = ac.entities.filter(e => e.entityType === "clan");
              const players = ac.entities.filter(e => e.entityType === "player");
              const others  = ac.entities.filter(e => e.entityType !== "clan" && e.entityType !== "player");
              const GroupChips = ({ items, type }) => (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, opacity:0.4, fontWeight:700, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>{type}</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {items.map(e => (
                      <Link key={`${e.entityType}:${e.entityLower}`}
                        to={`/${e.entityType === "clan" ? "clans" : "players"}/${encodeURIComponent(e.entityName)}`}
                        style={{
                          fontSize:13, fontWeight:600, padding:"4px 12px", borderRadius:8,
                          background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)",
                          textDecoration:"none", color:"inherit",
                        }}>
                        {e.entityName}
                      </Link>
                    ))}
                  </div>
                </div>
              );
              return (
                <div style={{ marginBottom:8 }}>
                  {clans.length   > 0 && <GroupChips items={clans}   type="Clans" />}
                  {players.length > 0 && <GroupChips items={players} type="Players" />}
                  {others.length  > 0 && <GroupChips items={others}  type="Other" />}
                </div>
              );
            })()}

            {/* ── Auto-snapshot settings ──────────────────────────────── */}
            {ac.status === "open" && (() => {
              const enabled = !!ac.autoSnapshotEnabled;
              const intervalHours = ac.autoSnapshotIntervalHours ?? 24;
              const lastAt = ac.lastAutoSnapshotAt;
              const hasPlayers = (ac.entities || []).some(e => e.entityType === "player");

              const INTERVALS = [
                [1,  "Every hour"],
                [6,  "Every 6 hours"],
                [12, "Every 12 hours"],
                [24, "Every 24 hours"],
                [48, "Every 2 days"],
                [72, "Every 3 days"],
                [168,"Every week"],
              ];

              return (
                <div style={{
                  margin:"16px 0 4px",
                  padding:"14px 16px",
                  borderRadius:12,
                  background: enabled
                    ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.05)"
                    : "rgba(255,255,255,0.02)",
                  border: enabled
                    ? "1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.22)"
                    : "1px solid rgba(255,255,255,0.08)",
                }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      {/* Toggle */}
                      <label style={{ display:"flex", alignItems:"center", gap:8, cursor: autoSnapBusy ? "wait" : "pointer" }}>
                        <div style={{
                          position:"relative", width:36, height:20, borderRadius:99,
                          background: enabled
                            ? `rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.7)`
                            : "rgba(255,255,255,0.15)",
                          transition:"background 0.2s", flexShrink:0,
                        }}
                          onClick={() => !autoSnapBusy && updateAutoSnapshot({ enabled: !enabled })}>
                          <div style={{
                            position:"absolute", top:2, left: enabled ? 18 : 2,
                            width:16, height:16, borderRadius:"50%", background:"#fff",
                            transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.3)",
                          }} />
                        </div>
                        <span style={{ fontSize:13, fontWeight:700 }}>Auto-snapshot</span>
                      </label>
                      {enabled && (
                        <select
                          className="select"
                          style={{ fontSize:12, padding:"3px 8px" }}
                          value={intervalHours}
                          disabled={autoSnapBusy}
                          onChange={e => updateAutoSnapshot({ intervalHours: Number(e.target.value) })}>
                          {INTERVALS.map(([h, label]) => (
                            <option key={h} value={h}>{label}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {enabled && lastAt && (
                        <span style={{ fontSize:11, opacity:0.45 }}>
                          Last: {fmtAgo(lastAt)}
                        </span>
                      )}
                      {!hasPlayers && enabled && (
                        <span style={{ fontSize:11, color:"var(--warning)" }}>
                          ⚠ No player entities — attach players for snapshots to run
                        </span>
                      )}
                      <button
                        className="btn"
                        disabled={autoSnapBusy || !hasPlayers}
                        onClick={takeSnapshotNow}
                        style={{ fontSize:12 }}
                        title="Take a snapshot now using locally cached player data">
                        {autoSnapBusy ? "Running…" : "Snapshot now"}
                      </button>
                    </div>
                  </div>

                  {enabled && (
                    <div style={{ fontSize:11, opacity:0.45, marginTop:8 }}>
                      Sentinel will automatically refresh and snapshot attached players every {
                        INTERVALS.find(([h])=>h===intervalHours)?.[1]?.replace("Every ","").toLowerCase() ?? `${intervalHours}h`
                      } while this case is open. Each run fetches live data from the API, respecting your configured rate limit.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Snapshots + Notes side by side */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginTop:4 }}>
              <div>
                <SectionHeading>Snapshots ({ac.snapshots?.length || 0})</SectionHeading>
                {!ac.snapshots?.length ? (
                  <div style={{ fontSize:13, opacity:0.4 }}>
                    No snapshots yet.{" "}
                    {ac.status === "open"
                      ? "Use 'Snapshot now' above, or save a compare snapshot from the Player Compare page."
                      : ""}
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    {ac.snapshots.slice(0,30).map(s => {
                      const isAuto = s.kind === "auto";
                      return (
                        <button key={s.id} onClick={() => openSnapshot(s)} style={{
                          textAlign:"left",
                          background: isAuto ? "rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.04)" : "rgba(255,255,255,0.03)",
                          border: isAuto ? "1px solid rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.15)" : "1px solid rgba(255,255,255,0.07)",
                          borderRadius:8, padding:"8px 12px", cursor:"pointer",
                        }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ fontWeight:600, fontSize:13 }}>{s.title || s.kind}</span>
                            {isAuto && (
                              <span style={{
                                fontSize:10, fontWeight:700, padding:"1px 5px", borderRadius:4,
                                background:"rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.18)",
                                color:`rgba(var(--accent-r),var(--accent-g),var(--accent-b),0.9)`,
                              }}>AUTO</span>
                            )}
                          </div>
                          <div style={{ fontSize:11, opacity:0.4, marginTop:2 }}>{fmtTs(s.createdAt)}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <SectionHeading>Notes ({ac.notes?.length || 0})</SectionHeading>
                <div style={{ display:"flex", gap:6, marginBottom:10 }}>
                  <input className="input" value={noteText} onChange={e => setNoteText(e.target.value)}
                    placeholder="Add a note…"
                    onKeyDown={e => e.key === "Enter" && addNote()}
                    style={{ flex:1, fontSize:13 }} />
                  <button className="btn" disabled={busy || !noteText.trim()} onClick={addNote}
                    style={{ padding:"0 12px" }}>Add</button>
                </div>
                {!ac.notes?.length ? (
                  <div style={{ fontSize:13, opacity:0.4 }}>No notes yet.</div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:300, overflowY:"auto" }}>
                    {ac.notes.slice(0,30).map(n => (
                      <div key={n.id} style={{
                        background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)",
                        borderRadius:8, padding:"8px 12px",
                      }}>
                        <div style={{ fontSize:11, opacity:0.35, marginBottom:3 }}>{fmtTs(n.createdAt)}</div>
                        <div style={{ fontSize:13 }}>{n.note}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
