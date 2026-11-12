// GET /api/pd/sheet?tab=daily|hourly|content|channels|comparison[&c=pd|v3]
//
// Reads one tab of a Campaign Tracker and returns it as parsed objects. `c`
// picks the campaign's tracker (default pd). `wcdaily` and `pddaily` are fixed
// baselines and read the same document whichever campaign asks.
// Read-only: the sheet is the system of record and nothing here writes to it.
//
// The tab is a key, not a name - see api/_lib/pd.js for why.

const L = require('../_lib/pd.js');
const D = L.D;

module.exports = async (req, res) => {
  try {
    const tab = String((req.query && req.query.tab) || 'daily');
    if (!L.TABS[tab]) throw new L.UpstreamError('unknown_tab', 400);

    const campaign = L.campaignOf(req);
    const rows = await L.sheetRows(tab, campaign);

    // WC vs PD Comparison is two labelled blocks rather than one table, so it
    // is shaped by heading rather than mapped through a header row.
    if (tab === 'comparison') {
      return L.send(
        res, 200,
        {
          ok: true,
          tab,
          campaign,
          blocks: D.comparisonBlocks(rows),
          fetchedAt: new Date().toISOString(),
        },
        's-maxage=60, stale-while-revalidate=300'
      );
    }

    // The header row is detected, not assumed: Daily Totals puts it on row 1,
    // Channel Summary carries a banner above it.
    let objects = D.rowsToObjects(rows, D.COLS[tab]).filter((r) => !r._blank);

    // Channel Summary carries two further blocks below the channel table.
    if (tab === 'channels') objects = D.channelBlock(objects);

    // The World Cup tracker ends with an unlabelled totals row that has no
    // date; populatedDays drops it, and the page only ever wants real days.
    if (tab === 'wcdaily' || tab === 'pddaily') objects = D.populatedDays(objects);

    L.send(
      res, 200,
      { ok: true, tab, campaign, count: objects.length, rows: objects, fetchedAt: new Date().toISOString() },
      's-maxage=60, stale-while-revalidate=300'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
