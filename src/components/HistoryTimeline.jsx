import React from "react";

function fmt(ts){
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function eventLabel(e){
  const from = e.fromClan || null;
  const to = e.toClan || null;
  if (!from && to) return "Joined";
  if (from && !to) return "Left";
  if (from && to) return "Moved";
  return "Updated";
}

export default function HistoryTimeline({ title, items, emptyText }){
  const formatSources = (e) => {
    const raw = (e && (e.sources ?? e.source)) ?? "";
    const parts = String(raw)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    // de-dupe while keeping order
    const uniq = [];
    for (const p of parts){
      if (!uniq.includes(p)) uniq.push(p);
    }
    if (uniq.length === 0) return null;
    return uniq.join(" + ");
  };

  return (
    <div>
      {title && <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>}
      {(!items || items.length === 0) ? (
        <div className="small">{emptyText || "No history yet."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((e, idx) => (
            <div key={`${e.timestamp || ""}-${idx}`} className="card" style={{ padding: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <span className="pill" style={{ padding: "4px 10px" }}>
                    <span className="pillDot" />
                    {eventLabel(e)}
                  </span>
                  {e.playerName && (
                    <div style={{ fontWeight: 700 }}>{e.playerName}</div>
                  )}
                </div>
                <div className="small" style={{ opacity: 0.9 }}>{fmt(e.timestamp)}</div>
              </div>

              <div className="small" style={{ marginTop: 6 }}>
                {e.fromClan || "None"} <span style={{ opacity: 0.7 }}>→</span> {e.toClan || "None"}
                {formatSources(e) ? <span style={{ opacity: 0.7 }}> · {formatSources(e)}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
