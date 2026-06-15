const MODE_MAP = {
  default:      "Normal",
  ironman:      "Ironman",
  groupironman: "Group Ironman",
  notselected:  "Not Selected",
  unknown:      "Unknown",
  any:          "Any",
};

export function modeLabel(mode){
  if (mode === null || mode === undefined) return "—";
  const key = String(mode).toLowerCase();
  return MODE_MAP[key] ?? (mode || "—");
}


export function formatAgo(value){
  if (!value) return "—";
  const ms = value instanceof Date
    ? Date.now() - value.getTime()
    : Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  if (m > 0)  return `${m}m ago`;
  if (s >= 5) return `${s}s ago`;
  return "just now";
}

export function formatBytes(b){
  if (b === null || b === undefined) return "—";
  const n = Number(b);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(2) + " GB";
  if (n >= 1_048_576)     return (n / 1_048_576).toFixed(2) + " MB";
  if (n >= 1_024)         return (n / 1_024).toFixed(1) + " KB";
  return n + " B";
}
