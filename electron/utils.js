/**
 * electron/utils.js
 *
 * Pure utility functions extracted from services.js.
 * No DB, no API, no IPC — safe to import anywhere and easy to unit test.
 */

/**
 * Returns true if the recovery file should be SKIPPED.
 * Protects against overwriting a large existing DB with a suspiciously small export.
 */
export function shouldSkipRecovery(existingSizeBytes, exportSizeBytes){
  if (existingSizeBytes >= 1_000_000 && exportSizeBytes <= 300_000) return true;
  return false;
}

/**
 * Parses a vault event log message into structured data.
 * Expected format: "ActorName added 1,234 x Item Name."
 *                  "ActorName withdrew 500 Iron Ore."
 * As of the vault tiers update, item names may carry a trailing vault-tier
 * qualifier, e.g. "Otherworldly essence (Tier 2)". This qualifier reflects
 * which of the game's 4 vault storage tiers the item occupies — it is not
 * part of the item's actual name/identity, so it's extracted separately as
 * `tier` (1-4, or null if absent) and stripped from `item`.
 * Returns { actor, action: "added"|"withdrew", qty, item, tier } or null.
 */
export function parseVaultEventMessage(raw){
  const s = String(raw || "").trim();
  const m = s.match(/^(.*?)\s+(added|withdrew)\s+([\d,]+)\s*(x)?\s*(.+?)\.\s*$/i);
  if (!m) return null;
  const actor  = String(m[1] || "").trim();
  const action = m[2].toLowerCase() === "added" ? "added" : "withdrew";
  const qty    = Number(String(m[3]).replace(/,/g, ""));
  let   item   = String(m[5] || "").trim();
  if (!actor || !Number.isFinite(qty) || qty <= 0 || !item) return null;

  // Strip a trailing "(Tier N)" qualifier, if present.
  let tier = null;
  const tierM = item.match(/^(.*?)\s*\(\s*tier\s*([1-4])\s*\)\s*$/i);
  if (tierM){
    item = tierM[1].trim();
    tier = Number(tierM[2]);
  }

  if (!item) return null;
  return { actor, action, qty, item, tier };
}

/**
 * Escapes a value for safe inclusion in a CSV cell.
 * Wraps in quotes and doubles internal quotes when necessary.
 */
export function csvEscape(v){
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[\n\r",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Returns a human-readable rank label for a clan member rank integer.
 * 2 = Owner, 1 = Deputy, anything else = Member.
 */
export function rankLabel(rank){
  if (rank === 2) return "Owner";
  if (rank === 1) return "Deputy";
  return "Member";
}

/**
 * Builds a word-boundary regex for detecting a player name mention
 * in a chat message body, case-insensitively.
 * Escapes special regex characters in the name.
 */
export function buildMentionRegex(lowerName){
  const escaped = lowerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9_])${escaped}(?![a-z0-9_])`, "i");
}

/**
 * Extracts the message body from a raw chat line.
 * Raw format: "[HH:MM:SS] [ClanTag] SenderName: body text"
 * Returns everything after the first ": ", or the full string if not found.
 */
export function extractChatBody(msgText){
  const colonIdx = String(msgText || "").indexOf(": ");
  return colonIdx >= 0 ? msgText.slice(colonIdx + 2) : msgText;
}
