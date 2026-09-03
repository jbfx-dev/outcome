// GET /api/leaderboard?duration=24h|168h|720h|all&limit=&offset=
// Mirrors Outcome's own leaderboard, trimmed to what the table renders.

const L = require('../_lib/outcome.js');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const data = await L.leaderboard({
      duration: q.duration || '24h',
      limit: q.limit,
      offset: q.offset,
    });

    // Some ranked traders never set a username. They still have PnL and volume,
    // but the leaderboard carries no address for them, so there is nothing to
    // look up - the UI shows them in place, ranked, and not clickable.
    const rows = (data.rows || []).map((r) => ({
      rank: r.position,
      username: r.username || null,
      anonymous: !r.username,
      avatar: L.avatarUrl(r.avatar),
      verified: Boolean(r.x_verified),
      badges: (r.hof && r.hof.equipped_badges) || [],
      pnl: Number(r.pnl),
      pnlPct: Number(r.pnl_pct),
      volume: Number(r.volume),
    }));

    L.send(
      res,
      200,
      {
        ok: true,
        duration: q.duration || '24h',
        total: data.total ?? rows.length,
        offset: data.offset ?? 0,
        updatedAt: data.last_updated_at ?? null,
        rows,
      },
      's-maxage=30, stale-while-revalidate=120'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
