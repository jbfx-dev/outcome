// GET /api/pd/posthog?days=2
//
// Cumulative-per-hour campaign metrics straight from PostHog, in the same shape
// as a Hourly Snapshots row. This is what keeps the dashboard current when the
// Cowork task has not run - the sheet is only written while Jack's laptop is
// open, but the numbers should not freeze because of it.
//
// The definitions below are not invented: each was verified to reproduce the
// sheet exactly across several windows (2 Sep h4/h6/h14, 3 Sep h6, 1 Sep full
// day) before this route existed. Changing one silently desynchronises the
// dashboard from the spreadsheet, which is the one thing this must never do.
//
//   Clicks         count($pageview) where utm_source is set  <- tagged
//                  pageviews, not distinct humans
//   Unique Visitors uniq(person_id) on $pageview
//   Signups        count(sign_up)                            <- events, NOT
//                  unique people; uniq would read ~7% low
//   Depositors     uniq(person_id) on deposit_completed
//   Active Traders uniq(person_id) on trade_placed
//   Trades Placed  count(trade_placed)
//
// uniq is not additive, so the cumulative curve cannot be built by summing
// hourly buckets. uniqState/uniqMerge over an expanding window frame gives the
// exact running distinct count in a single query.
//
// HOUR SEMANTICS: the sheet's "Hour (UTC) = H" means state AT H:00Z, with
// buckets 0..H-1 complete. ClickHouse's toHour() bucket H covers H:00-H:59, so
// bucket H maps to sheet hour H+1. Getting this backwards shifts every metric
// by an hour and the error looks entirely plausible.

const L = require('../_lib/pd.js');

const HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/+$/, '');
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '407955';
const API_KEY = process.env.POSTHOG_API_KEY || '';

// Project timezone is UTC, which is why these day boundaries line up with the
// sheet's without conversion.
function hogql(fromIso, toIso) {
  return `
SELECT
  toString(day) AS day,
  hour + 1 AS sheet_hour,
  uniqMerge(uv)  OVER w AS uvs,
  sum(cl)        OVER w AS clicks,
  sum(su)        OVER w AS signups,
  uniqMerge(dep) OVER w AS depositors,
  uniqMerge(tr)  OVER w AS traders,
  sum(tp)        OVER w AS trades
FROM (
  SELECT
    toDate(timestamp) AS day,
    toHour(timestamp) AS hour,
    uniqState(if(event = '$pageview', person_id, NULL)) AS uv,
    countIf(event = '$pageview' AND isNotNull(properties.utm_source) AND properties.utm_source != '') AS cl,
    countIf(event = 'sign_up') AS su,
    uniqState(if(event = 'deposit_completed', person_id, NULL)) AS dep,
    uniqState(if(event = 'trade_placed', person_id, NULL)) AS tr,
    countIf(event = 'trade_placed') AS tp
  FROM events
  WHERE timestamp >= toDateTime('${fromIso}') AND timestamp < toDateTime('${toIso}')
  GROUP BY day, hour
)
WINDOW w AS (PARTITION BY day ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
ORDER BY day, sheet_hour`;
}

function utcStamp(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function queryPostHog(days) {
  const now = new Date();
  const to = new Date(now.getTime() + 3600000); // through the current partial hour
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - (days - 1));

  const url = `${HOST}/api/projects/${encodeURIComponent(PROJECT_ID)}/query/`;
  const body = JSON.stringify({
    query: { kind: 'HogQLQuery', query: hogql(utcStamp(from), utcStamp(to)) },
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      signal: ctl.signal,
    });
  } catch (err) {
    throw new L.UpstreamError('posthog_unreachable', 502);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new L.UpstreamError(`posthog_${r.status}`, r.status === 401 ? 500 : 502);

  let j;
  try {
    j = await r.json();
  } catch (err) {
    throw new L.UpstreamError('posthog_unparseable', 502);
  }

  // [day, sheet_hour, uvs, clicks, signups, depositors, traders, trades]
  //
  // The sheet uses "Hour H" two ways, and both must be reproduced or the merge
  // files rows in the wrong slot:
  //   a completed bucket H  -> Hour H+1, timestamp H+1:00:00Z ("state at H+1:00")
  //   the in-flight bucket  -> Hour H,   timestamp = now       ("state at H:mm")
  // That second form is exactly what a live Cowork run writes, e.g. 14:16:08Z
  // carrying Hour 14.
  const nowIso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const today = nowIso.slice(0, 10);
  const openBucket = now.getUTCHours();

  return (j.results || []).map((row) => {
    const bucket = Number(row[1]) - 1;
    const isOpen = row[0] === today && bucket === openBucket;
    return {
    timestamp: isOpen ? nowIso : `${row[0]}T${String(row[1] % 24).padStart(2, '0')}:00:00Z`,
    date: row[0],
    hour: isOpen ? bucket : Number(row[1]),
    clicks: Number(row[3]) || 0,
    uvs: Number(row[2]) || 0,
    signups: Number(row[4]) || 0,
    depositors: Number(row[5]) || 0,
    traders: Number(row[6]) || 0,
    trades: Number(row[7]) || 0,
    runType: 'posthog',
    _source: 'posthog',
    _empty: { impressions: 1, fills: 1, tradersApi: 1 }, // not PostHog metrics
    };
  });
}

module.exports = async (req, res) => {
  try {
    // Without a key the route reports itself unconfigured rather than failing.
    // The dashboard then runs sheet-only, exactly as it did before this route
    // existed, instead of showing an error panel.
    if (!API_KEY) {
      return L.send(
        res, 200,
        { ok: true, configured: false, rows: [], note: 'POSTHOG_API_KEY not set' },
        's-maxage=300'
      );
    }

    let days = parseInt((req.query || {}).days, 10);
    if (!Number.isFinite(days) || days < 1) days = 2;
    days = Math.min(days, 7);

    const rows = await L.cached(`ph:${days}`, 60000, () => queryPostHog(days));

    L.send(
      res, 200,
      { ok: true, configured: true, days, count: rows.length, rows, fetchedAt: new Date().toISOString() },
      's-maxage=60, stale-while-revalidate=120'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
