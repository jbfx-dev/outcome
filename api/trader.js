// GET /api/trader?username=<name>
// Profile + lifetime portfolio figures.
//
// pnlHistory is [ts_ms, cumulative_pnl] sampled once a day at 00:00 UTC, and the
// newest point can be up to 24h stale. That is fine for a lifetime total but it
// cannot express a rolling 24h window - differencing it against a "now - 24h"
// cutoff reports whatever happened before midnight, which for an active trader
// is off by thousands. Windowed PnL therefore comes from /api/positions, which
// sums real closes; this route deliberately exposes lifetime figures only.

const L = require('./_lib/outcome.js');

module.exports = async (req, res) => {
  try {
    const username = L.parseProfileUrl((req.query && req.query.username) || '');
    if (!username) return L.send(res, 400, { ok: false, error: 'bad_username' });

    const p = await L.profile(username);
    const pf = await L.portfolio(p.address);

    const history = (pf.pnlHistory || [])
      .map(([t, v]) => [Number(t), Number(v)])
      .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
      .sort((a, b) => a[0] - b[0]);

    L.send(
      res,
      200,
      {
        ok: true,
        username: p.username || username,
        address: p.address,
        avatar: L.avatarUrl(p.avatar),
        verified: Boolean(p.x_verified),
        badges: p.equippedBadges || [],
        createdAt: p.created_at ?? null,
        volume: Number(pf.vlm) || 0,
        // Daily cumulative samples at 00:00 UTC, oldest first.
        pnlHistory: history,
        lifetimePnl: history.length
          ? round(history[history.length - 1][1] - history[0][1])
          : 0,
        pnlAsOf: history.length ? history[history.length - 1][0] : null,
      },
      's-maxage=60, stale-while-revalidate=300'
    );
  } catch (err) {
    if (err instanceof L.UpstreamError && err.status === 404) {
      return L.send(res, 404, { ok: false, error: 'no_such_trader' });
    }
    L.fail(res, err);
  }
};

const round = (n) => Math.round(n * 100) / 100;
