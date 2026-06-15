import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/bridge.js";
import { Card } from "../components/Card.jsx";
import xpArray from "../lib/xpTable.js";
import { ITEM_NAME_OVERRIDES } from "../lib/itemsOverride.js";
import { modeLabel } from "../lib/format.js";


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

function norm(s){ return String(s || "").trim(); }

function xpToLevel(xp){
  const v = Number(xp || 0);
  // xpArray is indexed by level (0..), ascending xp requirements
  let lo = 1, hi = xpArray.length - 1, best = 1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (v >= (xpArray[mid] ?? 0)){
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function formatDaysAgo(hoursOffline){
  const h = Number(hoursOffline);
  if (!Number.isFinite(h)) return null;
  const days = h / 24;
  return `${days.toFixed(1)} days ago`;
}

function KV({ k, v }){
  return (
    <div className="kv">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function ObjectTable({ obj, valueFmt }){
  if (!obj || typeof obj !== "object") return <div className="muted">—</div>;
  const keys = Object.keys(obj);
  if (!keys.length) return <div className="muted">—</div>;
  keys.sort((a,b)=>a.localeCompare(b));
  return (
    <div className="tableWrap">
      <table className="table">
        <tbody>
          {keys.map((k)=>(
            <tr key={k}>
              <td className="mono">{k}</td>
              <td className="mono">{valueFmt ? valueFmt(obj[k], k) : String(obj[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SafeBlock({ render }){
  try {
    return render();
  } catch (e){
    return (
      <div className="errorBox" style={{ marginTop:12 }}>
        Render error: {String(e?.message || e)}
      </div>
    );
  }
}

function SkillsTable({ skills }){
  if (!skills || typeof skills !== "object") return <div className="muted">—</div>;
  const rows = Object.entries(skills).map(([k,v])=>({ k, xp:Number(v||0) }));
  rows.sort((a,b)=>b.xp - a.xp);
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Skill</th>
            <th style={{ width:140 }}>Level</th>
            <th style={{ width:220 }}>XP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r)=>(
            <tr key={r.k}>
              <td>{r.k}</td>
              <td className="mono">{xpToLevel(r.xp)}</td>
              <td className="mono">{Math.round(r.xp).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawJson({ data }){
  if (!data) return null;
  const pretty = JSON.stringify(data, null, 2);
  return (
    <details style={{ marginTop:12 }}>
      <summary className="muted" style={{ cursor:"pointer" }}>Raw JSON</summary>
      <div className="row" style={{ gap:8, marginTop:10 }}>
        <button
          className="btn"
          onClick={async ()=> {
            try { await navigator.clipboard.writeText(pretty); } catch {}
          }}
        >
          Copy JSON
        </button>
      </div>
      <pre className="codeBlock" style={{ marginTop:10, maxHeight:420, overflow:"auto" }}>{pretty}</pre>
    </details>
  );
}

function Section({ title, children }){
  return (
    <div style={{ marginTop:14 }}>
      <div className="muted" style={{ marginBottom:8, fontWeight:700 }}>{title}</div>
      {children}
    </div>
  );
}

export default function LiveSearchPage(){
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState("player"); // player | clan
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [preview, setPreview] = useState(null); // live API preview (not yet stored)
  const [saved, setSaved] = useState(null); // DB row after save
  const [includeMemberProfiles, setIncludeMemberProfiles] = useState(false);

  const [memberLive, setMemberLive] = useState({}); // memberLower -> { hoursOffline, gameMode }

  const [itemsById, setItemsById] = useState(null);

  // Prefill from URL (used by "Open in Discover" links)
  useEffect(()=>{
    const name = (searchParams.get("name") || "").trim();
    const mode = (searchParams.get("mode") || searchParams.get("tab") || "").trim().toLowerCase();
    if (mode === "clan" || mode === "player") setTab(mode);
    if (name) setQ(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(()=>{
    (async ()=>{
      try{
        const gd = await api.getGameDataLookup?.();
        if (gd?.itemsById) setItemsById(gd.itemsById);
      } catch {
        // ignore – enrichment is optional
      }
    })();
  }, []);

  // In clan preview, enrich member pills with last-online by fetching player profiles one-by-one
  useEffect(()=>{
    let cancelled = false;
    (async ()=>{
      if (!preview || preview.kind !== "clan") return;
      const list = Array.isArray(preview.raw?.memberlist) ? preview.raw.memberlist : [];
      setMemberLive({});

      const seen = new Set();
      const names = list
        .map(m=>String(m?.memberName||"").trim())
        .filter(Boolean)
        .slice(0, 80);

      for (const name of names){
        if (cancelled) return;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        try{
          const prof = await api.previewPlayerLive(name);
          if (cancelled) return;
          setMemberLive(prev=>({
            ...prev,
            [key]: {
              hoursOffline: prof?.hoursOffline,
              gameMode: prof?.gameMode,
            }
          }));
        } catch {
          // ignore failures (unknown player, transient errors)
        }
        // soft rate-limit
        await new Promise(r=>setTimeout(r, 250));
      }
    })();
    return ()=>{ cancelled = true; };
  }, [preview?.kind, preview?.raw?.clanName]);

  const canSearch = useMemo(()=> norm(q).length >= 2 && !loading, [q, loading]);
  const isSaved = !!saved;

  function bannerText(){
    if (isSaved) return "Saved to storage.";
    return "Live API Preview";
  }

  async function run(){
    const query = norm(q);
    if (!query) return;
    setLoading(true);
    setErr(null);
    setPreview(null);
    setSaved(null);
    try{
      if (tab === "player"){
        const raw = await api.previewPlayerLive(query);
        setPreview({ kind:"player", raw });
      } else {
        const raw = await api.previewClanLive(query);
        setPreview({ kind:"clan", raw });
      }
    }catch(e){
      setErr(String(e?.message || e));
    }finally{
      setLoading(false);
    }
  }

  async function save(){
    if (!preview) return;
    setLoading(true);
    setErr(null);
    try{
      if (preview.kind === "player"){
        const r = await api.lookupPlayerLive(preview.raw?.username || norm(q));
        setSaved(r || { kind:"playerSaved", name: preview.raw?.username || norm(q) });
      } else {
        const name = preview.raw?.clanName || norm(q);
        const r = await api.lookupClanLive(name, { includeMemberProfiles: !!includeMemberProfiles });
        setSaved(r || { kind:"clanSaved", name });
      }
    }catch(e){
      setErr(String(e?.message || e));
    }finally{
      setLoading(false);
    }
  }

  function onOpen(){
    if (!isSaved || !preview) return;
    if (preview.kind === "player"){
      const name = preview.raw?.username || norm(q);
      if (!name) return;
      nav(`/players/${encodeURIComponent(name)}`);
    } else {
      const name = preview.raw?.clanName || norm(q);
      if (!name) return;
      nav(`/clans/${encodeURIComponent(name)}`);
    }
  }

  function onKey(e){
    if (e.key === "Enter" && canSearch) run();
  }

  const resolvedItemName = (id)=>{
    const idNum = Number(id);
    if (!Number.isFinite(idNum) || idNum === -1) return null;

    // Prefer explicit overrides (items.ts)
    if (Object.prototype.hasOwnProperty.call(ITEM_NAME_OVERRIDES, idNum)){
      return ITEM_NAME_OVERRIDES[idNum];
    }

    // Then cached game-data lookup, if available
    const recA = itemsById?.[String(idNum)];
    const recB = itemsById?.[idNum];
    const rec = recA || recB;
    return rec?.name || null;
  };

  const renderPlayer = (raw)=>{
    if (!raw) return null;

    const lastSeen = fmtAgoFromHoursOffline(raw.hoursOffline);
    const equip = raw.equipment || {};
    const equipRows = Object.entries(equip);

    return (
      <>
        <div className="row" style={{ justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800 }}>{raw.username || "Unknown"}</div>
            <div className="muted" style={{ marginTop:2 }}>
              Mode: <b>{modeLabel(raw.gameMode)}</b>
              {" · "}
              Clan: <b>{raw.guildName || "No clan"}</b>
            </div>
          </div>
          <button className="btn" disabled={!isSaved} onClick={onOpen}>
            {isSaved ? "Open" : "Open (save first)"}
          </button>
        </div>

        <div className="kvGrid" style={{ marginTop:12 }}>
          <KV k="Last online" v={<span className="mono">{lastSeen || "Unknown"}</span>} />
          <KV k="Task on logout" v={<span className="mono">{raw.taskNameOnLogout || "—"}</span>} />
          <KV k="Task type" v={<span className="mono">{raw.taskTypeOnLogout ?? "—"}</span>} />
        </div>

        <Section title="Skills">
          <SkillsTable skills={raw.skillExperiences} />
        </Section>

        <Section title="Equipment">
          {equipRows.length ? (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Item</th>
                  </tr>
                </thead>
                <tbody>
                  {equipRows.map(([slot, id])=>{
                    const idNum = Number(id);
                    const name = (idNum === -1 || id === null || id === undefined) ? null : resolvedItemName(id);
                    return (
                      <tr key={slot}>
                        <td>{slot}</td>
                        <td>{name || <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="muted">—</div>}
        </Section>

        <Section title="Enchantment boosts">
          <ObjectTable
            obj={raw.enchantmentBoosts}
            valueFmt={(v)=>{
              const n = Number(v);
              if (!Number.isFinite(n)) return "—";
              // API returns e.g. 20.0 meaning +20%
              return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
            }}
          />
        </Section>

        <Section title="Upgrades">
          <ObjectTable obj={raw.upgrades} />
        </Section>

        <Section title="PvM stats">
          <ObjectTable obj={raw.pvmStats} />
        </Section>

        <RawJson data={raw} />
      </>
    );
  };

  const renderClan = (raw)=>{
    if (!raw) return null;

    let skills = null;
    try{ skills = raw.serializedSkills ? JSON.parse(raw.serializedSkills) : null; } catch { skills = null; }

    let upgrades = null;
    try{ upgrades = raw.serializedUpgrades ? JSON.parse(raw.serializedUpgrades) : null; } catch { upgrades = null; }

    const members = Array.isArray(raw.memberlist) ? raw.memberlist : [];

    return (
      <>
        <div className="row" style={{ justifyContent:"space-between", gap:10, alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800 }}>{raw.clanName || "Unknown"}</div>
            <div className="muted" style={{ marginTop:2 }}>
              Tag: <b>{raw.tag || "—"}</b>
              {" · "}
              Activity: <b>{raw.activityScore ?? "—"}</b>
              {" · "}
              Recruiting: <b>{String(!!raw.isRecruiting)}</b>
            </div>
          </div>
          <button className="btn" disabled={!isSaved} onClick={onOpen}>
            {isSaved ? "Open" : "Open (save first)"}
          </button>
        </div>

        <div className="kvGrid" style={{ marginTop:12 }}>
          <KV k="Language" v={raw.language || "—"} />
          <KV k="Category" v={<span className="mono">{raw.category ?? "—"}</span>} />
          <KV k="House ID" v={<span className="mono">{raw.houseId ?? "—"}</span>} />
          <KV k="Min total level" v={<span className="mono">{raw.minimumTotalLevelRequired ?? "—"}</span>} />
        </div>

        <Section title="Recruitment message">
          <div className="cardInner" style={{ whiteSpace:"pre-wrap" }}>
            {raw.recruitmentMessage || <span className="muted">—</span>}
          </div>
        </Section>

        <Section title={`Members (${members.length || raw.memberCount || 0})`}>
          {members.length ? (
            <div className="row" style={{ flexWrap:"wrap", gap:8 }}>
              {members.map((m, idx)=>{
                const name = String(m?.memberName || "").trim();
                const key = name.toLowerCase();
                const live = memberLive[key];
                const lo = live ? fmtAgoFromHoursOffline(live.hoursOffline) : "…";
                const mode = live ? modeLabel(live.gameMode) : null;
                const title = `Rank: ${m?.rank ?? "—"}` + (mode ? `\nMode: ${mode}` : "") + (live ? `\nLast online: ${lo}` : "");
                return (
                  <span key={`${key}-${idx}`} className="pill" title={title}>
                    {name || "—"}
                    <span className="muted" style={{ marginLeft:8 }}>{lo}</span>
                  </span>
                );
              })}
            </div>
          ) : <div className="muted">—</div>}
          <div className="muted" style={{ marginTop:8 }}>
            Member last online times load gradually to avoid rate limiting.
          </div>
        </Section>

        <Section title="Clan skills">
          <SkillsTable skills={skills} />
        </Section>

        <Section title="Clan upgrades">
          {Array.isArray(upgrades) ? (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width:160 }}>Upgrade ID</th>
                  </tr>
                </thead>
                <tbody>
                  {upgrades.map((u, idx)=>(
                    <tr key={`${u}-${idx}`}><td className="mono">{String(u)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="muted">—</div>}
        </Section>

        <RawJson data={raw} />
      </>
    );
  };

  return (
    <div>
      <Card title="Live Search">
        <div className="muted">
          Search the live API and preview information. Save result into storage if needed. (Exact name)
        </div>

        <div className="row" style={{ gap:10, marginTop:12, alignItems:"center" }}>
          <div className="segmented">
            <button className={"segBtn " + (tab==="player" ? "segBtnOn" : "")} onClick={()=>setTab("player")}>
              Player
            </button>
            <button className={"segBtn " + (tab==="clan" ? "segBtnOn" : "")} onClick={()=>setTab("clan")}>
              Clan
            </button>
          </div>

          <input
            className="input"
            placeholder={tab==="player" ? "Enter player username..." : "Enter clan name..."}
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            onKeyDown={onKey}
            style={{ flex:1 }}
          />

          <button className="btn btnPrimary" disabled={!canSearch} onClick={run}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {tab==="clan" && (
          <label className="row muted" style={{ gap:8, marginTop:10, alignItems:"center" }}>
            <input type="checkbox" checked={!!includeMemberProfiles} onChange={(e)=>setIncludeMemberProfiles(e.target.checked)} />
            <span>Also fetch and store member profiles (slower)</span>
          </label>
        )}

        {err && <div className="errorBox" style={{ marginTop:12 }}>{err}</div>}

        {preview && (
          <div style={{ marginTop:14 }}>
            <div className="row" style={{ gap:10, marginBottom:10, alignItems:"center" }}>
              <div className="muted" style={{ flex:1 }}>
                <b>{bannerText()}</b>
              </div>
              <button className="btn btnPrimary" disabled={loading || isSaved} onClick={save}>
                {isSaved ? "Saved" : (loading ? "Saving..." : "Save to storage")}
              </button>
            </div>

            <Card>
              <SafeBlock render={() => (
                preview.kind === "player" ? renderPlayer(preview.raw) : renderClan(preview.raw)
              )} />
            </Card>
          </div>
        )}
      </Card>
    </div>
  );
}
