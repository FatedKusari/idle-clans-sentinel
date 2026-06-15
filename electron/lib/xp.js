export function fmtXp(x){
  const n = Number(x||0);
  if (!isFinite(n)) return "0";
  if (n >= 1e9) return (n/1e9).toFixed(2).replace(/\.00$/,"") + "B";
  if (n >= 1e6) return (n/1e6).toFixed(2).replace(/\.00$/,"") + "M";
  if (n >= 1e3) return (n/1e3).toFixed(2).replace(/\.00$/,"") + "K";
  return Math.round(n).toLocaleString();
}

// Convert cumulative XP to skill level using src/lib/xpTable.js.
// This is intentionally fast (binary search) because it's used across the UI.
import xpThresholds from "./xpTable.js";

export function xpToLevel(xp){
  const x = Number(xp || 0);
  if (!isFinite(x) || x <= 0) return 1;

  // xpThresholds[lvl] = cumulative XP required for that level.
  // Find max lvl where threshold <= xp.
  let lo = 1;
  let hi = xpThresholds.length - 1;
  let best = 1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    const req = Number(xpThresholds[mid] || 0);
    if (req <= x){
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
