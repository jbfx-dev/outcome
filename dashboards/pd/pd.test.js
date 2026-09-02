// Unit tests for dashboards/pd/pd.js. No framework, no dependencies:
//
//   node dashboards/pd/pd.test.js
//
// Exits non-zero on the first failure so it can gate a deploy.

const assert = require('node:assert/strict');
const P = require('./pd.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

// ------------------------------------------------------------ parseMoney ----

test('parseMoney strips $ and thousands separators', () => {
  assert.equal(P.parseMoney('$2,906,369'), 2906369);
  assert.equal(P.parseMoney('$78,426'), 78426);
  assert.equal(P.parseMoney('161,062'), 161062);
});

test('parseMoney handles plain numbers and numeric input', () => {
  assert.equal(P.parseMoney('20546'), 20546);
  assert.equal(P.parseMoney(1234.5), 1234.5);
  assert.equal(P.parseMoney('753636.84'), 753636.84);
});

test('parseMoney treats blank and junk as zero', () => {
  assert.equal(P.parseMoney(''), 0);
  assert.equal(P.parseMoney(null), 0);
  assert.equal(P.parseMoney(undefined), 0);
  assert.equal(P.parseMoney('-'), 0);
  assert.equal(P.parseMoney(NaN), 0);
});

test('parseMoney keeps negatives', () => {
  assert.equal(P.parseMoney('-$1,200'), -1200);
});

// -------------------------------------------------------------- parsePct ----

test('parsePct reads the CSV percent string', () => {
  assert.ok(Math.abs(P.parsePct('72.08%') - 0.7208) < 1e-9);
  assert.ok(Math.abs(P.parsePct('10.48%') - 0.1048) < 1e-9);
});

test('parsePct reads the Sheets API fraction unchanged', () => {
  assert.ok(Math.abs(P.parsePct(0.7208) - 0.7208) < 1e-9);
  assert.ok(Math.abs(P.parsePct('0.7208') - 0.7208) < 1e-9);
});

test('parsePct treats a bare number above 1 as a percentage', () => {
  assert.ok(Math.abs(P.parsePct('74.2') - 0.742) < 1e-9);
});

test('parsePct returns zero for blank', () => {
  assert.equal(P.parsePct(''), 0);
  assert.equal(P.parsePct(null), 0);
});

// --------------------------------------------------------- parseSheetDate ----

test('parseSheetDate reads dd/mm/yyyy as UTC midnight', () => {
  const d = P.parseSheetDate('28/08/2026');
  assert.equal(d.toISOString(), '2026-08-28T00:00:00.000Z');
});

test('parseSheetDate does not confuse day and month', () => {
  // 01/09/2026 is 1 September, not 9 January.
  assert.equal(P.parseSheetDate('01/09/2026').toISOString(), '2026-09-01T00:00:00.000Z');
});

test('parseSheetDate reads the ISO form used by Content Log', () => {
  assert.equal(P.parseSheetDate('2026-08-31').toISOString(), '2026-08-31T00:00:00.000Z');
});

test('parseSheetDate returns null for blank or unparseable input', () => {
  assert.equal(P.parseSheetDate(''), null);
  assert.equal(P.parseSheetDate('not a date'), null);
  assert.equal(P.parseSheetDate(null), null);
});

test('addDays and daysBetween work across a month boundary', () => {
  assert.equal(P.addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(P.addDays('2026-09-01', -1), '2026-08-31');
  assert.equal(P.daysBetween('2026-08-28', '2026-09-02'), 5);
});

// -------------------------------------------------------------- parseCSV ----

test('parseCSV handles quoted fields containing commas and quotes', () => {
  const rows = P.parseCSV('"a","b,c","he said ""hi"""\n"1","2","3"');
  assert.deepEqual(rows[0], ['a', 'b,c', 'he said "hi"']);
  assert.deepEqual(rows[1], ['1', '2', '3']);
});

test('parseCSV handles a newline inside a quoted field', () => {
  const rows = P.parseCSV('"a","line1\nline2"\n"b","c"');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], 'line1\nline2');
});

// --------------------------------------------------------- rowsToObjects ----

test('rowsToObjects maps headers to fields and parses by type', () => {
  const rows = P.parseCSV(
    '"Date","Impressions","Volume (Outcome)","Market Share %"\n' +
    '"01/09/2026","63,647","$2,906,369","72.08%"'
  );
  const [r] = P.rowsToObjects(rows, P.COLS.daily);
  assert.equal(r.date, '01/09/2026');
  assert.equal(r.impressions, 63647);
  assert.equal(r.outcomeVolume, 2906369);
  assert.ok(Math.abs(r.share - 0.7208) < 1e-9);
  assert.equal(r._blank, false);
});

