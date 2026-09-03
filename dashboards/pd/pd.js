// Pure derivation logic for the PD (Permissionless Deployment / HIP-4) launch
// campaign dashboard. No I/O.
//
// Loaded BOTH ways, like leaderboard/derive.js, and must stay
// environment-agnostic:
//   - Node, by api/pd/*.js, to shape proxied upstream responses
//   - the browser, by dashboards/pd/index.html, to derive everything it renders
//
// One copy is the point: the hero cards, the charts and the tables must all
// agree, and the sheet's column headers are the contract. Do not reference
// `process`, `fetch`, `window` or `document` here.

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PDDerive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------- config ----

  const PD = {
    campaignStart: '2026-08-28',
    outcomeBuilder: '0xab5dbc057628bc18523c4cdfc0e1e2ebdbecb704',
    hlFrontendBuilder: 'null',
    sheetId: '1WnBeQxu_bVQA5tdOvRQBK6-pNv0mIJvwbOaDhLJ1Qqw',
    wcSheetId: '1D8UPwj3pF6m4hNSEisXp9LvEu7u4lf5HpWB3UPnGd-U',
    rewardsPool: 1000000,
    worldCupFirst4Days: {
      impressions: 1346367, clicks: 10784, uvs: 11900,
      signups: 1257, depositors: 98, traders: 626, volume: 848400,
    },
    worldCupWeek1: {
      impressions: 1538005, clicks: 11105, uvs: 18079,
      signups: 1660, depositors: 169, traders: 1137, volume: 1394003,
    },
    // Milestones drawn on the market-share chart. Empty by default; add
    // { date, label } entries to annotate a day.
    annotations: [],
  };

  // The tabs the dashboard reads, and nothing else. Budget Tracker and Cost
  // Projections are deliberately absent.
  //
  // Each is fetched by gid through the plain CSV export endpoint rather than by
  // name through gviz: gviz infers a header, which silently merges a banner row
  // into the header line and blanks cells it decides do not fit the column type.
  // Channel Summary loses its Posts column that way. The export endpoint
  // returns the grid exactly as it appears in the sheet.
  const TABS = {
    daily: 'Daily Totals',
    hourly: 'Hourly Snapshots',
    content: 'Content Log',
    channels: 'Channel Summary',
    comparison: 'WC vs PD Comparison',
    wcdaily: 'Daily Totals (World Cup)',
  };

  // Which spreadsheet each tab lives in, and its gid. `wcdaily` is the World
  // Cup tracker - a separate document with the same Daily Totals columns, which
  // is why COLS.daily maps it too.
  const TAB_SOURCES = {
    daily: { sheet: 'pd', gid: '291194403' },
    hourly: { sheet: 'pd', gid: '696635920' },
    content: { sheet: 'pd', gid: '2139330859' },
    channels: { sheet: 'pd', gid: '1355573911' },
    comparison: { sheet: 'pd', gid: '520954207' },
    wcdaily: { sheet: 'wc', gid: '291194403' },
  };

  // Column name -> field, kept in ONE place. The sheet headers are the
  // contract; if a header changes, it changes here and in the PRD.
  const COLS = {
    daily: {
      Date: 'date',
      Impressions: 'impressions',
      Clicks: 'clicks',
      'Total Unique Visitors': 'uvs',
      Signups: 'signups',
      Depositors: 'depositors',
      'Active Traders': 'traders',
      'Volume (Outcome)': 'outcomeVolume',
      'Volume (HL Frontend)': 'hlVolume',
      'Market Share %': 'share',
      'Total HIP-4 Volume': 'totalVolume',
      'Other Builders': 'otherVolume',
    },
    hourly: {
      'Timestamp (UTC)': 'timestamp',
      Date: 'date',
      'Hour (UTC)': 'hour',
      'Outcome Volume': 'outcomeVolume',
      'HL Frontend Volume': 'hlVolume',
      'Total HIP-4 Volume': 'totalVolume',
      'Other Builders': 'otherVolume',
      'Market Share %': 'share',
      Clicks: 'clicks',
      'Unique Visitors': 'uvs',
      Signups: 'signups',
      Depositors: 'depositors',
      'Active Traders': 'traders',
      'Trades Placed': 'trades',
      Impressions: 'impressions',
      'Outcome Fills': 'fills',
      'Outcome Traders (API)': 'tradersApi',
      'Run Type': 'runType',
    },
    content: {
      Date: 'date',
      'Time Posted (EST)': 'time',
      Channel: 'channel',
      'Post Type': 'postType',
      Copy: 'copy',
      Shortlink: 'shortlink',
      'Published Post Link': 'link',
      Views: 'views',
      Likes: 'likes',
      'Retweets/Shares': 'retweets',
      Replies: 'replies',
      Engagements: 'engagements',
      Clicks: 'clicks',
      Visitors: 'visitors',
      Notes: 'notes',
    },
    channels: {
      Channel: 'channel',
      Posts: 'posts',
      Views: 'views',
      Clicks: 'clicks',
      Likes: 'likes',
      Retweets: 'retweets',
      Replies: 'replies',
      Engagements: 'engagements',
      'Total UVs': 'uvs',
      Signups: 'signups',
      Depositors: 'depositors',
      'Deposit Amt (USD)': 'depositAmt',
      'Trades Placed': 'trades',
      'Active Traders': 'traders',
    },
  };

  // The World Cup tracker carries the same Daily Totals headers, so it maps
  // through the same column contract.
  COLS.wcdaily = COLS.daily;

  // Fields that are text, not numbers, and must survive parsing untouched.
  const TEXT_FIELDS = {
    date: 1, timestamp: 1, time: 1, channel: 1, postType: 1, copy: 1,
    shortlink: 1, link: 1, notes: 1, runType: 1,
  };
  const PCT_FIELDS = { share: 1 };

  // ------------------------------------------------------------ parsing ----

  // Strips $, commas, percent signs and spaces. Blank and non-numeric become 0,
  // matching how the sheet renders an empty metric cell.
  function parseMoney(s) {
    if (s === null || s === undefined) return 0;
    if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
    const n = Number(String(s).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  // Market share arrives two ways: a fraction (0.7208) when the sheet is read
  // through the Sheets API, and a formatted string ("72.08%") through the
  // published CSV. Both must land on the same fraction.
  function parsePct(s) {
    if (s === null || s === undefined || s === '') return 0;
    const raw = String(s);
    const n = parseMoney(raw);
    if (raw.indexOf('%') !== -1) return n / 100;
    return n > 1 ? n / 100 : n;
  }

  // Accepts the two formats the sheet actually uses: dd/mm/yyyy in Daily
  // Totals, yyyy-mm-dd in Content Log and Hourly Snapshots. Returns UTC
  // midnight so day arithmetic never drifts across a timezone.
  function parseSheetDate(s) {
    if (s instanceof Date) return s;
    const str = String(s || '').trim();
    if (!str) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return null;
  }

  // yyyy-mm-dd, the key every series is joined on.
  function isoDate(d) {
    if (!d) return null;
    return d.toISOString().slice(0, 10);
  }

  function dayKey(s) {
    return isoDate(parseSheetDate(s));
  }

  function addDays(iso, n) {
    const d = parseSheetDate(iso);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + n);
    return isoDate(d);
  }

  function daysBetween(fromIso, toIso) {
    const a = parseSheetDate(fromIso);
    const b = parseSheetDate(toIso);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  // RFC4180-ish. Handles quoted fields containing commas, escaped quotes and
  // newlines - Content Log copy has all three.
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') {
        quoted = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Finds the header row by scoring candidates against the COLS map rather than
  // trusting a fixed index: Daily Totals puts its header on row 1, Channel
  // Summary carries a banner above it on row 2, and a banner added later must
  // not silently empty the table.
  function detectHeaderIndex(rows, colMap, searchDepth) {
    const depth = Math.min(rows.length, searchDepth || 10);
    let bestIdx = 0;
    let bestScore = 0;
    for (let r = 0; r < depth; r++) {
      const cells = rows[r] || [];
      let score = 0;
      for (let c = 0; c < cells.length; c++) {
        if (colMap[String(cells[c] || '').trim()]) score++;
      }
      if (score > bestScore) { bestScore = score; bestIdx = r; }
    }
    // A real header row scores 12-15 against these maps, far above any data
    // row, so the highest score wins; -1 only when nothing matched at all.
    return bestScore >= 1 ? bestIdx : -1;
  }

  // Maps a matrix of cells onto objects using a header row and a COLS map.
  // Unknown columns are ignored, so a new column in the sheet cannot break the
  // dashboard. Numeric fields are parsed; text fields are trimmed.
  function rowsToObjects(rows, colMap, headerIndex) {
    if (!rows || !rows.length) return [];
    const hi = (headerIndex === undefined || headerIndex === null)
      ? detectHeaderIndex(rows, colMap)
      : headerIndex;
    if (hi < 0) return [];
    const header = rows[hi] || [];
    const idx = [];
    for (let c = 0; c < header.length; c++) {
      const name = String(header[c] || '').trim();
      const field = colMap[name];
      if (field) idx.push([c, field]);
    }
    const out = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const cells = rows[r] || [];
      const o = {};
      const empty = {};
      let any = false;
      for (let k = 0; k < idx.length; k++) {
        const c = idx[k][0];
        const field = idx[k][1];
        const raw = cells[c];
        const str = raw === undefined || raw === null ? '' : String(raw).trim();
        if (TEXT_FIELDS[field]) o[field] = str;
        else if (PCT_FIELDS[field]) o[field] = parsePct(str);
        else o[field] = parseMoney(str);
        if (str !== '') any = true;
        else empty[field] = 1;
      }
      // Blank is not zero: Impressions and Outcome Traders (API) are empty on
      // backfill rows, and a curve must skip those hours rather than plot 0.
      o._empty = empty;
      o._blank = !any;
      out.push(o);
    }
    return out;
  }

  // A day row counts as populated only if something beyond the pre-filled Date
  // column has a value - Daily Totals carries blank rows for future dates.
  function populatedDays(dailyRows) {
    return (dailyRows || []).filter(function (r) {
      if (!r.date) return false;
      return (r.impressions || r.clicks || r.uvs || r.signups ||
        r.depositors || r.traders || r.outcomeVolume || r.totalVolume) > 0;
    });
  }

  // ------------------------------------------------------------- volume ----

  // Collapses the packed volume-daily response into one row per date.
  //
  // Market share is Outcome over TOTAL HIP-4 volume - the number Outcome
  // quotes publicly. It is never Outcome/(Outcome+HL): other builders are real
  // volume and leaving them out would overstate the share.
  function volumeByDay(api) {
    if (!api || !api.builders || !api.dates || !api.series) return [];
    const builders = api.builders;
    const dates = api.dates;
    const volume = api.series.volume || [];

    const outcomeIdx = builders.indexOf(PD.outcomeBuilder);
    const hlIdx = builders.indexOf(PD.hlFrontendBuilder);

    const out = [];
    for (let j = 0; j < dates.length; j++) {
      let total = 0;
      for (let i = 0; i < builders.length; i++) {
        const cell = volume[i] && volume[i][j];
        total += parseMoney(cell);
      }
      const outcome = outcomeIdx === -1 ? 0
        : parseMoney(volume[outcomeIdx] && volume[outcomeIdx][j]);
      const hlFrontend = hlIdx === -1 ? 0
        : parseMoney(volume[hlIdx] && volume[hlIdx][j]);
      out.push({
        date: dates[j],
        outcome: outcome,
        hlFrontend: hlFrontend,
        total: total,
        other: Math.max(0, total - outcome - hlFrontend),
        share: total > 0 ? outcome / total : 0,
      });
    }
    return out;
  }

  function todaySoFar(api) {
    const days = volumeByDay(api);
    return days.length ? days[days.length - 1] : null;
  }

  // Cumulative Outcome volume per UTC hour for one day, from the hourly
  // endpoint's sliding window.
  function hourlyCumulative(hourlyApi, isoDay) {
    if (!hourlyApi || !hourlyApi.hours) return [];
    const vols = (hourlyApi.series && hourlyApi.series.volume) || [];
    const out = [];
    let running = 0;
    for (let i = 0; i < hourlyApi.hours.length; i++) {
      const stamp = String(hourlyApi.hours[i] || '');
      if (stamp.slice(0, 10) !== isoDay) continue;
      running += parseMoney(vols[i]);
      out.push({ hour: +stamp.slice(11, 13), value: running });
    }
    return out;
  }

  // ------------------------------------------------------------ snapshots --

  // Every Hourly Snapshots row is cumulative for its UTC Date as of its
  // Timestamp. Hour = 24 is the end-of-day final for the Date it summarises.
  function snapshotsForDay(snapshots, isoDay) {
    return (snapshots || [])
      .filter(function (r) { return !r._blank && dayKey(r.date) === isoDay; })
      .sort(function (a, b) { return a.hour - b.hour; });
  }

  function latestSnapshot(snapshots) {
    let best = null;
    for (let i = 0; i < (snapshots || []).length; i++) {
      const r = snapshots[i];
      if (r._blank || !r.timestamp) continue;
      if (!best || String(r.timestamp) > String(best.timestamp)) best = r;
    }
    return best;
  }

  // Matches on Date + Hour, never on timestamp equality: a live row carries an
  // exact time (14:16:08Z) while a backfilled one lands on the hour.
  function sameHourYesterday(snapshots, metric, isoDay, hour) {
    const prev = addDays(isoDay, -1);
    if (!prev) return null;
    const rows = snapshotsForDay(snapshots, prev);
    let match = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].hour === hour) match = rows[i];
    }
    if (!match) return null;
    const v = match[metric];
    return v === undefined ? null : v;
  }

  // Yesterday's end-of-day value: the Hour = 24 final if present, else the
  // last row recorded for that day.
  function yesterdayFinal(snapshots, metric, isoDay) {
    const prev = addDays(isoDay, -1);
    const rows = snapshotsForDay(snapshots, prev);
    if (!rows.length) return null;
    const final = rows[rows.length - 1];
    const v = final[metric];
    return v === undefined ? null : v;
  }

  // Cumulative curve for one day, hour 0..23. Gaps left by a closed Cowork app
  // are linearly interpolated and flagged so the chart can mark them.
  function pacingSeries(snapshots, isoDay, metric) {
    const rows = snapshotsForDay(snapshots, isoDay);
    if (!rows.length) return [];

    const known = {};
    for (let i = 0; i < rows.length; i++) {
      const h = Math.min(23, rows[i].hour);
      const v = rows[i][metric];
      if (v === undefined || v === null) continue;
      if (rows[i]._empty && rows[i]._empty[metric]) continue; // blank, not zero
      // A later row for the same hour supersedes an earlier one.
      known[h] = v;
    }
    const hours = Object.keys(known).map(Number).sort(function (a, b) { return a - b; });
    if (!hours.length) return [];

    const first = hours[0];
    const last = hours[hours.length - 1];
    const out = [];
    for (let h = first; h <= last; h++) {
      if (known[h] !== undefined) {
        out.push({ hour: h, value: known[h], interpolated: false });
        continue;
      }
      let lo = h;
      let hi = h;
      while (lo >= first && known[lo] === undefined) lo--;
      while (hi <= last && known[hi] === undefined) hi++;
      const span = hi - lo;
      const t = span === 0 ? 0 : (h - lo) / span;
      out.push({
        hour: h,
        value: known[lo] + (known[hi] - known[lo]) * t,
        interpolated: true,
      });
    }
    return out;
  }

  // ---------------------------------------------------------- merging ------

  // Combines written sheet rows with live PostHog rows into one snapshot series.
  //
  // The sheet always wins for an hour it has recorded. That is deliberate: a
  // written row is frozen, whereas a PostHog answer for a past hour can drift
  // slightly if a person is identified later and uniq() re-resolves. Sheet-first
  // means history never moves under the reader.
  //
  // PostHog covers two cases: hours the Cowork task never wrote (laptop shut),
  // and the current partial hour, which the sheet cannot have yet. The second is
  // why the dashboard runs ahead of the spreadsheet - by design, and the two
  // reconcile as soon as the hourly task writes that hour.
  //
  // Both sides are cumulative-for-the-UTC-day at hour H, so they are directly
  // interchangeable per (date, hour). The PostHog definitions were verified to
  // reproduce the sheet's numbers exactly before this was wired up.
  function mergeSnapshots(sheetRows, posthogRows) {
    const byKey = {};
    const order = [];

    // Later timestamp wins; a tie goes to the sheet.
    //
    // Keying on (date, hour) alone is not enough, because the sheet files two
    // different instants under the same Hour: a boundary row at H:00:00Z and a
    // live run at H:mm:ssZ. If the sheet simply won its hour, a stale 08:00 row
    // would beat a fresher 08:08 PostHog reading and the dashboard would stop
    // leading the sheet - the whole point of this merge.
    //
    // The tie-break still protects written history: for a past hour both sides
    // carry the identical H:00:00Z timestamp, so the sheet's frozen row wins and
    // nothing moves under the reader.
    function put(row, source) {
      const day = dayKey(row.date);
      if (!day || row.hour === undefined || row.hour === null) return;
      const key = day + '#' + row.hour;
      const existing = byKey[key];

      if (existing) {
        const a = String(row.timestamp || '');
        const b = String(existing.timestamp || '');
        if (a < b) return;
        if (a === b && source === 'posthog') return; // tie: sheet keeps it
      } else {
        order.push(key);
      }

      const merged = Object.assign({}, row);
      merged._source = source;
      byKey[key] = merged;
    }

    (sheetRows || []).forEach(function (r) { if (!r._blank) put(r, 'sheet'); });
    (posthogRows || []).forEach(function (r) { put(r, 'posthog'); });

    return order
      .map(function (k) { return byKey[k]; })
      .sort(function (a, b) {
        const da = dayKey(a.date);
        const db = dayKey(b.date);
        if (da !== db) return da < db ? -1 : 1;
        return a.hour - b.hour;
      });
  }

  // -------------------------------------------------------------- funnel ----

  const FUNNEL_STAGES = [
    { key: 'impressions', label: 'Impressions' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'uvs', label: 'Unique Visitors' },
    { key: 'signups', label: 'Signups' },
    { key: 'depositors', label: 'Depositors' },
    { key: 'traders', label: 'Active Traders' },
  ];

  // Sums Daily Totals over the given rows. convFromPrev is the step conversion,
  // null on the first stage.
  function funnel(dailyRows) {
    const rows = populatedDays(dailyRows);
    const out = [];
    for (let i = 0; i < FUNNEL_STAGES.length; i++) {
      const key = FUNNEL_STAGES[i].key;
      let sum = 0;
      for (let r = 0; r < rows.length; r++) sum += rows[r][key] || 0;
      const prev = i === 0 ? null : out[i - 1].value;
      out.push({
        stage: FUNNEL_STAGES[i].label,
        key: key,
        value: sum,
        convFromPrev: prev === null ? null : (prev > 0 ? sum / prev : 0),
      });
    }
    return out;
  }

  // ----------------------------------------------------- world cup daily ----

  // Metrics that exist on both sides of the comparison. The World Cup tracker
  // (Daily Totals, 10 Jun - 20 Jul) has the same headers as the PD one, so a
  // single key works for both.
  const CAMPAIGN_METRICS = [
    { key: 'volume', label: 'Volume', money: true },
    { key: 'impressions', label: 'Impressions' },
    { key: 'uvs', label: 'UVs' },
    { key: 'signups', label: 'Signups' },
    { key: 'depositors', label: 'Depositors' },
    { key: 'traders', label: 'Active Traders' },
  ];

  // Cumulative totals indexed by campaign day, so PD day 1 (28 Aug) lines up
  // against World Cup day 1 (10 Jun) rather than against a calendar date.
  function campaignPacing(pdDaily, wcDaily, metric) {
    const key = metric === 'volume' ? 'outcomeVolume' : metric;

    function cumulative(rows) {
      const out = [];
      let run = 0;
      populatedDays(rows).forEach(function (r, i) {
        run += r[key] || 0;
        out.push({ day: i + 1, value: run, label: dayKey(r.date) });
      });
      return out;
    }

    return { pd: cumulative(pdDaily), wc: cumulative(wcDaily) };
  }

  // ------------------------------------------------------------ channels ----

  // Channel Summary does not end at the channel table: below it sit a POST TYPE
  // PERFORMANCE block and a CHANNEL x POST TYPE block, which reuse the same
  // column letters and would otherwise be read as more channels. The channel
  // table is everything up to and including TOTAL.
  function channelBlock(objects) {
    const out = [];
    for (let i = 0; i < (objects || []).length; i++) {
      out.push(objects[i]);
      if (String(objects[i].channel || '').trim().toUpperCase() === 'TOTAL') break;
    }
    return out;
  }

  // Hides channels that never ran: every metric zero and no posts.
  function activeChannels(objects) {
    return channelBlock(objects).filter(function (r) {
      const name = String(r.channel || '').trim().toUpperCase();
      if (name === 'TOTAL' || !name) return false;
      return (r.posts || r.views || r.clicks || r.engagements ||
        r.uvs || r.signups || r.depositors || r.trades || r.traders) > 0;
    });
  }

  // ---------------------------------------------------------- comparison ----

  // WC vs PD Comparison is two labelled blocks rather than one table. The
  // blocks are located by their heading text, not by row number, so inserting
  // a row above them cannot shift the scorecard onto the wrong metrics.
  function comparisonBlocks(rows) {
    const blocks = [];
    for (let r = 0; r < (rows || []).length; r++) {
      const head = rows[r] || [];
      const title = String(head[0] || '').trim();
      if (!/^(FIRST \d+ DAYS|WEEK \d+)$/i.test(title)) continue;

      const out = [];
      for (let k = r + 1; k < rows.length; k++) {
        const cells = rows[k] || [];
        const metric = String(cells[0] || '').trim();
        if (!metric) break; // a blank row ends the block
        out.push({
          metric: metric,
          worldCup: String(cells[1] || '').trim(),
          pd: String(cells[2] || '').trim(),
          delta: String(cells[3] || '').trim(),
          pctChange: String(cells[4] || '').trim(),
          verdict: String(cells[5] || '').trim(),
        });
      }
      blocks.push({
        title: title,
        worldCupLabel: String(head[1] || '').trim(),
        pdLabel: String(head[2] || '').trim(),
        rows: out,
      });
    }
    return blocks;
  }

  // ------------------------------------------------------------- content ----

  const X_STATUS = /(?:twitter|x)\.com\/([^/?#]+)\/status\/(\d+)/i;

  function parsePostUrl(url) {
    const m = X_STATUS.exec(String(url || ''));
    if (!m) return null;
    return { handle: m[1], id: m[2], url: 'https://x.com/' + m[1] + '/status/' + m[2] };
  }

  // Content Log rows that point at a real X post, newest first. CoConnect rows
  // carry no post URL and are counted separately by the day header.
  function embeddablePosts(contentRows) {
    const out = [];
    for (let i = 0; i < (contentRows || []).length; i++) {
      const r = contentRows[i];
      if (r._blank) continue;
      const post = parsePostUrl(r.link);
      if (!post) continue;
      out.push(Object.assign({}, r, {
        day: dayKey(r.date),
        handle: post.handle,
        postId: post.id,
        postUrl: post.url,
      }));
    }
    out.sort(function (a, b) {
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
    return out;
  }

  function postsByDay(contentRows) {
    const posts = embeddablePosts(contentRows);
    const map = {};
    for (let i = 0; i < posts.length; i++) {
      const d = posts[i].day;
      if (!d) continue;
      (map[d] || (map[d] = [])).push(posts[i]);
    }
    return map;
  }

  // Rows with no post URL, grouped by day - rendered as a single chip per
  // channel rather than as cards.
  function nonEmbeddableByDay(contentRows) {
    const map = {};
    for (let i = 0; i < (contentRows || []).length; i++) {
      const r = contentRows[i];
      if (r._blank || parsePostUrl(r.link)) continue;
      const d = dayKey(r.date);
      if (!d) continue;
      (map[d] || (map[d] = [])).push(r);
    }
    return map;
  }

  // Top posts by views across the campaign. Rows with no view count are
  // excluded rather than ranked as zero.
  function topContent(contentRows, limit) {
    return embeddablePosts(contentRows)
      .filter(function (r) { return r.views > 0; })
      .sort(function (a, b) { return b.views - a.views; })
      .slice(0, limit || 5);
  }

  // ----------------------------------------------------------- formatting --

  function fmtMoney(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function fmtNum(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }

  function fmtPct(frac, digits) {
    const d = digits === undefined ? 1 : digits;
    return ((Number(frac) || 0) * 100).toFixed(d) + '%';
  }

  function fmtDelta(frac) {
    const v = Number(frac) || 0;
    const sign = v > 0 ? '+' : '';
    return sign + (v * 100).toFixed(0) + '%';
  }

  // Truncates on a word boundary so a card never ends mid-word.
  function truncate(s, n) {
    const str = String(s || '');
    if (str.length <= n) return str;
    const cut = str.slice(0, n);
    const sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,]+$/, '') + '…';
  }

  return {
    PD: PD,
    TABS: TABS,
    TAB_SOURCES: TAB_SOURCES,
    COLS: COLS,
    FUNNEL_STAGES: FUNNEL_STAGES,
    parseMoney: parseMoney,
    parsePct: parsePct,
    parseSheetDate: parseSheetDate,
    isoDate: isoDate,
    dayKey: dayKey,
    addDays: addDays,
    daysBetween: daysBetween,
    parseCSV: parseCSV,
    detectHeaderIndex: detectHeaderIndex,
    rowsToObjects: rowsToObjects,
    populatedDays: populatedDays,
    volumeByDay: volumeByDay,
    todaySoFar: todaySoFar,
    hourlyCumulative: hourlyCumulative,
    snapshotsForDay: snapshotsForDay,
    latestSnapshot: latestSnapshot,
    sameHourYesterday: sameHourYesterday,
    yesterdayFinal: yesterdayFinal,
    pacingSeries: pacingSeries,
    funnel: funnel,
    mergeSnapshots: mergeSnapshots,
    CAMPAIGN_METRICS: CAMPAIGN_METRICS,
    campaignPacing: campaignPacing,
    channelBlock: channelBlock,
    activeChannels: activeChannels,
    comparisonBlocks: comparisonBlocks,
    parsePostUrl: parsePostUrl,
    embeddablePosts: embeddablePosts,
    postsByDay: postsByDay,
    nonEmbeddableByDay: nonEmbeddableByDay,
    topContent: topContent,
    fmtMoney: fmtMoney,
    fmtNum: fmtNum,
    fmtPct: fmtPct,
    fmtDelta: fmtDelta,
    truncate: truncate,
  };
});
