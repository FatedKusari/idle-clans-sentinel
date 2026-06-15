/**
 * electron/api/client.js
 *
 * Core HTTP / API plumbing:
 *   - JWT verification (account tokens)
 *   - API base URL
 *   - Retry-aware fetch helpers (apiGetJson, apiGetJsonAllow404)
 *   - Rate-limit building blocks (sleep, sleepMs, abortError, isTransientFetchError,
 *     parseRetryAfterMs)
 *
 * NOTE: rateLimit() and getApiRateStats() depend on getSettings() from services.js
 * and are intentionally left there until getSettings is extracted in a later phase.
 * This file contains only the parts that have no dependency on the DB layer.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const API_BASE         = "https://query.idleclans.com/api";
export const API_STARTUP_INFO = `${API_BASE}/Startup/info`;

// ── JWT verification ──────────────────────────────────────────────────────────

const IDLECLANS_JWKS_URL = "https://idleclans.com/.well-known/jwks.json";
let _jwksCache = null, _jwksCachedAt = 0;
const JWKS_CACHE_MS = 60 * 60 * 1000;

export async function fetchJwks({ signal, forceRefresh = false } = {}){
  if (!forceRefresh && _jwksCache && Date.now() - _jwksCachedAt < JWKS_CACHE_MS) return _jwksCache;
  const res = await fetch(IDLECLANS_JWKS_URL, { signal, headers: { "User-Agent": "IdleClans-Sentinel/1.0" } });
  if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status}): ${IDLECLANS_JWKS_URL}`);
  const data = await res.json();
  if (!Array.isArray(data?.keys) || !data.keys.length) throw new Error(`No keys at ${IDLECLANS_JWKS_URL}`);
  _jwksCache = data; _jwksCachedAt = Date.now();
  return data;
}

export function decodeJwt(token){
  const parts = (token || "").trim().split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT — expected 3 parts");
  const b64 = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return {
    header:       JSON.parse(b64(parts[0])),
    payload:      JSON.parse(b64(parts[1])),
    signingInput: parts[0] + "." + parts[1],
    signature:    parts[2],
  };
}

export function p1363ToDer(sig){
  const half = sig.length / 2;
  const pad = buf => {
    let b = buf;
    while (b.length > 1 && b[0] === 0) b = b.slice(1);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return b;
  };
  let r = pad(sig.slice(0, half)), s = pad(sig.slice(half));
  const seq = Buffer.concat([Buffer.from([2]), Buffer.from([r.length]), r,
                              Buffer.from([2]), Buffer.from([s.length]), s]);
  return Buffer.concat([Buffer.from([0x30, seq.length]), seq]);
}

export async function verifyJwtSignature(token, { signal } = {}){
  const { createPublicKey, createVerify } = await import("crypto");
  const { header, payload, signingInput, signature } = decodeJwt(token);
  const SUPPORTED = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"];
  if (!SUPPORTED.includes(header.alg || "")) throw new Error(`Unsupported algorithm: ${header.alg}`);
  let jwks = await fetchJwks({ signal });
  let jwk  = header.kid ? jwks.keys.find(k => k.kid === header.kid) : jwks.keys[0];
  if (!jwk && header.kid){
    jwks = await fetchJwks({ signal, forceRefresh: true });
    jwk  = jwks.keys.find(k => k.kid === header.kid) || jwks.keys[0];
  }
  if (!jwk) throw new Error(`No key matched kid "${header.kid || "none"}". Available: ${jwks.keys.map(k => k.kid || "?").join(", ")}`);
  const publicKey  = createPublicKey({ key: jwk, format: "jwk" });
  const digestMap  = { RS256: "SHA256", RS384: "SHA384", RS512: "SHA512", ES256: "SHA256", ES384: "SHA384", ES512: "SHA512" };
  const verifier   = createVerify(digestMap[header.alg]);
  verifier.update(signingInput, "utf8");
  let sigBuf = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (header.alg.startsWith("ES")) sigBuf = p1363ToDer(sigBuf);
  if (!verifier.verify(publicKey, sigBuf)) throw new Error("Signature verification failed");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error(`Token expired at ${new Date(payload.exp * 1000).toLocaleString()}`);
  if (payload.nbf && payload.nbf > now) throw new Error("Token not yet valid");
  return { header, payload };
}

// ── Abort helper ──────────────────────────────────────────────────────────────

export function abortError(){
  const e  = new Error("Aborted");
  e.name   = "AbortError";
  return e;
}

// ── Sleep helpers ─────────────────────────────────────────────────────────────

export function sleep(ms, signal){
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); cleanup(); reject(abortError()); };
    function cleanup(){ if (signal) signal.removeEventListener?.("abort", onAbort); }
    if (signal) signal.addEventListener?.("abort", onAbort, { once: true });
  });
}

export async function sleepMs(ms, signal){
  if (!ms || ms <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ── Retry helpers ─────────────────────────────────────────────────────────────

export function parseRetryAfterMs(res){
  const h = res?.headers?.get?.("retry-after");
  if (!h) return 0;
  const s = String(h).trim();
  if (/^\d+$/.test(s)) return Math.max(0, Number(s) * 1000);
  const t = Date.parse(s);
  if (Number.isFinite(t)) return Math.max(0, t - Date.now());
  return 0;
}

export function isTransientFetchError(err){
  const code = err?.cause?.code || err?.code;
  if (code && [
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
  ].includes(code)) return true;
  const msg = String(err?.message || err || "");
  if (msg.includes("fetch failed")) return true;
  return false;
}

// ── Fetch with retry ──────────────────────────────────────────────────────────

/**
 * GET JSON from the API with automatic retry + backoff.
 * Requires a rateLimitFn(signal) to be passed in (lives in services.js until
 * getSettings is extracted).
 */
