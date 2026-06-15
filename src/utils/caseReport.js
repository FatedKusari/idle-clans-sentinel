// src/utils/caseReport.js

export function escHtml(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slugify(s){
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export function formatPct(x){
  if (x === null || x === undefined) return "-";
  const n = Number(x);
  if (!isFinite(n)) return "-";
  const pct = n * 100;
  const rounded1 = Math.round(pct * 10) / 10;
  const isWhole = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9;
  return (isWhole ? Math.round(rounded1) : rounded1.toFixed(1)) + "%";
}

export function escapeRegex(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRedactionMap({ caseObj, snapshots }){
  const playerNames = new Set();
  const clanNames = new Set();

  for (const e of (caseObj?.entities || [])){
    if (e.entityType === "player") playerNames.add(e.entityName);
    if (e.entityType === "clan") clanNames.add(e.entityName);
  }

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
const REPORT_LOGO_B64 = "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";

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
    perPlayer: {},
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
        const depName = typeof dep === "object" && dep !== null ? (dep.name ?? "") : String(dep);
        const d = ensure(depName);
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

  const depositorName = (d) => name(typeof d === "object" && d !== null ? (d.name ?? "") : d);

  const depositorLabel = (d) => {
    if (typeof d === "object" && d !== null){
      const n = name(d.name ?? "");
      return d.qty != null ? `${n} (${Number(d.qty).toLocaleString()})` : n;
    }
    return name(d);
  };

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
      lines.push("(These patterns are automatically detected clues — always check the raw logs before drawing conclusions.)");
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
            lines.push(`  - top depositors: ${f.topDepositors.map(depositorLabel).join(", ")}`);
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
  lines.push("(These scores are automatically generated starting points — not conclusions. Always verify with raw evidence.)");
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
    <div style="display:flex; align-items:center; gap:14px; margin-bottom:12px;">
      <img src="data:image/png;base64,${REPORT_LOGO_B64}" alt="Idle Clans Sentinel"
           style="width:44px; height:44px; border-radius:10px; flex-shrink:0;" />
      <div>
        <div style="font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Idle Clans Sentinel · Case Report</div>
        <h1 style="margin:0">Case: ${escHtml(name(caseObj.title))}</h1>
      </div>
    </div>
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
                  ${(f.topDepositors || []).length ? `<div class="vault-stat">Top depositors: ${escHtml((f.topDepositors || []).map(depositorLabel).join(", "))}</div>` : ""}
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
                <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Automatically detected patterns — always verify against the raw vault logs before acting.</p>
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
  <h2>Suspicion Scoring</h2>
  <p style="color:var(--muted);font-size:12px;margin-bottom:14px">Automatically calculated signals based on the evidence snapshots below. These are starting points for investigation — not conclusions. Always verify with the raw data.</p>
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

  <div class="footer" style="display:flex; align-items:center; justify-content:center; gap:8px;">
    <img src="data:image/png;base64,${REPORT_LOGO_B64}" alt="" style="width:16px; height:16px; border-radius:3px; opacity:0.5;" />
    Generated by Idle Clans Sentinel · Case #${escHtml(String(caseObj.id))}
  </div>

</body>
</html>`;

  const baseName = `case_${caseObj.id}_${slugify(caseObj.title)}`;
  return { md, html, baseName };
}
