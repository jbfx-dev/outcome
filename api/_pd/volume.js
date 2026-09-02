// GET /api/pd/volume?startDate=YYYY-MM-DD
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
    const startDate = ISO.test(String(q.startDate || '')) ? q.startDate : D.PD.campaignStart;

    const url =
      L.STATS + '/api/builder/volume-daily?startDate=' + encodeURIComponent(startDate) +
      '&limitBuilders=100&format=packed';

    const api = await L.cached('vol:' + startDate, 60000, () => L.fetchJSON(url));
    const days = D.volumeByDay(api);

    L.send(
      res, 200,
      {
        ok: true,
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
