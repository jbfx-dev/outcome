// GET /api/pd/hourly?builder=outcome|hl&hours=48
//
// Proxies the per-builder hourly volume endpoint, which powers the intra-day
// pacing curve. Upstream requires an explicit builder and caps the window at
// 168 hours; both are enforced here so a bad query never reaches it.
//
// The builder is a key, not an address: the page only ever needs these two,
// and keeping it closed means this cannot be pointed at arbitrary input.

const L = require('../_lib/pd.js');
const D = L.D;

const BUILDERS = {
  outcome: D.PD.outcomeBuilder,
  hl: D.PD.hlFrontendBuilder, // "null" is HL's own frontend, not a missing value
};

const MAX_HOURS = 168;

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const key = String(q.builder || 'outcome');
    const builder = BUILDERS[key];
    if (!builder) throw new L.UpstreamError('unknown_builder', 400);

    let hours = parseInt(q.hours, 10);
    if (!Number.isFinite(hours) || hours < 1) hours = 48;
    hours = Math.min(hours, MAX_HOURS);

    const url =
      L.STATS + '/api/builder/hourly?builder=' + encodeURIComponent(builder) +
      '&hours=' + hours;

    const api = await L.cached(`hr:${key}:${hours}`, 60000, () => L.fetchJSON(url));

    L.send(
      res, 200,
      {
        ok: true,
        builder: key,
        startHour: api.startHour || null,
        endHour: api.endHour || null,
        hours: api.hours || [],
        series: api.series || {},
        fetchedAt: new Date().toISOString(),
      },
      's-maxage=60, stale-while-revalidate=120'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
