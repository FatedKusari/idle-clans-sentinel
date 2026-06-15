// src/utils/caseReport.js

function escHtml(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(s){
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function formatPct(x){
  const n = Number(x);
  if (!isFinite(n)) return "-";
  const pct = n * 100;
  const rounded1 = Math.round(pct * 10) / 10;
  const isWhole = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9;
  return (isWhole ? Math.round(rounded1) : rounded1.toFixed(1)) + "%";
}

function escapeRegex(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRedactionMap({ caseObj, snapshots }){
  const playerNames = new Set();
  const clanNames = new Set();

  // entities
  for (const e of (caseObj?.entities || [])){
    if (e.entityType === "player") playerNames.add(e.entityName);
    if (e.entityType === "clan") clanNames.add(e.entityName);
  }

  // snapshot surface fields
  for (const s of (snapshots || [])){
    if (s?.kind === "compare" && s.data){
      for (const p of (s.data.players || [])) playerNames.add(p.name);
      for (const f of (s.data.vaultFindings || [])) clanNames.add(f.clanName);
      for (const pair of (s.data.namePairs || [])){
        playerNames.add(pair.a);
        playerNames.add(pair.b);
      }
    }
  }

  const players = Array.from(playerNames).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  const clans = Array.from(clanNames).filter(Boolean).sort((a,b)=>a.localeCompare(b));

  const map = new Map();
  players.forEach((n,i)=> map.set(n, `P${i+1}`));
  clans.forEach((n,i)=> map.set(n, `C${i+1}`));
  return map;
}

function applyRedactionText(text, redactionMap){
  let out = String(text ?? "");
  if (!redactionMap || redactionMap.size === 0) return out;
  // Replace longer names first to avoid partial overlaps
  const keys = Array.from(redactionMap.keys()).sort((a,b)=>b.length-a.length);
  for (const k of keys){
    const v = redactionMap.get(k);
    if (!v) continue;
    out = out.replace(new RegExp(`\\b${escapeRegex(k)}\\b`, "g"), v);
  }
  return out;
}

// Explainable suspicion scoring based on compare snapshots.
// This is intentionally heuristic + conservative.
export function scoreFromCompareSnapshot(data){
  const formatPct = (x)=>{
    const n = Number(x);
    if (!isFinite(n)) return "-";
    const pct = n * 100;
    // Hide trailing .0 for cleaner display.
    const rounded1 = Math.round(pct * 10) / 10;
    const isWhole = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9;
    return (isWhole ? Math.round(rounded1) : rounded1.toFixed(1)) + "%";
  };

  const res = {
    groupScore: 0,
    groupReasons: [],
    perPlayer: {}, // name -> { score, reasons:[] }
  };
  if (!data) return res;

  const ensure = (name)=>{
    if (!name) return null;
    if (!res.perPlayer[name]) res.perPlayer[name] = { score: 0, reasons: [] };
    return res.perPlayer[name];
  };

  // Name similarity: strong similarity within same clan is a mild signal.
  let strongPairCount = 0;
  let maxSim = 0;
  for (const p of (data.namePairs || [])){
    const sim = Number(p.sim ?? 0);
    if (!isFinite(sim)) continue;
    const sameClan = !!p.sameClan;
    if (!sameClan) continue;

    if (sim > maxSim) maxSim = sim;

    let pts = 0;
    if (sim >= 0.93) pts = 12;
    else if (sim >= 0.90) pts = 8;
    else if (sim >= 0.87) pts = 5;
    else continue;

    if (sim >= 0.90) strongPairCount += 1;

    const a = ensure(p.a);
    const b = ensure(p.b);
    const pct = formatPct(sim);
    if (a){ a.score += pts; a.reasons.push(`Name similarity with ${p.b} in same clan (${pct})`); }
    if (b){ b.score += pts; b.reasons.push(`Name similarity with ${p.a} in same clan (${pct})`); }
  }

  // Mild group contribution from multiple very similar pairs.
  if (strongPairCount >= 2){
    const bonus = Math.min(20, 6 + (strongPairCount - 2) * 3);
    res.groupScore += bonus;
    res.groupReasons.push(`Multiple high name-similarity pairs within the same clan (${strongPairCount} pairs, max ${formatPct(maxSim)})`);
  }

  // Vault patterns: stronger signals, but only when your vault detector already matched its thresholds.
  for (const f of (data.vaultFindings || [])){
    if (!f?.flag) continue;
    res.groupScore += 25;
    res.groupReasons.push(`Vault pattern matched thresholds in clan ${f.clanName}`);

    if (f.topWithdrawer){
      const w = ensure(f.topWithdrawer);
      if (w){
        w.score += 35;
        const share = (f.topWithdrawerShare == null) ? "" : ` (share ~${Math.round(Number(f.topWithdrawerShare)*100)}%)`;
        w.reasons.push(`Dominant withdrawer surfaced in vault flows for clan ${f.clanName}${share}`);
      }
    }
    if (Array.isArray(f.topDepositors)){
      for (const dep of f.topDepositors.slice(0, 6)){
        const d = ensure(dep);
        if (d){
          d.score += 10;
          d.reasons.push(`Frequent depositor surfaced in vault flows for clan ${f.clanName}`);
        }
      }
    }
  }

  for (const k of Object.keys(res.perPlayer)){
    res.perPlayer[k].score = Math.min(100, Math.round(res.perPlayer[k].score));
  }
  res.groupScore = Math.min(100, Math.round(res.groupScore));
  return res;
}

export function buildCaseReport({ caseObj, snapshots, options }){
  const opts = {
    redactNames: false,
    includeAppendix: true,
    ...options,
  };

  const redactionMap = opts.redactNames ? buildRedactionMap({ caseObj, snapshots }) : null;
  const name = (s)=> opts.redactNames ? (redactionMap.get(String(s)) || applyRedactionText(String(s), redactionMap)) : String(s);

  const lines = [];

  lines.push(`# Case: ${name(caseObj.title)} (ID ${caseObj.id})`);
  lines.push("");
  lines.push(`**Status:** ${caseObj.status}`);
  lines.push(`**Created:** ${caseObj.createdAt}`);
  lines.push(`**Updated:** ${caseObj.updatedAt}`);
  lines.push("");

  if (caseObj.summary){
    lines.push("## Summary");
    lines.push(applyRedactionText(String(caseObj.summary), redactionMap));
    lines.push("");
  }

  lines.push("## Entities");
  if (Array.isArray(caseObj.entities) && caseObj.entities.length){
    for (const e of caseObj.entities){
      lines.push(`- **${e.entityType}**: ${name(e.entityName)}`);
    }
  } else {
    lines.push("- (none attached)");
  }
  lines.push("");

  lines.push("## Notes");
  if (Array.isArray(caseObj.notes) && caseObj.notes.length){
    const chronological = [...caseObj.notes].reverse();
    for (const n of chronological){
      const note = applyRedactionText(String(n.note).replace(/\n/g, " "), redactionMap);
      lines.push(`- ${n.createdAt}: ${note}`);
    }
  } else {
    lines.push("- (no notes)");
  }
  lines.push("");

  // Evidence + scoring summary
  const scoreAgg = { groupScore:0, groupReasons:[], perPlayer:{} };
  const mergeScores = (s)=>{
    scoreAgg.groupScore = Math.min(100, Math.round((scoreAgg.groupScore + (s.groupScore||0))));
    scoreAgg.groupReasons.push(...(s.groupReasons||[]));
    for (const [player, v] of Object.entries(s.perPlayer||{})){
      const key = name(player);
      if (!scoreAgg.perPlayer[key]) scoreAgg.perPlayer[key] = { score:0, reasons:[] };
      scoreAgg.perPlayer[key].score = Math.min(100, scoreAgg.perPlayer[key].score + (v.score||0));
      scoreAgg.perPlayer[key].reasons.push(...(v.reasons||[]).map(r=>applyRedactionText(r, redactionMap)));
    }
  };

  lines.push("## Evidence Snapshots");
  if (!snapshots?.length){
    lines.push("- (no snapshots saved)");
  }

  for (const s of (snapshots || [])){
    lines.push("");
    lines.push(`### ${applyRedactionText(s.title || s.kind, redactionMap)} (snapshot ${s.id})`);
    lines.push(`- **Kind:** ${s.kind}`);
    lines.push(`- **Captured:** ${s.createdAt}`);

    if (!s.data){
      lines.push("- **Data:** (missing/unreadable)");
      continue;
    }

    if (String(s.kind) === "compare" && s.data?.settings){
      const st = s.data.settings || {};
      lines.push("");
      lines.push("#### Compare settings");
      lines.push(`- Window days: ${st.windowDays ?? "-"}`);
      lines.push(`- Min qty / gold threshold: ${st.minQty ?? "-"}`);

      // scoring from compare
      const sc = scoreFromCompareSnapshot(s.data);
      mergeScores(sc);

      lines.push("");
      lines.push("#### Players");
      const players = Array.isArray(s.data.players) ? s.data.players : [];
      if (!players.length){
        lines.push("- (none)");
      } else {
        for (const p of players){
          const clan = p.clan ? ` • clan: ${name(p.clan)}` : "";
          const mode = p.gameMode ? ` • mode: ${p.gameMode}` : "";
          const off = (p.hoursOffline == null) ? "" : ` • hoursOffline: ${p.hoursOffline}`;
          const lc = (p.logCount == null) ? "" : ` • logs: ${p.logCount}`;
          lines.push(`- ${name(p.name)}${mode}${clan}${off}${lc}`);
        }
      }

      lines.push("");
      lines.push("#### Name similarity (top pairs)");
      const pairs = Array.isArray(s.data.namePairs) ? s.data.namePairs : [];
      if (!pairs.length){
        lines.push("- (none)");
      } else {
        for (const p of pairs){
          const sim = (p.sim == null) ? "-" : formatPct(p.sim);
          const sameClan = p.sameClan ? ` • same clan (${name(p.clan || "")})` : "";
          const gap = (p.gapHours == null) ? "" : ` • offline gap: ${Math.round(p.gapHours)}h`;
          lines.push(`- ${name(p.a)} ↔ ${name(p.b)} • similarity ${sim}${sameClan}${gap}`);
        }
      }

      lines.push("");
      lines.push("#### Vault activity patterns");
      lines.push("(Heuristic surfacing only — verify in logs; same-clan rule applied.)");
      const vf = Array.isArray(s.data.vaultFindings) ? s.data.vaultFindings : [];
      if (!vf.length){
        lines.push("- (no vault findings in this compare window)");
      } else {
        for (const f of vf){
          lines.push("");
          lines.push(`- **Clan:** ${name(f.clanName)}`);
          lines.push(`  - depositors: ${f.depositors ?? "-"} • withdrawers: ${f.withdrawers ?? "-"}`);
          if (f.topWithdrawer){
            const share = (f.topWithdrawerShare == null) ? "-" : `${Math.round(f.topWithdrawerShare * 100)}%`;
            lines.push(`  - top withdrawer: ${name(f.topWithdrawer)} • qty: ${f.topWithdrawerQty ?? "-"} • share: ${share}`);
          }
          if (Array.isArray(f.topDepositors) && f.topDepositors.length){
            lines.push(`  - top depositors: ${f.topDepositors.map(name).join(", ")}`);
          }
          if (f.flag){
            lines.push("  - **Flag:** pattern matched thresholds");
          }
          if (Array.isArray(f.evidenceSequences) && f.evidenceSequences.length){
            lines.push("  - evidence sequences:");
            for (const ev of f.evidenceSequences){
              const e = applyRedactionText(String(ev).replace(/\n/g, " "), redactionMap);
              lines.push(`    - ${e}`);
            }
          }
        }
      }
    } else {
      lines.push("");
      lines.push("#### Snapshot data (JSON excerpt)");
      const raw = JSON.stringify(s.data, null, 2);
      const clipped = raw.length > 4000 ? raw.slice(0, 4000) + "\n…(truncated)…" : raw;
      lines.push("```json");
      lines.push(applyRedactionText(clipped, redactionMap));
      lines.push("```");
    }
  }

  lines.push("");
  lines.push("## Suspicion Scoring (Explainable)");
  lines.push("(Heuristic surfacing only — use as triage, not as proof.)");
  lines.push("");

  const per = Object.entries(scoreAgg.perPlayer)
    .map(([player, v])=>({ player, score: v.score, reasons: v.reasons }))
    .sort((a,b)=>b.score-a.score);

  if (!per.length){
    lines.push("- (no scoring signals derived from snapshots)");
  } else {
    for (const row of per.slice(0, 25)){
      lines.push(`- **${row.player}**: score ${Math.min(100, row.score)}`);
      const rs = row.reasons.slice(0, 6);
      for (const r of rs){
        lines.push(`  - ${r}`);
      }
    }
  }

  if (scoreAgg.groupReasons.length){
    lines.push("");
    lines.push("### Group-level signals");
    for (const r of scoreAgg.groupReasons.slice(0, 20)){
      lines.push(`- ${applyRedactionText(r, redactionMap)}`);
    }
  }

  if (opts.includeAppendix){
    lines.push("");
    lines.push("## Appendix");

    if (opts.redactNames && redactionMap && redactionMap.size){
      lines.push("");
      lines.push("### Appendix A: Redaction map");
      const entries = Array.from(redactionMap.entries());
      for (const [orig, token] of entries){
        lines.push(`- ${token}: ${orig}`);
      }
    }

    lines.push("");
    lines.push("### Appendix B: Snapshot JSON (truncated)");
    for (const s of (snapshots || []).slice(0, 10)){
      lines.push("");
      lines.push(`#### Snapshot ${s.id} (${s.kind})`);
      const raw = JSON.stringify(s.data, null, 2);
      const clipped = raw.length > 20000 ? raw.slice(0, 20000) + "\n…(truncated)…" : raw;
      lines.push("```json");
      lines.push(applyRedactionText(clipped, redactionMap));
      lines.push("```");
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("Generated by Idle Clans Sentinel.");

  const md = lines.join("\n");

  // Full standalone HTML — prints to PDF and PNG
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(name(caseObj.title))} — Case Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #ffffff;
      --fg: #111827;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #1d4ed8;
      --warn: #b45309;
      --success: #15803d;
      --red: #dc2626;
      --card-bg: #f9fafb;
      --tag-bg: #eff6ff;
      --tag-fg: #1e40af;
    }

    body {
      font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: var(--fg);
      background: var(--bg);
      padding: 40px 48px;
      max-width: 960px;
      margin: 0 auto;
    }

    /* ── Typography ── */
    h1 { font-size: 22px; font-weight: 800; color: var(--fg); margin-bottom: 6px; }
    h2 { font-size: 15px; font-weight: 800; color: var(--fg); text-transform: uppercase;
         letter-spacing: 0.07em; margin: 28px 0 12px; padding-top: 16px;
         border-top: 2px solid var(--border); }
    h3 { font-size: 13px; font-weight: 700; color: var(--fg); margin: 18px 0 8px; }
    h4 { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;
         letter-spacing: 0.06em; margin: 12px 0 6px; }
    p  { margin-bottom: 8px; }
    ul { padding-left: 20px; margin-bottom: 8px; }
    li { margin-bottom: 3px; }
    b  { font-weight: 700; }

    /* ── Header strip ── */
    .report-header { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 2px solid var(--border); }
    .report-meta   { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
    .badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 700;
             padding: 3px 10px; border-radius: 999px; border: 1px solid currentColor; }
    .badge-open   { color: var(--success); }
    .badge-closed { color: var(--muted); }
    .meta-text    { font-size: 12px; color: var(--muted); }

    /* ── Cards ── */
    .card {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 16px; margin-bottom: 10px;
    }
    .card + .card { margin-top: 0; }

    /* ── Participants ── */
    .participant-group { margin-bottom: 14px; }
    .participant-group-label { font-size: 11px; font-weight: 700; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-block; padding: 4px 12px; border-radius: 8px;
            background: var(--tag-bg); color: var(--tag-fg);
            font-size: 12px; font-weight: 600; border: 1px solid #bfdbfe; }

    /* ── Notes ── */
    .note { padding: 10px 14px; border-left: 3px solid var(--border);
            background: var(--card-bg); margin-bottom: 8px; border-radius: 0 8px 8px 0; }
    .note-ts { font-size: 11px; color: var(--muted); margin-bottom: 4px; }

    /* ── Evidence snapshot ── */
    .snapshot { border: 1px solid var(--border); border-radius: 10px;
                margin-bottom: 16px; overflow: hidden; page-break-inside: avoid; }
    .snapshot-header { padding: 12px 16px; background: #f3f4f6;
                       border-bottom: 1px solid var(--border); }
    .snapshot-body   { padding: 14px 16px; }
    .snapshot-kind   { display: inline-block; font-size: 11px; font-weight: 700;
                       padding: 2px 8px; border-radius: 4px;
                       background: #e0f2fe; color: #0369a1; margin-left: 8px; }
    .snapshot-ts     { font-size: 11px; color: var(--muted); margin-top: 4px; }

    /* ── Compare evidence sections ── */
    .evidence-section { margin-bottom: 14px; }
    .evidence-label   { font-size: 11px; font-weight: 700; color: var(--muted);
                        text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
    .pair-row { display: flex; align-items: center; gap: 10px; padding: 5px 0;
                border-bottom: 1px solid var(--border); font-size: 12px; }
    .pair-sim { font-weight: 700; min-width: 44px; text-align: right; color: var(--accent); }
    .pair-names { flex: 1; }
    .pair-meta  { color: var(--muted); font-size: 11px; }

    /* ── Vault findings ── */
    .vault-card { border: 1px solid var(--border); border-radius: 8px;
                  padding: 12px; margin-bottom: 8px; }
    .vault-flag { display: inline-block; font-size: 11px; font-weight: 700;
                  padding: 2px 8px; border-radius: 4px;
                  background: #fef3c7; color: var(--warn); border: 1px solid #fde68a; }
    .vault-stat { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .vault-withdrawer { font-size: 12px; margin-top: 6px; }
    .vault-withdrawer b { color: var(--red); }

    /* ── Scoring ── */
    .score-row { display: flex; justify-content: space-between; align-items: flex-start;
                 padding: 8px 0; border-bottom: 1px solid var(--border); gap: 12px; }
    .score-bar-wrap { width: 120px; flex-shrink: 0; }
    .score-bar-bg   { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .score-bar-fill { height: 100%; border-radius: 999px; background: var(--accent); }
    .score-reasons  { flex: 1; font-size: 11px; color: var(--muted); }
    .score-reasons li { margin-bottom: 1px; }

    /* ── Pre / JSON ── */
    pre { background: #f7f7f9; border: 1px solid var(--border); border-radius: 6px;
          padding: 10px 12px; font-size: 11px; overflow: auto; white-space: pre-wrap;
          word-break: break-all; }

    /* ── Footer ── */
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
              font-size: 11px; color: var(--muted); text-align: center; }

    /* ── Print overrides ── */
    @media print {
      body { padding: 20px 28px; font-size: 12px; }
      h1 { font-size: 20px; }
      h2 { font-size: 13px; page-break-before: auto; }
      .snapshot { page-break-inside: avoid; }
      .score-bar-wrap { display: none; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>

  <!-- ── Header ──────────────────────────────────────────────────────── -->
  <div class="report-header">
    <h1>Case: ${escHtml(name(caseObj.title))}</h1>
    <div class="report-meta">
      <span class="badge ${caseObj.status === "open" ? "badge-open" : "badge-closed"}">${escHtml(caseObj.status)}</span>
      <span class="meta-text">ID #${escHtml(String(caseObj.id))}</span>
      <span class="meta-text">·</span>
      <span class="meta-text">Created ${escHtml(caseObj.createdAt)}</span>
      <span class="meta-text">·</span>
      <span class="meta-text">Updated ${escHtml(caseObj.updatedAt)}</span>
    </div>
    ${caseObj.summary ? `<p style="margin-top:12px; color:#374151">${escHtml(applyRedactionText(caseObj.summary, redactionMap))}</p>` : ""}
  </div>

  <!-- ── Participants ───────────────────────────────────────────────── -->
  <h2>Participants</h2>
  ${(() => {
    const entities = caseObj.entities || [];
    if (!entities.length) return `<p style="color:var(--muted)">(none attached)</p>`;
    const clans   = entities.filter(e => e.entityType === "clan");
    const players = entities.filter(e => e.entityType === "player");
    const others  = entities.filter(e => e.entityType !== "clan" && e.entityType !== "player");
    const group = (label, items) => !items.length ? "" : `
      <div class="participant-group">
        <div class="participant-group-label">${escHtml(label)}</div>
        <div class="chips">${items.map(e => `<span class="chip">${escHtml(name(e.entityName))}</span>`).join("")}</div>
      </div>`;
    return group("Clans", clans) + group("Players", players) + group("Other", others);
  })()}

  <!-- ── Notes ─────────────────────────────────────────────────────── -->
  <h2>Notes</h2>
  ${(caseObj.notes || []).length === 0
    ? `<p style="color:var(--muted)">(no notes)</p>`
    : [...caseObj.notes].reverse().map(n => `
      <div class="note">
        <div class="note-ts">${escHtml(n.createdAt)}</div>
        <div>${escHtml(applyRedactionText(String(n.note).replace(/\n/g, " "), redactionMap))}</div>
      </div>`).join("")
  }

  <!-- ── Evidence Snapshots ─────────────────────────────────────────── -->
  <h2>Evidence Snapshots</h2>
  ${(snapshots || []).length === 0
    ? `<p style="color:var(--muted)">(no snapshots saved)</p>`
    : (snapshots || []).map(s => {
        const head = `
          <div class="snapshot-header">
            <div style="display:flex;align-items:center;gap:8px">
              <b>${escHtml(applyRedactionText(s.title || s.kind, redactionMap))}</b>
              <span class="snapshot-kind">${escHtml(s.kind)}</span>
            </div>
            <div class="snapshot-ts">Snapshot #${escHtml(String(s.id))} · Captured: ${escHtml(s.createdAt)}</div>
          </div>`;

        if (!s.data) return `<div class="snapshot">${head}<div class="snapshot-body" style="color:var(--muted)">(missing/unreadable)</div></div>`;

        if (s.kind === "compare" && s.data?.settings) {
          const st = s.data.settings || {};
          const players = s.data.players || [];
          const pairs   = s.data.namePairs || [];
          const vf      = s.data.vaultFindings || [];

          const playersHtml = !players.length
            ? `<p style="color:var(--muted)">(none)</p>`
            : `<div class="card"><ul style="list-style:none;padding:0">` + players.map(p => {
                const clan = p.clan ? ` · clan: ${escHtml(name(p.clan))}` : "";
                const mode = p.gameMode ? ` · ${escHtml(p.gameMode)}` : "";
                const off  = p.hoursOffline != null ? ` · offline: ${escHtml(p.hoursOffline)}h` : "";
                const lc   = p.logCount != null ? ` · logs: ${escHtml(p.logCount)}` : "";
                return `<li style="padding:4px 0;border-bottom:1px solid var(--border);font-size:12px"><b>${escHtml(name(p.name))}</b>${mode}${clan}${off}${lc}</li>`;
              }).join("") + `</ul></div>`;

          const pairsHtml = !pairs.length
            ? `<p style="color:var(--muted)">(none)</p>`
            : pairs.map(p => {
                const sim = p.sim == null ? "-" : formatPct(p.sim);
                const sameClan = p.sameClan ? ` · same clan (${escHtml(name(p.clan || ""))})` : "";
                const gap = p.gapHours != null ? ` · offline gap: ${Math.round(p.gapHours)}h` : "";
                return `<div class="pair-row">
                  <span class="pair-sim">${escHtml(sim)}</span>
                  <span class="pair-names"><b>${escHtml(name(p.a))}</b> ↔ <b>${escHtml(name(p.b))}</b></span>
                  <span class="pair-meta">${sameClan}${gap}</span>
                </div>`;
              }).join("");

          const vaultHtml = !vf.length
            ? `<p style="color:var(--muted)">(no vault findings)</p>`
            : vf.map(f => {
                const share = f.topWithdrawerShare == null ? "-" : Math.round(f.topWithdrawerShare * 100) + "%";
                const seq = (f.evidenceSequences || []).length
                  ? `<ul style="margin-top:6px">${f.evidenceSequences.map(ev => `<li style="font-size:11px;color:var(--muted)">${escHtml(applyRedactionText(String(ev).replace(/\n/g," "), redactionMap))}</li>`).join("")}</ul>`
                  : "";
                return `<div class="vault-card">
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                    <b>Clan: ${escHtml(name(f.clanName))}</b>
                    ${f.flag ? `<span class="vault-flag">⚠ Pattern matched</span>` : ""}
                  </div>
                  <div class="vault-stat">Depositors: ${escHtml(String(f.depositors ?? "-"))} · Withdrawers: ${escHtml(String(f.withdrawers ?? "-"))}</div>
                  ${f.topWithdrawer ? `<div class="vault-withdrawer">Top withdrawer: <b>${escHtml(name(f.topWithdrawer))}</b> · qty: ${escHtml(String(f.topWithdrawerQty ?? "-"))} · share: ${escHtml(share)}</div>` : ""}
                  ${(f.topDepositors || []).length ? `<div class="vault-stat">Top depositors: ${escHtml((f.topDepositors || []).map(name).join(", "))}</div>` : ""}
                  ${seq}
                </div>`;
              }).join("");

          return `<div class="snapshot">
            ${head}
            <div class="snapshot-body">
              <div class="evidence-section">
                <div class="evidence-label">Settings</div>
                <div style="font-size:12px;color:var(--muted)">Window: ${escHtml(String(st.windowDays ?? "-"))} days · Min qty/gold: ${escHtml(String(st.minQty ?? "-"))}</div>
              </div>
              <div class="evidence-section">
                <div class="evidence-label">Players (${escHtml(String(players.length))})</div>
                ${playersHtml}
              </div>
              <div class="evidence-section">
                <div class="evidence-label">Name similarity pairs (${escHtml(String(pairs.length))})</div>
                ${pairsHtml}
              </div>
              <div class="evidence-section">
                <div class="evidence-label">Vault activity patterns</div>
                <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Heuristic surfacing only — verify in logs.</p>
                ${vaultHtml}
              </div>
            </div>
          </div>`;
        }

        // Generic snapshot — show JSON
        const raw = JSON.stringify(s.data, null, 2);
        const clipped = raw.length > 4000 ? raw.slice(0, 4000) + "\n…(truncated)…" : raw;
        return `<div class="snapshot">
          ${head}
          <div class="snapshot-body">
            <h4>Snapshot data</h4>
            <pre>${escHtml(applyRedactionText(clipped, redactionMap))}</pre>
          </div>
        </div>`;
      }).join("")
  }

  <!-- ── Suspicion Scoring ───────────────────────────────────────────── -->
  <h2>Suspicion Scoring (Heuristic)</h2>
  <p style="color:var(--muted);font-size:12px;margin-bottom:14px">Signals derived from evidence snapshots. Use as triage, not as proof.</p>
  ${per.length === 0
    ? `<p style="color:var(--muted)">(no scoring signals derived from snapshots)</p>`
    : per.slice(0, 25).map(row => {
        const pct = Math.min(100, row.score);
        return `<div class="score-row">
          <div style="flex:1">
            <b>${escHtml(row.player)}</b>
            <ul class="score-reasons">${row.reasons.slice(0,6).map(r=>`<li>${escHtml(r)}</li>`).join("")}</ul>
          </div>
          <div class="score-bar-wrap">
            <div style="font-size:12px;font-weight:700;text-align:right;margin-bottom:4px">${escHtml(String(pct))}/100</div>
            <div class="score-bar-bg"><div class="score-bar-fill" style="width:${pct}%"></div></div>
          </div>
        </div>`;
      }).join("")
  }
  ${scoreAgg.groupReasons.length ? `
    <h3>Group-level signals</h3>
    <ul>${scoreAgg.groupReasons.slice(0,20).map(r=>`<li>${escHtml(applyRedactionText(r,redactionMap))}</li>`).join("")}</ul>
  ` : ""}

  ${opts.includeAppendix ? `
  <!-- ── Appendix ──────────────────────────────────────────────────── -->
  <h2>Appendix</h2>
  ${opts.redactNames && redactionMap && redactionMap.size ? `
    <h3>Redaction map</h3>
    <ul>${Array.from(redactionMap.entries()).map(([orig,token])=>`<li><b>${escHtml(token)}</b> → ${escHtml(orig)}</li>`).join("")}</ul>
  ` : ""}
  <h3>Snapshot JSON (truncated)</h3>
  ${(snapshots||[]).slice(0,10).map(s=>{
    const raw = JSON.stringify(s.data, null, 2);
    const clipped = raw.length > 8000 ? raw.slice(0, 8000) + "\n…(truncated)…" : raw;
    return `<h4>Snapshot #${escHtml(String(s.id))} (${escHtml(s.kind)})</h4><pre>${escHtml(applyRedactionText(clipped, redactionMap))}</pre>`;
  }).join("")}
  ` : ""}

  <div class="footer">Generated by Idle Clans Sentinel · Case #${escHtml(String(caseObj.id))}</div>

</body>
</html>`;

  const baseName = `case_${caseObj.id}_${slugify(caseObj.title)}`;
  return { md, html, baseName };
}
