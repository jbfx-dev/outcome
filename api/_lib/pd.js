// Shared upstream plumbing for the PD campaign dashboard routes.
// Not a route: Vercel skips files under api/ whose path segment starts with "_".
//
// Upstreams (all read-only, none of them usable directly from the browser):
//   stats.outcome.xyz     - builder volume, daily and hourly. Sends no CORS
//                           headers, so every call is made from here.
//   docs.google.com       - the PD and World Cup Campaign Tracker sheets, as
//                           CSV exports. Link-readable, cached by Google.
//   publish.twitter.com   - oEmbed HTML for post embeds. CORS-blocked.
//
// Nothing here writes. The sheet is the system of record and the dashboard is
// strictly a reader.

const D = require('../../dashboards/pd/pd.js');

const STATS = process.env.OUTCOME_STATS_BASE || 'https://stats.outcome.xyz';
// Two spreadsheets: the PD tracker, and the World Cup tracker that supplies
// the campaign-pacing baseline. Both are read-only and link-readable.
const SHEET_IDS = {
  pd: process.env.PD_SHEET_ID || D.PD.sheetId,
  wc: process.env.WC_SHEET_ID || D.PD.wcSheetId,
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status || 502;
  }
}

// ---------------------------------------------------------------- cache ----
// Lambda-local memory, same approach as api/_lib/outcome.js: it collapses the
// fan-out of one page load within a warm instance, and Vercel's CDN handles
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
  if (cache.size > 200) {
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
  }
  return value;
}

// -------------------------------------------------------------- fetching ----

async function fetchText(url, { timeout = 15000, accept = '*/*' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': UA },
      signal: ctl.signal,
    });
  } catch (err) {
    throw new UpstreamError('upstream_unreachable', 502);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new UpstreamError(`upstream_${r.status}`, r.status);
  return r.text();
}

async function fetchJSON(url, opts) {
  const text = await fetchText(url, Object.assign({ accept: 'application/json' }, opts));
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UpstreamError('upstream_unparseable', 502);
  }
}

// ----------------------------------------------------------------- sheet ----

// Only these tabs are ever fetched. The spreadsheet also holds Budget Tracker
// and Cost Projections; this route must never become a way to read them, so
// the tab name is looked up in this map rather than passed through.
const TABS = {
  daily: D.TABS.daily,
  hourly: D.TABS.hourly,
  content: D.TABS.content,
  channels: D.TABS.channels,
  comparison: D.TABS.comparison,
  wcdaily: D.TABS.wcdaily,
};

// The plain CSV export, addressed by gid. Not gviz: gviz infers a header row,
// which merges a banner row into the header and blanks cells whose type it
// disagrees with - Channel Summary loses its Posts column that way. This
// endpoint returns the grid exactly as the sheet shows it.
function sheetCsvUrl(key) {
  const src = D.TAB_SOURCES[key];
  return (
    'https://docs.google.com/spreadsheets/d/' + SHEET_IDS[src.sheet] +
    '/export?format=csv&gid=' + encodeURIComponent(src.gid)
  );
}

// Returns the raw cell matrix for a tab. Google serves an HTML sign-in page
// with a 200 when the sheet is not link-readable, so the shape is checked
// rather than trusted.
function sheetRows(key) {
  const src = D.TAB_SOURCES[key];
  if (!TABS[key] || !src || !SHEET_IDS[src.sheet]) throw new UpstreamError('unknown_tab', 400);
  return cached('sheet:' + key, 60000, async () => {
    const text = await fetchText(sheetCsvUrl(key), { accept: 'text/csv' });
    if (/^\s*<!DOCTYPE html/i.test(text) || /<html/i.test(text.slice(0, 200))) {
      // Sharing was turned off, or the tab was renamed.
      throw new UpstreamError('sheet_not_readable', 502);
    }
    return D.parseCSV(text);
  });
}

// --------------------------------------------------------------- helpers --

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
  D,
  STATS,
  SHEET_IDS,
  TABS,
  UpstreamError,
  cached,
  fetchText,
  fetchJSON,
  sheetRows,
  send,
  fail,
};