export async function apiGetJson(url, { signal, retries = 5, rateLimitFn } = {}){
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++){
    let extraDelayMs = 0;
    await rateLimitFn(signal);
    if (signal?.aborted) throw abortError();
    try{
      const res = await fetch(url, { headers: { "accept": "application/json" }, signal });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500){
        lastErr = new Error(`API ${res.status} ${res.statusText}`);
        extraDelayMs = Math.min(60000, parseRetryAfterMs(res) || 0);
      } else {
        const t = await res.text().catch(() => "");
        throw new Error(`API ${res.status} ${res.statusText}: ${t.slice(0, 200)}`);
      }
    }catch(e){
      if (signal?.aborted) throw abortError();
      if (!isTransientFetchError(e)) throw e;
      lastErr = e;
    }
    const base   = Math.min(8000, 500 * (2 ** attempt));
    const jitter = Math.floor(Math.random() * 250);
    await sleepMs(Math.max(base, extraDelayMs) + jitter, signal);
  }
  throw lastErr || new Error("API request failed");
}

/**
 * Same as apiGetJson but treats 404 as a null (empty) result rather than an error.
 * Used for log endpoints which return 404 when there are no entries.
 */
export async function apiGetJsonAllow404(url, { signal, retries = 5, rateLimitFn } = {}){
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++){
    let extraDelayMs = 0;
    await rateLimitFn(signal);
    if (signal?.aborted) throw abortError();
    try{
      const res = await fetch(url, { headers: { "accept": "application/json" }, signal });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500){
        lastErr = new Error(`API ${res.status} ${res.statusText}`);
        extraDelayMs = Math.min(60000, parseRetryAfterMs(res) || 0);
      } else {
        const t = await res.text().catch(() => "");
        throw new Error(`API ${res.status} ${res.statusText}: ${t.slice(0, 200)}`);
      }
    }catch(e){
      if (signal?.aborted) throw abortError();
      if (!isTransientFetchError(e)) throw e;
      lastErr = e;
    }
    const base   = Math.min(8000, 500 * (2 ** attempt));
    const jitter = Math.floor(Math.random() * 250);
    await sleepMs(Math.max(base, extraDelayMs) + jitter, signal);
  }
  throw lastErr || new Error("API request failed");
}