test('rowsToObjects ignores unknown columns and flags blank rows', () => {
  const rows = P.parseCSV(
    '"Date","Impressions","Some New Column"\n"03/09/2026","",""\n'
  );
  const [r] = P.rowsToObjects(rows, P.COLS.daily);
  assert.equal(r.impressions, 0);
  assert.equal(r._blank, false); // Date is present
  assert.equal('Some New Column' in r, false);
});

test('populatedDays drops future rows that carry only a date', () => {
  const rows = P.parseCSV(
    '"Date","Impressions","Clicks"\n' +
    '"01/09/2026","63,647","13,207"\n' +
    '"03/09/2026","",""\n'
  );
  const days = P.populatedDays(P.rowsToObjects(rows, P.COLS.daily));
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '01/09/2026');
});

// ------------------------------------------------------------ volumeByDay ----

// Shaped like the packed response: builders[i], dates[j], series.volume[i][j].
const VOL_API = {
  startDate: '2026-08-28',
  endDate: '2026-08-29',
  builders: ['null', '0xab5dbc057628bc18523c4cdfc0e1e2ebdbecb704', '0xother'],
  dates: ['2026-08-28', '2026-08-29'],
  series: {
    volume: [
      ['589573', '417820'], // HL frontend
      ['78426', '234630'],  // Outcome
      ['80105', '71255'],   // one other builder
    ],
  },
};

test('volumeByDay picks Outcome and HL Frontend out of the packed series', () => {
  const days = P.volumeByDay(VOL_API);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-08-28');
  assert.equal(days[0].outcome, 78426);
  assert.equal(days[0].hlFrontend, 589573);
});

test('volumeByDay totals every builder, not just Outcome and HL', () => {
  const days = P.volumeByDay(VOL_API);
  assert.equal(days[0].total, 78426 + 589573 + 80105);
  assert.equal(days[0].other, 80105);
});

test('market share is Outcome over total HIP-4, never Outcome/(Outcome+HL)', () => {
  const days = P.volumeByDay(VOL_API);
  const d = days[0];
  assert.ok(Math.abs(d.share - d.outcome / d.total) < 1e-12);
  // The wrong formula would give 0.117; the right one gives 0.1048.
  assert.ok(Math.abs(d.share - 0.1048) < 0.0001);
  assert.ok(Math.abs(d.share - d.outcome / (d.outcome + d.hlFrontend)) > 0.01);
});

test('volumeByDay reproduces the published Sep 1 share of 72.08%', () => {
  // Daily Totals!J6 reads 72.08%. Same numbers, derived from the API shape.
  const api = {
    builders: ['null', '0xab5dbc057628bc18523c4cdfc0e1e2ebdbecb704', '0xother'],
    dates: ['2026-09-01'],
    series: { volume: [['690413'], ['2906369'], ['435115']] },
  };
  const [d] = P.volumeByDay(api);
  assert.equal(d.total, 4031897);
  assert.ok(Math.abs(d.share * 100 - 72.08) < 0.1);
});

test('volumeByDay survives a zero-volume day without dividing by zero', () => {
  const [d] = P.volumeByDay({
    builders: ['null', '0xab5dbc057628bc18523c4cdfc0e1e2ebdbecb704'],
    dates: ['2026-08-27'],
    series: { volume: [['0'], ['0']] },
  });
  assert.equal(d.share, 0);
  assert.ok(Number.isFinite(d.share));
});

test('volumeByDay returns an empty list for a malformed response', () => {
  assert.deepEqual(P.volumeByDay(null), []);
  assert.deepEqual(P.volumeByDay({}), []);
});

// ------------------------------------------------------- sameHourYesterday ----

const SNAPS = P.rowsToObjects(
  P.parseCSV(
    '"Timestamp (UTC)","Date","Hour (UTC)","Outcome Volume","Signups","Run Type"\n' +
    '"2026-09-01T13:00:00Z","2026-09-01","13","1200000","300","backfill"\n' +
    '"2026-09-01T14:00:00Z","2026-09-01","14","1400000","350","backfill"\n' +
    '"2026-09-01T24:00:00Z","2026-09-01","24","2906369","397","full"\n' +
    '"2026-09-02T14:16:08Z","2026-09-02","14","1660250","198","seed"\n'
  ),
  P.COLS.hourly
);

test('sameHourYesterday matches on Date + Hour, not timestamp equality', () => {
  // Today's 14:16:08Z row must find yesterday's 14:00:00Z row.
  assert.equal(P.sameHourYesterday(SNAPS, 'outcomeVolume', '2026-09-02', 14), 1400000);
  assert.equal(P.sameHourYesterday(SNAPS, 'signups', '2026-09-02', 14), 350);
});

test('sameHourYesterday returns null when that hour was never recorded', () => {
  assert.equal(P.sameHourYesterday(SNAPS, 'outcomeVolume', '2026-09-02', 3), null);
});

