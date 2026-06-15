import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/bridge.js";
import { xpToLevel } from "../lib/xp.js";
import { PLAYER_SKILLS_ORDER } from "../lib/skills.js";

function fmtTs(ts){
  if (!ts) return "—";
  try{ return new Date(ts).toLocaleString(undefined,{
    year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit",
  }); }catch{ return ts; }
}

function fmtAgo(ts){
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins  = Math.floor(ms / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days  = Math.floor(hours / 24);
  return `${days}d ago`;
}

function totalLevelFromSkills(skills){
  if (!skills || typeof skills !== "object") return null;
  return PLAYER_SKILLS_ORDER
    .filter(sk => sk in skills)
    .reduce((s, sk) => s + xpToLevel(Number(skills[sk] || 0)), 0);
}

function levelsGainedSince(latestSnap, olderSnap){
  if (!latestSnap?.skills || !olderSnap?.skills) return 0;
  let total = 0;
  for (const sk of PLAYER_SKILLS_ORDER){
    const curr = xpToLevel(Number(latestSnap.skills[sk] || 0));
    const prev = xpToLevel(Number(olderSnap.skills[sk] || 0));
    if (curr > prev) total += curr - prev;
  }
  return total;
}

function AccountRow({ acct, snapData, snapBusy, onRemove, onNavigate, onViewSkills, onSnapshot, border }){
  const latest   = snapData?.latest   || null;
  const weekSnap = snapData?.weekSnap || null;
  const hasSnaps = !!latest;

  const totalLevel  = latest ? totalLevelFromSkills(latest.skills) : null;
  const levelsWeek  = (latest && weekSnap && latest !== weekSnap)
    ? levelsGainedSince(latest, weekSnap) : 0;
  const lastSnapAgo = latest ? fmtAgo(latest.snappedAt) : null;

  return (
    <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
      gap:12, padding:"13px 0",
      borderBottom: border ? "1px solid rgba(255,255,255,0.07)" : "none" }}>

      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
          <span onClick={()=>onNavigate?.(acct.username)}
            style={{ fontWeight:700, fontSize:15, cursor:"pointer",
              textDecoration:"underline", textDecorationStyle:"dotted",
              textUnderlineOffset:3 }}
            title="View player profile">
            {acct.username}
          </span>
        </div>
        <div style={{ fontSize:12, opacity:0.4, marginBottom:5 }}>
          Linked {fmtTs(acct.verifiedAt)}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {!hasSnaps ? (
            <span style={{ fontSize:11, padding:"2px 9px", borderRadius:10,
              background:"rgba(var(--danger-rgb),0.1)", color:"var(--danger)",
              border:"1px solid rgba(var(--danger-rgb),0.25)" }}>
              No snapshots yet — click Snapshot
            </span>
          ) : (
            <>
              <span style={{ fontSize:11, padding:"2px 9px", borderRadius:10,
                background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
                opacity:0.7 }}>
                Last snapshot: {lastSnapAgo}
              </span>
              {totalLevel != null && (
                <span style={{ fontSize:11, padding:"2px 9px", borderRadius:10,
                  background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
                  opacity:0.7 }}>
                  Total level: {totalLevel.toLocaleString()}
                </span>
              )}
              {levelsWeek > 0 && (
                <span style={{ fontSize:11, padding:"2px 9px", borderRadius:10,
                  background:"rgba(var(--success-rgb),0.1)", border:"1px solid rgba(var(--success-rgb),0.2)",
                  color:"var(--success)" }}>
                  +{levelsWeek} level{levelsWeek !== 1 ? "s" : ""} this week
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ display:"flex", gap:6, flexShrink:0, alignItems:"center" }}>
        <button onClick={()=>onViewSkills?.(acct.username)}
          style={{ background:"rgba(var(--success-rgb),0.08)", border:"1px solid rgba(var(--success-rgb),0.25)",
            borderRadius:6, cursor:"pointer", color:"var(--success)",
            fontSize:12, padding:"4px 12px" }}>
          📊 Progress
        </button>
        <button onClick={()=>onSnapshot(acct.username)} disabled={snapBusy}
          style={{ background:"none", border:"1px solid rgba(255,255,255,0.15)",
            borderRadius:6, cursor:"pointer", color:"inherit",
            fontSize:12, padding:"4px 12px", opacity: snapBusy ? 0.5 : 1 }}>
          {snapBusy ? "Saving…" : "Snapshot"}
        </button>
        <button onClick={()=>onRemove(acct.username)}
          style={{ background:"none", border:"1px solid rgba(248,113,113,0.3)",
            borderRadius:6, cursor:"pointer", color:"var(--danger)",
            fontSize:12, padding:"4px 12px" }}>
          Unlink
        </button>
      </div>
    </div>
  );
}

export default function MyAccountsPage(){
  const navigate = useNavigate();
  const [accounts,    setAccounts]    = useState([]);
  const [snapData,    setSnapData]    = useState({});
  const [token,       setToken]       = useState("");
  const [busy,        setBusy]        = useState(false);
  const [result,      setResult]      = useState(null);
  const [snapBusy,    setSnapBusy]    = useState({});
  const [snapAllBusy, setSnapAllBusy] = useState(false);

  async function load(){
    try{
      const accts = await api.accountsList?.() || [];
      setAccounts(accts);
      const entries = await Promise.allSettled(
        accts.map(async (a) => {
          const ln = a.username.toLowerCase();
          try{
            const history  = await api.accountsSkillHistory?.(a.username, { limit:90 }) || [];
            const latest   = history[0] || null;
            const cutoff7  = new Date(Date.now() - 7 * 86400000).toISOString();
            const weekSnap = history.find(r => r.snappedAt <= cutoff7) || null;
            return [ln, { latest, weekSnap }];
          }catch{ return [ln, { latest:null, weekSnap:null }]; }
        })
      );
      const map = {};
      for (const r of entries){
        if (r.status === "fulfilled" && r.value) map[r.value[0]] = r.value[1];
      }
      setSnapData(map);
    }catch(e){ console.warn("[MyAccounts] failed to load skill snapshots", e?.message); }
  }

  useEffect(()=>{ load(); }, []); 

  async function handleVerify(){
    const t = token.trim();
    if (!t){ setResult({ ok:false, error:"Paste your verification token first." }); return; }
    setBusy(true); setResult(null);
    try{
      const r = await api.accountsVerify?.(t);
      setResult(r);
      if (r?.ok){ setToken(""); load(); }
    }catch(e){ setResult({ ok:false, error:String(e?.message||e) }); }
    finally{ setBusy(false); }
  }

  async function handleRemove(username){
    if (!confirm(`Unlink "${username}" from Sentinel?`)) return;
    await api.accountsRemove?.(username);
    load();
  }

  async function handleSnapshot(username){
    const ln = username.toLowerCase();
    setSnapBusy(b=>({...b,[ln]:true}));
    try{
      await api.accountsSnapshotSkills?.(username);
      const history  = await api.accountsSkillHistory?.(username, { limit:90 }) || [];
      const latest   = history[0] || null;
      const cutoff7  = new Date(Date.now() - 7 * 86400000).toISOString();
      const weekSnap = history.find(h => h.snappedAt <= cutoff7) || null;
      setSnapData(prev => ({ ...prev, [ln]: { latest, weekSnap } }));
    }finally{ setSnapBusy(b=>({...b,[ln]:false})); }
  }

  async function handleSnapshotAll(){
    setSnapAllBusy(true);
    try{
      await Promise.allSettled(accounts.map(a => api.accountsSnapshotSkills?.(a.username)));
      await load();
    }finally{ setSnapAllBusy(false); }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* ── Add account ──────────────────────────────────────────────── */}
      <div className="card">
        <div className="cardHeader">
          <div className="cardTitle">Link your account</div>
        </div>
        <div className="cardBody" style={{ display:"flex", flexDirection:"column", gap:14 }}>

          <div style={{ fontSize:13, lineHeight:1.65, opacity:0.6 }}>
            Generate a verification token in-game to prove account ownership.
            Sentinel verifies and records your username, then discards the token.
            No personal account data is ever stored.
          </div>

          <div>
            <div style={{ fontSize:11, fontWeight:700, opacity:0.4, textTransform:"uppercase",
              letterSpacing:"0.06em", marginBottom:6 }}>Paste token</div>
            <textarea value={token} onChange={e=>{ setToken(e.target.value); setResult(null); }}
              placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
              rows={2}
              style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px",
                fontFamily:"ui-monospace,monospace", fontSize:11, resize:"none",
                height:52, borderRadius:8, border:"1px solid rgba(255,255,255,0.12)",
                background:"rgba(0,0,0,0.25)", color:"inherit", lineHeight:1.5 }} />
          </div>

          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button className="btn btnPrimary"
              onClick={handleVerify} disabled={busy || !token.trim()}>
              {busy ? "Verifying…" : "Verify & link"}
            </button>
            {token && (
              <button className="btn" onClick={()=>{ setToken(""); setResult(null); }}>Clear</button>
            )}
          </div>

          {result && (
            <div style={{ padding:"11px 14px", borderRadius:9, fontSize:13,
              background: result.ok ? "rgba(var(--success-rgb),0.08)" : "rgba(var(--danger-rgb),0.08)",
              border: result.ok ? "1px solid rgba(var(--success-rgb),0.25)" : "1px solid rgba(var(--danger-rgb),0.25)",
              color: result.ok ? "#86efac" : "#fca5a5" }}>
              {result.ok
                ? <><b>✓ Verified:</b>{" "}
                    <span style={{ color:"var(--success)", fontWeight:700 }}>{result.username}</span>
                    <span style={{ opacity:0.5 }}> — account linked successfully</span>
                  </>
                : <><b>Verification failed:</b> {result.error}</>
              }
            </div>
          )}

          <details>
            <summary style={{ cursor:"pointer", fontSize:12, opacity:0.5, userSelect:"none" }}>
              How to get a verification token
            </summary>
            <div style={{ marginTop:10, fontSize:13, lineHeight:1.7, opacity:0.65 }}>
              <ol style={{ margin:"0 0 0 18px", padding:0 }}>
                <li>Open Idle Clans and log in with the character you want to verify.</li>
                <li>Go to <b>Settings → Info</b>.</li>
                <li>Tap <b>Get verification Token</b>. It will be auto added to clipboard.</li>
                <li>Paste it into the box above and click <b>Verify & link</b>.</li>
              </ol>
              <div style={{ marginTop:8, fontSize:12, opacity:0.7 }}>
                Tokens are short-lived — if you see "expired", generate a fresh one and retry.
              </div>
            </div>
          </details>
        </div>
      </div>

      {/* ── Linked accounts ──────────────────────────────────────────── */}
      <div className="card">
        <div className="cardHeader" style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div className="cardTitle">
            Linked accounts
            {accounts.length > 0 && (
              <span style={{ marginLeft:8, fontSize:12, opacity:0.45, fontWeight:400 }}>({accounts.length})</span>
            )}
          </div>
          {accounts.length > 1 && (
            <button className="btn" disabled={snapAllBusy} onClick={handleSnapshotAll}
              style={{ fontSize:12 }}>
              {snapAllBusy ? "Snapping all…" : "Snapshot all"}
            </button>
          )}
        </div>
        <div className="cardBody">
          {accounts.length === 0
            ? <div style={{ opacity:0.35, fontSize:13 }}>
                No linked accounts yet. Verify a token above to get started.
              </div>
            : accounts.map((acct, i) => (
                <AccountRow key={acct.id ?? acct.username} acct={acct}
                  snapData={snapData[acct.username.toLowerCase()]}
                  snapBusy={!!snapBusy[acct.username.toLowerCase()]}
                  onRemove={handleRemove}
                  onNavigate={(u)=>navigate(`/players/${encodeURIComponent(u)}`)}
                  onViewSkills={(u)=>navigate(`/my-accounts/${encodeURIComponent(u)}/skills`)}
                  onSnapshot={handleSnapshot}
                  border={i < accounts.length - 1} />
              ))
          }
        </div>
      </div>

      <div style={{ fontSize:12, opacity:0.3, lineHeight:1.6 }}>
        Account linking uses verification against the game's public keys.
        Only your username and the date of verification are stored locally — the token itself is never saved.
      </div>
    </div>
  );
}
