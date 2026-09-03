// Shared upstream clients + derivation logic for the Outcome leaderboard / PnL card app.
// Not a route: Vercel skips files under api/ whose path segment starts with "_".
//
// Data sources (both public, no auth):
//   o1.outcome.xyz      - identity, leaderboard, market metadata
//   api.hyperliquid.xyz - trade fills (Outcome settles its markets on Hyperliquid)
//
// Neither sends permissive CORS headers, and o1 returns 403 without a browser
// User-Agent, so every call is made from here rather than from the page.

const O1 = process.env.OUTCOME_API_BASE || 'https://o1.outcome.xyz';
const HL = process.env.HYPERLIQUID_API_BASE || 'https://api.hyperliquid.xyz';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------------------------------------------------------------- cache ----
// Lambda-local memory. Survives within a warm instance only, which is all we
// need: it collapses the fan-out of one page load, and Vercel's CDN handles
// caching across instances via Cache-Control.

const cache = new Map();

function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = Promise.resolve()
    .then(fn)
    .catch((err) => {
      cache.delete(key); // never cache a rejection
      throw err;
    });
  cache.set(key, { value, expires: Date.now() + ttlMs });
  if (cache.size > 500) {
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
  }
  return value;
}

// --------------------------------------------------------------- upstream --

async function postJSON(url, body, { timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (err) {
    // DNS failure, timeout, TLS error, connection reset. Surfaced as an
    // upstream_* code so the browser's fallback treats it the same as a WAF
    // block - the page cannot tell the difference and should not care.
    throw new UpstreamError('upstream_unreachable', 502);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new UpstreamError(`upstream_${r.status}`, r.status);
  try {
    return await r.json();
  } catch (err) {
    // A WAF block page is HTML, not JSON.
    throw new UpstreamError('upstream_unparseable', 502);
  }
}

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status || 502;
  }
}

// o1 wraps everything as {success, data} / {success:false, error:{code,message}}.
async function o1(path, body) {
  const j = await postJSON(`${O1}${path}`, body);
  if (!j || j.success !== true) {
    const code = (j && j.error && j.error.code) || 'upstream_error';
    throw new UpstreamError(code, code === 'NOT_FOUND' ? 404 : 502);
  }
  return j.data;
}

const DURATIONS = ['24h', '168h', '720h', 'all'];

function leaderboard({ duration = '24h', limit = 25, offset = 0 } = {}) {
  if (!DURATIONS.includes(duration)) throw new UpstreamError('bad_duration', 400);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  return cached(`lb:${duration}:${lim}:${off}`, 30_000, () =>
    o1('/api/v1/leaderboard', {
      duration,
      filter_by: 'pnl',
      order_by: 'desc',
      offset: off,
      limit: lim,
    })
  );
}

function profile(username) {
  return cached(`pf:${username.toLowerCase()}`, 300_000, () =>
    o1('/api/v1/profile/lookup', { username })
  );
}

function portfolio(address) {
  return cached(`pt:${address.toLowerCase()}`, 60_000, () =>
    o1('/api/v1/portfolio/lookup', { address })
  );
}

// Resolved market metadata never changes, so it is cached for the life of the
// instance. Unknown ids are cached as null so a purged market is not re-fetched
// on every request.
const marketCache = new Map();

async function markets(ids) {
  const want = [...new Set(ids.map(Number).filter(Number.isInteger))];
  const missing = want.filter((id) => !marketCache.has(id));

  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    let found = {};
    try {
      const data = await o1('/api/v1/markets/lookup', { outcome_ids: batch });
      found = (data && data.markets) || {};
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      // A bad id in the batch fails the whole batch; fall through and mark the
      // batch unknown rather than failing the page.
    }
    for (const id of batch) marketCache.set(id, found[String(id)] || null);
  }
  const out = {};
  for (const id of want) out[id] = marketCache.get(id) || null;
  return out;
}

// Hyperliquid returns the 2,000 most recent fills from `userFills`. For anything
// older we page backwards with `userFillsByTime`, which is capped at 2,000 per
// call, walking the window in reverse until it is covered or we hit the budget.
async function userFills(address, sinceMs) {
  return cached(`fl:${address.toLowerCase()}:${sinceMs || 0}`, 45_000, async () => {
    const recent = await postJSON(`${HL}/info`, { type: 'userFills', user: address }, { timeout: 20000 });
    let fills = Array.isArray(recent) ? recent : [];
    if (!sinceMs || !fills.length) return fills;

    const seen = new Set(fills.map(fillKey));
    let oldest = Math.min(...fills.map((f) => f.time));

    for (let page = 0; page < 8 && oldest > sinceMs; page++) {
      const older = await postJSON(
        `${HL}/info`,
        { type: 'userFillsByTime', user: address, startTime: sinceMs, endTime: oldest - 1 },
        { timeout: 20000 }
      );
      if (!Array.isArray(older) || !older.length) break;
      let added = 0;
      for (const f of older) {
        const k = fillKey(f);
        if (seen.has(k)) continue;
        seen.add(k);
        fills.push(f);
        added++;
      }
      const nextOldest = Math.min(...older.map((f) => f.time));
      if (!added || nextOldest >= oldest) break;
      oldest = nextOldest;
    }
    return fills;
  });
}

const fillKey = (f) => `${f.tid ?? ''}:${f.oid}:${f.time}:${f.coin}:${f.sz}:${f.px}`;

// ------------------------------------------------------------ derivation --
// Shared with the browser: leaderboard/derive.js is loaded by the page too, so
// the proxied and direct-to-upstream paths derive identical numbers. Required
// by relative path from api/ - Vercel's bundler traces it into the function.

const D = require('../../leaderboard/derive.js');

const {
  inWindow,
  rankTrades,
  parseCoin,
  marketTitle,
  sideLabel,
  themeFor,
  buildPositions,
  decorate,
  cardFields,
  windowStart,
  WINDOWS,
  avatarUrl,
  parseProfileUrl,
  usd,
  money,
} = D;

// ---------------------------------------------------------------- helpers --


function send(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(body));
}

function fail(res, err) {
  const status = err && err.status ? err.status : 500;
  const message = err instanceof UpstreamError ? err.message : 'internal_error';
  if (!(err instanceof UpstreamError)) console.error(err);
  send(res, status, { ok: false, error: message });
}

module.exports = {
  inWindow,
  rankTrades,
  O1,
  HL,
  UpstreamError,
  leaderboard,
  profile,
  portfolio,
  markets,
  userFills,
  parseCoin,
  marketTitle,
  sideLabel,
  themeFor,
  buildPositions,
  decorate,
  cardFields,
  windowStart,
  WINDOWS,
  avatarUrl,
  parseProfileUrl,
  usd,
  send,
  fail,
};
