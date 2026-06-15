/**
 * electron/services/market.js
 *
 * Market prices, news, and related read functions.
 * Dependencies: db/core (exec, all, one, nowIso, gameDataCache), saveDb, apiGetJson (via services.js)
 */

import { exec, all, one, nowIso, getDb, gameDataCache } from "../db/core.js";

// saveDb and apiGetJson are injected to avoid circular imports while services.js
// still owns the rate-limit chain and backup logic.
let _saveDb    = null;
let _apiGetJson = null;

export function initMarket({ saveDb, apiGetJson }){
  _saveDb     = saveDb;
  _apiGetJson = apiGetJson;
}

// ── News ──────────────────────────────────────────────────────────────────────

export async function fetchLatestNews({ signal } = {}){
  const API_BASE = "https://query.idleclans.com/api";
  const url = `${API_BASE}/news/latest`;
  try{
    const data = await _apiGetJson(url, { signal });
    const now = new Date().toISOString();
    const items = Array.isArray(data) ? data : (data ? [data] : []);
    let inserted = 0;
    for (const item of items){
      const newsId = String(item?.id ?? item?.newsId ?? item?.title ?? now);
      const existing = one("SELECT id FROM game_news WHERE newsId=?", [newsId]);
      if (!existing){
        exec(
          "INSERT INTO game_news(newsId,title,body,category,publishedAt,fetchedAt,rawJson) VALUES(?,?,?,?,?,?,?)",
          [newsId, item?.title||null, item?.body||item?.content||item?.description||null,
           item?.category||item?.type||null, item?.publishedAt||item?.date||null, now, JSON.stringify(item)]
        );
        inserted++;
      }
    }
    _saveDb();
    const latest = one("SELECT * FROM game_news ORDER BY COALESCE(publishedAt,fetchedAt) DESC, id DESC LIMIT 1");
    return { ok:true, inserted, latest: latest || null };
  }catch(err){
    const latest = one("SELECT * FROM game_news ORDER BY COALESCE(publishedAt,fetchedAt) DESC, id DESC LIMIT 1");
    return { ok:false, error:String(err?.message||err), latest: latest || null };
  }
}

export function listNews({ limit=50, offset=0 } = {}){
  const rows = all(
    "SELECT id,newsId,title,body,category,publishedAt,fetchedAt,rawJson FROM game_news ORDER BY COALESCE(publishedAt,fetchedAt) DESC, id DESC LIMIT ? OFFSET ?",
    [limit, offset]
  );
  const total = one("SELECT COUNT(*) AS n FROM game_news")?.n || 0;
  return { rows: rows||[], total };
}

// ── Market prices ─────────────────────────────────────────────────────────────

