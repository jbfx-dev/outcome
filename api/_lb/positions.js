// GET /api/positions?username=<name>&window=24h|168h|720h|all&include=resolved|all
// Rebuilds every Outcome position the trader has held, newest first, with the
// derived fields the card renderer needs already formatted.

const L = require('../_lib/outcome.js');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const username = L.parseProfileUrl(q.username || '');
    if (!username) return L.send(res, 400, { ok: false, error: 'bad_username' });

    const win = Object.prototype.hasOwnProperty.call(L.WINDOWS, q.window) ? q.window : 'all';
    const includeOpen = q.include === 'all';

    const p = await L.profile(username);
    const since = L.windowStart(win);
    const fills = await L.userFills(p.address, since);

    let positions = L.buildPositions(fills);

    // Window on when the position closed (or opened, if it is still open) so a
    // "last 24h" view shows what the trader actually settled in that period.
    if (since != null) positions = positions.filter((x) => (x.closedAt ?? x.lastTime) >= since);

    const entries = await L.markets(positions.map((x) => x.outcomeId));

    let rows = positions
      .map((x) => L.decorate(x, entries[x.outcomeId]))
      .sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt));

    if (!includeOpen) rows = rows.filter((r) => r.resolved);

    const resolved = rows.filter((r) => r.resolved);
    const wins = resolved.filter((r) => r.outcome === 'win').length;

    L.send(
      res,
      200,
      {
        ok: true,
        username: p.username || username,
        address: p.address,
        avatar: L.avatarUrl(p.avatar),
        window: win,
        // Fills only reach back 2,000 trades plus whatever paging covered, so
        // this is "as far back as we can see", not necessarily all-time.
        truncated: since == null && fills.length >= 2000,
        summary: {
          positions: resolved.length,
          wins,
          losses: resolved.length - wins,
          winRate: resolved.length ? Math.round((wins / resolved.length) * 1000) / 10 : 0,
          pnl: round(resolved.reduce((s, r) => s + r.pnl, 0)),
          bought: round(resolved.reduce((s, r) => s + r.bought, 0)),
          earned: round(resolved.reduce((s, r) => s + r.earned, 0)),
        },
        positions: rows,
      },
      's-maxage=45, stale-while-revalidate=180'
    );
  } catch (err) {
    if (err instanceof L.UpstreamError && err.status === 404) {
      return L.send(res, 404, { ok: false, error: 'no_such_trader' });
    }
    L.fail(res, err);
  }
};

const round = (n) => Math.round(n * 100) / 100;
