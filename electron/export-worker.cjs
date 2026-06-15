/**
 * electron/export-worker.cjs
 *
 * Runs in a worker_threads Worker. Opens the SQLite DB read-only and streams
 * every table row-by-row to a JSON file, posting progress back to the main
 * thread as it goes. Never touches the main process heap.
 *
 * workerData: { dbPath, destPath }
 * Messages posted to parent:
 *   { type: "progress", table, tableRows, totalRows }
 *   { type: "done",     counts, failedTables, totalRows }
 *   { type: "error",    message }
 */

"use strict";

const { workerData, parentPort } = require("worker_threads");
const BetterSqlite3 = require("better-sqlite3");
const fs            = require("fs");
const path          = require("path");

const { dbPath, destPath } = workerData;

const TABLES = [
  "players", "clans", "clan_members", "tracked",
  "player_clan_history", "logs", "alerts",
  "cases", "case_entities", "case_notes", "case_snapshots",
  "pvm_snapshots", "pvm_samples", "clan_pvm_snapshots",
  "leaderboard_cache", "leaderboard_snapshots", "leaderboard_snapshot_rows",
  "leaderboard_watches", "presence_samples",
  "game_news", "market_prices",
  "verified_accounts", "account_skill_snapshots",
  "settings", "chat_messages", "player_chat_flags",
];

// How many rows to write before yielding a progress update
const PROGRESS_INTERVAL = 5000;

async function run() {
  let db;
  try {
    db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
  } catch (e) {
    parentPort.postMessage({ type: "error", message: `Cannot open DB: ${e.message}` });
    return;
  }

  const counts      = {};
  const errors      = {};
  let   totalRows   = 0;

  // Open write stream
  const ws = fs.createWriteStream(destPath, { encoding: "utf8" });

  // Wrap writes in a helper so we can await the drain event when the
  // internal buffer fills up — this is what keeps the worker from
  // running ahead of disk and blowing its own heap.
  function write(chunk) {
    return new Promise((resolve) => {
      const ok = ws.write(chunk);
      if (ok) { resolve(); return; }
      ws.once("drain", resolve);
    });
  }

  try {
    await write("{\n");

    let firstTable = true;

    for (const table of TABLES) {
      let rowIdx = 0;

      try {
        // Check if table exists first
        const exists = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);

        if (!exists) {
          counts[table] = 0;
          continue;
        }

        const tableKey = JSON.stringify(table);
        await write(`${firstTable ? "" : ","}\n  ${tableKey}: [\n`);
        firstTable = false;

        const stmt = db.prepare(`SELECT * FROM ${table}`);

        for (const row of stmt.iterate()) {
          const comma = rowIdx > 0 ? "," : "";
          await write(`    ${comma}${JSON.stringify(row)}\n`);
          rowIdx++;
          totalRows++;

          // Post progress periodically without blocking
          if (rowIdx % PROGRESS_INTERVAL === 0) {
            parentPort.postMessage({
              type:      "progress",
              table,
              tableRows: rowIdx,
              totalRows,
            });
          }
        }

        await write(`  ]`);
        counts[table] = rowIdx;

      } catch (e) {
        errors[table]  = e?.message || String(e);
        counts[table]  = rowIdx;
        console.error(`[export-worker] table '${table}' failed at row ${rowIdx}:`, e?.message);

        // Close the array if we opened it
        if (rowIdx > 0 || !firstTable) {
          await write(`  ]`);
        } else {
          // Table failed before we wrote the opening bracket
          const tableKey = JSON.stringify(table);
          await write(`${firstTable ? "" : ","}\n  ${tableKey}: []`);
          firstTable = false;
          counts[table] = 0;
        }
      }

      parentPort.postMessage({
        type:      "progress",
        table,
        tableRows: rowIdx,
        totalRows,
      });
    }

    // Write _meta as final key
    const failedTables = Object.keys(errors);
    const meta = {
      version:      1,
      exportedAt:   new Date().toISOString(),
      totalRows,
      counts,
      ...(failedTables.length ? { failedTables, errors } : {}),
    };
    await write(`,\n  "_meta": ${JSON.stringify(meta, null, 2)}\n}\n`);

    await new Promise((resolve, reject) => {
      ws.end((err) => err ? reject(err) : resolve());
    });

    db.close();

    parentPort.postMessage({
      type: "done",
      counts,
      failedTables,
      totalRows,
      destPath,
    });

  } catch (fatal) {
    try { ws.destroy(); } catch {}
    try { db?.close(); } catch {}
    // Clean up partial file
    try { fs.unlinkSync(destPath); } catch {}
    parentPort.postMessage({ type: "error", message: fatal?.message || String(fatal) });
  }
}

run().catch((e) => {
  parentPort.postMessage({ type: "error", message: e?.message || String(e) });
});
