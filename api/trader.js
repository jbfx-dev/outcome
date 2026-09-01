// GET /api/trader?username=<name>
// Profile + Outcome's own portfolio figures.
//
// Both portfolio numbers are 30-DAY windows, not lifetime totals - verified
// against the leaderboard: traders idle for a month report pnlHistory 0 and
// vlm ~0 while their all-time PnL is five or six figures (zk_nft9293: 30d 0 /
// all-time $15.5k, vlm $75 / all-time volume $2.85M). Labelling either as
// "lifetime" would show $0 for a trader who has made a fortune, so they are
// named for the window they actually cover.
//
// pnlHistory is [ts_ms, cumulative_pnl] sampled daily at 00:00 UTC and rebased
// to 0 at the window start, so the newest point can be up to 24h stale. It
// cannot express a rolling 24h window either - differencing it against a
// "now - 24h" cutoff reports whatever happened before midnight. Windowed PnL
// therefore comes from /api/positions, which sums real closes.

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
        volume30d: Number(pf.vlm) || 0,
        // Daily cumulative samples at 00:00 UTC, oldest first, rebased to 0.
        pnlHistory: history,
        pnl30d: history.length
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