test('sameHourYesterday returns null when there is no previous day at all', () => {
  assert.equal(P.sameHourYesterday(SNAPS, 'outcomeVolume', '2026-08-28', 14), null);
});

test('yesterdayFinal prefers the Hour 24 end-of-day row', () => {
  assert.equal(P.yesterdayFinal(SNAPS, 'outcomeVolume', '2026-09-02'), 2906369);
});

test('latestSnapshot returns the newest row by timestamp', () => {
  assert.equal(P.latestSnapshot(SNAPS).timestamp, '2026-09-02T14:16:08Z');
});

// ---------------------------------------------------------- pacingSeries ----

test('pacingSeries interpolates a gap and flags the filled points', () => {
  const snaps = P.rowsToObjects(
    P.parseCSV(
      '"Timestamp (UTC)","Date","Hour (UTC)","Outcome Volume"\n' +
      '"2026-09-02T10:00:00Z","2026-09-02","10","1000"\n' +
      '"2026-09-02T13:00:00Z","2026-09-02","13","4000"\n'
    ),
    P.COLS.hourly
  );
  const series = P.pacingSeries(snaps, '2026-09-02', 'outcomeVolume');
  assert.deepEqual(series.map((p) => p.hour), [10, 11, 12, 13]);
  assert.equal(series[0].value, 1000);
  assert.equal(series[1].value, 2000); // linearly filled
  assert.equal(series[2].value, 3000);
  assert.equal(series[3].value, 4000);
  assert.equal(series[1].interpolated, true);
  assert.equal(series[0].interpolated, false);
});

test('pacingSeries skips hours where the metric was blank, not zero', () => {
  // Impressions are empty on backfill rows. A blank must not plot as 0, or the
  // curve reads as a real collapse to zero and back.
  const snaps = P.rowsToObjects(
    P.parseCSV(
      '"Timestamp (UTC)","Date","Hour (UTC)","Impressions","Run Type"\n' +
      '"2026-09-02T10:00:00Z","2026-09-02","10","5000","full"\n' +
      '"2026-09-02T11:00:00Z","2026-09-02","11","","backfill"\n' +
      '"2026-09-02T12:00:00Z","2026-09-02","12","9000","full"\n'
    ),
    P.COLS.hourly
  );
  const series = P.pacingSeries(snaps, '2026-09-02', 'impressions');
  assert.deepEqual(series.map((p) => p.value), [5000, 7000, 9000]);
  assert.equal(series[1].interpolated, true);
});

test('a real zero is still plotted as zero', () => {
  const snaps = P.rowsToObjects(
    P.parseCSV(
      '"Timestamp (UTC)","Date","Hour (UTC)","Signups"\n' +
      '"2026-09-02T10:00:00Z","2026-09-02","10","0"\n' +
      '"2026-09-02T11:00:00Z","2026-09-02","11","4"\n'
    ),
    P.COLS.hourly
  );
  const series = P.pacingSeries(snaps, '2026-09-02', 'signups');
  assert.deepEqual(series.map((p) => p.value), [0, 4]);
});

test('campaignPacing aligns PD day 1 against World Cup day 1', () => {
  // Both trackers carry the same Daily Totals headers, so one column map reads
  // each and the two campaigns are compared by day index, not by calendar date.
  const pdDaily = P.rowsToObjects(
    P.parseCSV(
      '"Date","Volume (Outcome)","Signups"\n' +
      '"28/08/2026","$78,426","28"\n' +
      '"29/08/2026","$234,630","989"\n'
    ),
    P.COLS.daily
  );
  const wcDaily = P.rowsToObjects(
    P.parseCSV(
      '"Date","Volume (Outcome)","Signups"\n' +
      '"10/06/2026","$122,600","520"\n' +
      '"11/06/2026","$172,500","416"\n'
    ),
    P.COLS.wcdaily
  );

  const s2 = P.campaignPacing(pdDaily, wcDaily, 'volume');
  assert.equal(s2.pd[0].day, 1);
  assert.equal(s2.pd[0].value, 78426);
  assert.equal(s2.pd[1].value, 78426 + 234630); // cumulative
  assert.equal(s2.wc[0].day, 1);
  assert.equal(s2.wc[0].value, 122600);
  assert.equal(s2.wc[1].value, 122600 + 172500);

  const bySignups = P.campaignPacing(pdDaily, wcDaily, 'signups');
  assert.equal(bySignups.pd[1].value, 28 + 989);
  assert.equal(bySignups.wc[1].value, 520 + 416);
});

