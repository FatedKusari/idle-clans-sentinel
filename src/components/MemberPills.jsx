import React from "react";

export default function MemberPills({ members, similarGroups, similarMeta }){
  return (
    <div className="row">
      {members.map(m=>{
        const offline7d = isOfflineOver7Days(m);
        return (
          <span key={m.memberLower || m.memberName} className={pillClass(m, similarGroups)} title={pillTitle(m, similarMeta)}>
            <span className={offline7d ? "pillDot pillDotOff" : "pillDot"} />
            {m.memberName}
            {m.bannedAt ? <span className="badge badgeBanned badgeInline" title={`Banned: ${new Date(m.bannedAt).toLocaleString()}`}>B</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function tooltip(m){
  const parts = [];
  if (m.rankLabel) parts.push(`Rank: ${m.rankLabel}`);

  if (typeof m.hoursOffline === "number") {
    const lo = formatLastOnline(m);
    parts.push(`Last online: ${lo || "unknown"}`);
  }

  if (m.lastScannedAt) parts.push(`Last scanned: ${new Date(m.lastScannedAt).toLocaleString()}`);
  if (m.lastUpdatedAt) parts.push(`Last updated: ${new Date(m.lastUpdatedAt).toLocaleString()}`);
  return parts.join("\n");
}

function pillClass(m, similarGroups){
  const base = ["pill"];
  const key = m.memberLower || String(m.memberName || "").toLowerCase();
  const group = similarGroups && Object.prototype.hasOwnProperty.call(similarGroups, key) ? similarGroups[key] : null;
  if (Number.isInteger(group)){
    base.push("pillSim", `pillSim${group % 8}`);
  }
  return base.join(" ");
}

function pillTitle(m, similarMeta){
  const base = tooltip(m);
  const key = m.memberLower || String(m.memberName || "").toLowerCase();
  const meta = similarMeta && similarMeta[key];
  if (meta && Array.isArray(meta.peers) && meta.peers.length){
    return `${base} • Similar: ${meta.peers.join(", ")}`;
  }
  return base;
}


function isOfflineOver7Days(m){
  return typeof m.hoursOffline === "number" && m.hoursOffline >= 24 * 7;
}

function formatLastOnline(m){
  if (!m || typeof m.hoursOffline !== "number") return "";

  // Prefer a timestamp that corresponds to when hoursOffline was measured.
  // Fallback to other known timestamp fields, and finally Date.now().
  const baseRaw =
    m.lastScannedAt ??
    m.lastUpdatedAt ??
    m.lastScanned ??
    m.lastUpdated ??
    m.updatedAt ??
    m.updated ??
    Date.now();

  // lastScannedAt/lastUpdatedAt are stored as ISO strings in the DB.
  // Convert to epoch ms safely.
  let baseMs = null;
  if (typeof baseRaw === "number") baseMs = baseRaw;
  else if (typeof baseRaw === "string") {
    const parsed = Date.parse(baseRaw);
    baseMs = Number.isFinite(parsed) ? parsed : null;
  } else {
    const n = Number(baseRaw);
    baseMs = Number.isFinite(n) ? n : null;
  }
  if (!Number.isFinite(baseMs)) baseMs = Date.now();

  const lastOnlineAt = baseMs - m.hoursOffline * 3600 * 1000;
  const diffMs = Date.now() - lastOnlineAt;
  if (!Number.isFinite(diffMs)) return "";

  const mins = Math.floor(diffMs / 60000);
  if (mins < 10) return "recently";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
