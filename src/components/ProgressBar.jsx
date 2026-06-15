import React from "react";

export default function ProgressBar({ current = 0, total = 0, label = "" }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  return (
    <div className="progressWrap" aria-label={label || "Progress"}>
      <div className="progressTop">
        <div className="progressLabel">{label}</div>
        <div className="progressNums">{total ? `${current}/${total}` : ""}</div>
      </div>
      <div className="progressTrack">
        <div className="progressFill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