test('campaignPacing ignores the trailing totals row with no date', () => {
  // The World Cup tracker ends with an unlabelled row carrying campaign totals.
  const wcDaily = P.rowsToObjects(
    P.parseCSV(
      '"Date","Volume (Outcome)"\n' +
      '"10/06/2026","$122,600"\n' +
      '"","$149,643,574.00"\n'
    ),
    P.COLS.wcdaily
  );
  const s2 = P.campaignPacing([], wcDaily, 'volume');
  assert.equal(s2.wc.length, 1);
  assert.equal(s2.wc[0].value, 122600);
});

test('campaignPacing survives an empty side', () => {
  const s2 = P.campaignPacing([], [], 'volume');
  assert.deepEqual(s2.pd, []);
  assert.deepEqual(s2.wc, []);
});

test('pacingSeries returns empty for a day with no snapshots', () => {
  assert.deepEqual(P.pacingSeries(SNAPS, '2026-07-01', 'outcomeVolume'), []);
});

// ---------------------------------------------------------------- funnel ----

test('funnel sums the campaign and computes step conversion', () => {
  const rows = P.rowsToObjects(
    P.parseCSV(
      '"Date","Impressions","Clicks","Total Unique Visitors","Signups","Depositors","Active Traders"\n' +
      '"28/08/2026","1000","100","50","10","2","5"\n' +
      '"29/08/2026","1000","100","50","10","2","5"\n'
    ),
    P.COLS.daily
  );
  const f = P.funnel(rows);
  assert.equal(f[0].value, 2000);
  assert.equal(f[0].convFromPrev, null);
  assert.equal(f[1].value, 200);
  assert.ok(Math.abs(f[1].convFromPrev - 0.1) < 1e-9);
  assert.equal(f[3].stage, 'Signups');
  assert.equal(f[3].value, 20);
});

test('funnel does not divide by zero on an empty campaign', () => {
  const f = P.funnel([]);
  assert.equal(f[0].value, 0);
  assert.equal(f[1].convFromPrev, 0);
});

// --------------------------------------------------------------- content ----

test('parsePostUrl accepts x.com and twitter.com status links', () => {
  const a = P.parsePostUrl('https://x.com/Outcomexyz/status/2094420535417684343');
  assert.equal(a.handle, 'Outcomexyz');
  assert.equal(a.id, '2094420535417684343');
  const b = P.parsePostUrl('https://twitter.com/someone/status/123');
  assert.equal(b.id, '123');
});

test('parsePostUrl rejects a non-post link', () => {
  assert.equal(P.parsePostUrl('https://outcome.xyz/rewards'), null);
  assert.equal(P.parsePostUrl(''), null);
});

test('postsByDay groups only rows with a real post URL', () => {
  const rows = P.rowsToObjects(
    P.parseCSV(
      '"Date","Channel","Copy","Published Post Link","Views"\n' +
      '"2026-08-31","X Organic","a","https://x.com/Outcomexyz/status/1","3005"\n' +
      '"2026-08-31","CoConnect Communities","b","","0"\n' +
      '"2026-08-30","X Organic","c","https://x.com/Outcomexyz/status/2","391"\n'
    ),
    P.COLS.content
  );
  const byDay = P.postsByDay(rows);
  assert.equal(byDay['2026-08-31'].length, 1);
  assert.equal(byDay['2026-08-30'].length, 1);
  assert.equal(P.nonEmbeddableByDay(rows)['2026-08-31'].length, 1);
});

test('topContent ranks by views and excludes rows with none', () => {
  const rows = P.rowsToObjects(
    P.parseCSV(
      '"Date","Channel","Published Post Link","Views"\n' +
      '"2026-08-31","X Organic","https://x.com/a/status/1","3005"\n' +
      '"2026-08-31","X Organic","https://x.com/a/status/2","10429"\n' +
      '"2026-08-31","CoConnect Communities","https://x.com/a/status/3",""\n'
    ),
    P.COLS.content
  );
  const top = P.topContent(rows, 5);
  assert.equal(top.length, 2);
  assert.equal(top[0].views, 10429);
});

// ------------------------------------------------------------ formatting ----

test('formatters produce the compact forms the cards use', () => {
  assert.equal(P.fmtMoney(1370000), '$1.37M');
  assert.equal(P.fmtMoney(2900), '$2.9K');
  assert.equal(P.fmtNum(2900), '2.9K');
  assert.equal(P.fmtPct(0.7208), '72.1%');
  assert.equal(P.fmtDelta(0.23), '+23%');
  assert.equal(P.fmtDelta(-0.1), '-10%');
});

test('truncate cuts on a word boundary', () => {
  const s = P.truncate('the quick brown fox jumps over the lazy dog', 20);
  assert.ok(s.length <= 21);
  assert.ok(s.endsWith('…'));
  assert.ok(!s.includes('jumpsx'));
});

// ----------------------------------------------------------------- report ----

for (const f of failures) {
  console.error(`FAIL  ${f.name}\n      ${f.err.message.split('\n')[0]}`);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
