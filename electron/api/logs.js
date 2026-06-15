/**
 * electron/api/logs.js
 *
 * API-layer helpers that touch both the player and clan domains:
 *   - insertLogs     — fetches and stores entity log entries from the API
 *   - recheckNotFoundEntity — re-fetches a 404'd player or clan to see if it's back
 *
 * These live here rather than in players.js or clans.js because they depend on
 * both upsertPlayerFromApi and upsertClanFromApi.
 *
 * Dependencies: db/core, shared/helpers, api/client, saveDb (injected)
 */

import { exec, one, lower, nowIso } from "../db/core.js";
import {
  insertAlert,
  isTrackedEnabled,
  alertsOnlyTracked,
  joinLeaveAlertsEnabled,
  log,
} from "../shared/helpers.js";

let _saveDb          = null;
let _apiGetJsonAllow404 = null;
let _upsertPlayerFromApi = null;
let _upsertClanFromApi   = null;

export const API_BASE_LOGS = "https://query.idleclans.com/api";

export function initLogs({ saveDb, apiGetJsonAllow404, upsertPlayerFromApi, upsertClanFromApi }){
  _saveDb              = saveDb;
  _apiGetJsonAllow404  = apiGetJsonAllow404;
  _upsertPlayerFromApi = upsertPlayerFromApi;
  _upsertClanFromApi   = upsertClanFromApi;
}

// ── insertLogs ────────────────────────────────────────────────────────────────

export async function insertLogs(entityType, entityName, { signal } = {}){
  const updatedAt = nowIso();
  let url = null;
  if (entityType === "player"){
    url = `${API_BASE_LOGS}/Player/clan-logs/${encodeURIComponent(entityName)}?skip=0&limit=500`;
  } else if (entityType === "clan"){
    url = `${API_BASE_LOGS}/Clan/logs/clan/${encodeURIComponent(entityName)}?skip=0&limit=500`;
  } else {
    return { ok:false };
  }

  const arr = await _apiGetJsonAllow404(url, { signal });
  if (arr === null) return { ok:true, inserted:0, empty:true };

  if (Array.isArray(arr)){
    for (const e of arr){
      const ts  = e.timestamp || updatedAt;
      const msg = e.message || JSON.stringify(e);
      log(entityType, entityName, msg, ts, e);

      // Backfill clan history from player logs
      if (entityType === "player" && typeof e.message === "string"){
        const join  = e.message.match(/has joined the clan:\s*(.+)$/i);
        const leave = e.message.match(/left the clan:\s*(.+)$/i);
        if (join){
          exec(
            "INSERT OR IGNORE INTO player_clan_history(playerLower, fromClan, toClan, timestamp, source) VALUES(?,?,?,?,?)",
            [lower(entityName), null, join[1].trim(), ts, "playerLog"]
          );
          if (joinLeaveAlertsEnabled() && (!alertsOnlyTracked() || isTrackedEnabled("player", entityName))){
            insertAlert({
              type: "clanJoin", entityType: "player", entityName, severity: "info",
              message: `${entityName} joined clan ${join[1].trim()} (${ts}).`,
            });
          }
        } else if (leave){
          exec(
            "INSERT OR IGNORE INTO player_clan_history(playerLower, fromClan, toClan, timestamp, source) VALUES(?,?,?,?,?)",
            [lower(entityName), leave[1].trim(), null, ts, "playerLog"]
          );
          if (joinLeaveAlertsEnabled() && (!alertsOnlyTracked() || isTrackedEnabled("player", entityName))){
            insertAlert({
              type: "clanLeave", entityType: "player", entityName, severity: "warn",
              message: `${entityName} left clan ${leave[1].trim()} (${ts}).`,
            });
          }
        }
      }

      // Backfill clan history from clan logs
      if (entityType === "clan" && typeof e.message === "string"){
        const m      = e.message.trim();
        const joined = m.match(/^(.+?)\s+(?:has\s+)?joined\s+the\s+clan/i);
        const left   = m.match(/^(.+?)\s+(?:has\s+)?left\s+the\s+clan/i);
        const kicked = m.match(/^(.+?)\s+(?:was\s+)?kicked\s+from\s+the\s+clan/i);
        if (joined){
          const playerName = joined[1].trim();
          exec(
            "INSERT OR IGNORE INTO player_clan_history(playerLower, fromClan, toClan, timestamp, source) VALUES(?,?,?,?,?)",
            [lower(playerName), null, entityName, ts, "clanLog"]
          );
          if (joinLeaveAlertsEnabled() && (!alertsOnlyTracked() || isTrackedEnabled("clan", entityName))){
            insertAlert({ type:"memberJoin", entityType:"clan", entityName, severity:"info",
              message:`${playerName} joined ${entityName} (${ts}).` });
          }
        } else if (left){
          const playerName = left[1].trim();
          exec(
            "INSERT OR IGNORE INTO player_clan_history(playerLower, fromClan, toClan, timestamp, source) VALUES(?,?,?,?,?)",
            [lower(playerName), entityName, null, ts, "clanLog"]
          );
          if (joinLeaveAlertsEnabled() && (!alertsOnlyTracked() || isTrackedEnabled("clan", entityName))){
            insertAlert({ type:"memberLeave", entityType:"clan", entityName, severity:"warn",
              message:`${playerName} left ${entityName} (${ts}).` });
          }
        } else if (kicked){
          const playerName = kicked[1].trim();
          exec(
            "INSERT OR IGNORE INTO player_clan_history(playerLower, fromClan, toClan, timestamp, source) VALUES(?,?,?,?,?)",
            [lower(playerName), entityName, null, ts, "clanLog"]
          );
          if (joinLeaveAlertsEnabled() && (!alertsOnlyTracked() || isTrackedEnabled("clan", entityName))){
            insertAlert({ type:"memberKicked", entityType:"clan", entityName, severity:"warn",
              message:`${playerName} was kicked from ${entityName} (${ts}).` });
          }
        }
      }
    }
  }
  _saveDb();
  return { ok:true };
}

// ── recheckNotFoundEntity ─────────────────────────────────────────────────────

export async function recheckNotFoundEntity({ entityType, name } = {}){
  const et = String(entityType || "").toLowerCase();
  const nm = String(name || "").trim();
  if (!nm) return { ok:false, error:"Name required" };
  if (et === "player") return _upsertPlayerFromApi(nm);
  if (et === "clan")   return _upsertClanFromApi(nm);
  return { ok:false, error:"Invalid entityType" };
}