export async function fetchMarketPrices({ includeAverage=true, signal } = {}){
  const API_BASE = "https://query.idleclans.com/api";
  const url = `${API_BASE}/PlayerMarket/items/prices/latest${includeAverage ? "?includeAveragePrice=true" : ""}`;
  const data = await _apiGetJson(url, { signal });
  const now = nowIso();

  const raw = Array.isArray(data) ? data
    : (Array.isArray(data?.items) ? data.items
    : (Array.isArray(data?.data) ? data.data : []));

  if (!raw.length) return { ok:true, count:0, fetchedAt:now };

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO market_prices(itemId,lowestSellPrice,lowestPriceVolume,highestBuyPrice,highestPriceVolume,dailyAveragePrice,fetchedAt)
     VALUES(?,?,?,?,?,?,?)`
  );
  const txn = db.transaction(()=>{
    for (const item of raw){
      if (!item || typeof item !== "object") continue;
      const id = Number(item.itemId ?? -1);
      if (!Number.isFinite(id) || id < 0) continue;
      insert.run(
        id,
        Number(item.lowestSellPrice   ?? 0) || 0,
        Number(item.lowestPriceVolume  ?? 0) || 0,
        Number(item.highestBuyPrice    ?? 0) || 0,
        Number(item.highestPriceVolume ?? 0) || 0,
        (item.dailyAveragePrice != null ? Number(item.dailyAveragePrice) : null),
        now
      );
    }
  });
  txn();
  exec("DELETE FROM market_prices WHERE fetchedAt < datetime('now', '-30 days')");
  _saveDb();
  return { ok:true, count:raw.length, fetchedAt:now };
}

export function getMarketSnapshot(){
  const latest = one("SELECT MAX(fetchedAt) AS ts FROM market_prices");
  if (!latest?.ts) return { rows:[], fetchedAt:null };
  const rows = all(
    `SELECT itemId,lowestSellPrice,lowestPriceVolume,highestBuyPrice,highestPriceVolume,dailyAveragePrice
     FROM market_prices WHERE fetchedAt=?`,
    [latest.ts]
  );
  const enrichedById = gameDataCache.enrichedById || {};
  const enriched = (rows||[]).map(r=>{
    const item = enrichedById[r.itemId] || null;
    return {
      ...r,
      name:          item?.name       || null,
      baseValue:     item?.baseValue  || 0,
      canSellToGame: item ? !!item.canSellToGame : true,
    };
  });
  return { rows:enriched, fetchedAt:latest.ts };
}

export function getMarketPriceChanges({ minChangePct=0, limit=500 } = {}){
  const times = all("SELECT DISTINCT fetchedAt FROM market_prices ORDER BY fetchedAt DESC LIMIT 2");
  if (!times || times.length < 2) return { rows:[], snapshotA:null, snapshotB:null };
  const [nowTs, prevTs] = [times[0].fetchedAt, times[1].fetchedAt];
  const rows = all(`
    SELECT * FROM (
      SELECT n.itemId,
        p.lowestSellPrice AS prevPrice, n.lowestSellPrice AS currPrice,
        n.lowestPriceVolume AS currVol, n.highestBuyPrice, n.dailyAveragePrice,
        CASE WHEN p.lowestSellPrice > 0
          THEN CAST(n.lowestSellPrice - p.lowestSellPrice AS REAL) / p.lowestSellPrice
          ELSE NULL END AS changePct
      FROM market_prices n
      JOIN market_prices p ON n.itemId=p.itemId AND p.fetchedAt=?
      WHERE n.fetchedAt=? AND n.lowestSellPrice != p.lowestSellPrice
    ) WHERE changePct IS NOT NULL AND ABS(changePct) >= ?
    ORDER BY ABS(changePct) DESC LIMIT ?
  `, [prevTs, nowTs, Number(minChangePct)/100, limit]);
  const itemsById = gameDataCache.itemsById || {};
  const enriched = (rows||[]).map(r=>{
    const item = itemsById[r.itemId];
    const name = typeof item === "string" ? item : null;
    return { ...r, name };
  });
  return { rows:enriched, snapshotA:prevTs, snapshotB:nowTs };
}

export function getMarketTopVolume({ limit=100 } = {}){
  const latest = one("SELECT MAX(fetchedAt) AS ts FROM market_prices");
  if (!latest?.ts) return { rows:[], fetchedAt:null };
  const rows = all(
    `SELECT itemId,lowestSellPrice,lowestPriceVolume,highestBuyPrice,highestPriceVolume,dailyAveragePrice
     FROM market_prices WHERE fetchedAt=? AND lowestPriceVolume>0
     ORDER BY lowestPriceVolume DESC LIMIT ?`,
    [latest.ts, limit]
  );
  const itemsById = gameDataCache.itemsById || {};
  const enriched = (rows||[]).map(r=>{
    const item = itemsById[r.itemId];
    const name = typeof item === "string" ? item : null;
    return { ...r, name };
  });
  return { rows:enriched, fetchedAt:latest.ts };
}

// Returns recent price history for a set of itemIds, for sparkline rendering.
// Pulls the N most recent distinct fetchedAt snapshots, then the lowestSellPrice
// / dailyAveragePrice for the requested items at each of those timestamps.
export function getMarketHistory({ itemIds=[], limit=20 } = {}){
  if (!itemIds.length) return { rows:[] };
  const slots = all(
    `SELECT DISTINCT fetchedAt FROM market_prices ORDER BY fetchedAt DESC LIMIT ?`,
    [limit]
  );
  if (!slots?.length) return { rows:[] };
  const slotTs = slots.map(s => s.fetchedAt);
  const placeholders = slotTs.map(()=>"?").join(",");
  const idPlaceholders = itemIds.map(()=>"?").join(",");
  const rows = all(
    `SELECT itemId, lowestSellPrice, dailyAveragePrice, fetchedAt
     FROM market_prices
     WHERE itemId IN (${idPlaceholders})
       AND fetchedAt IN (${placeholders})
     ORDER BY itemId, fetchedAt ASC`,
    [...itemIds, ...slotTs]
  );
  return { rows: rows || [] };
}
