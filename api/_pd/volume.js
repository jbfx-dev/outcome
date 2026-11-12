// GET /api/pd/volume?startDate=YYYY-MM-DD[&c=pd|v3][&clip=0]
//
// `c` fits the days to that campaign's window: days outside it are dropped and
// the PD/V3 hand-over day (12 Nov, 14:00 UTC) is split using the hand-over row
// in the PD tracker. `clip=0` returns whole UTC days untouched, which is what
// the volume-vs-plan card wants - the plan is a company number, not a campaign
// one.
//
// Proxies stats.outcome.xyz builder volume and returns it collapsed to one row
// per day. stats.outcome.xyz sends no CORS headers, so the browser cannot call
// it directly.
//
// Collapsing here rather than in the browser is deliberate: the raw packed
// response is ~100 builders x N days, and the page only ever renders Outcome,
// HL Frontend, the total and the remainder.

const L = require('../_lib/pd.js');
const D = L.D;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const campaign = L.campaignOf(req);
    const clip = String(q.clip || '') !== '0';
    const startDate = ISO.test(String(q.startDate || ''))
      ? q.startDate : D.CAMPAIGNS[campaign].start;

    const url =
      L.STATS + '/api/builder/volume-daily?startDate=' + encodeURIComponent(startDate) +
      '&limitBuilders=100&format=packed';

    const api = await L.cached('vol:' + startDate, 60000, () => L.fetchJSON(url));
    let days = D.volumeByDay(api);
    let boundary = null;
    if (clip) {
      boundary = await L.boundary();
      days = D.clipVolumeDays(days, campaign, boundary);
    }

    L.send(
      res, 200,
      {
        ok: true,
        campaign,
        clipped: clip,
        boundary,
        startDate: api.startDate || startDate,
        endDate: api.endDate || null,
        builderCount: (api.builders || []).length,
        days,
        fetchedAt: new Date().toISOString(),
      },
      's-maxage=60, stale-while-revalidate=120'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
