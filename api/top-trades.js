// GET /api/top-trades?window=24h|168h|720h|all&limit=&scan=
//
// Biggest individual trades, across traders, for a window.
//
// There is no upstream endpoint for this - Outcome ranks traders, not trades -
// so the list is assembled by taking the window's top-ranked traders, rebuilding
// each one's positions from their Hyperliquid fills, and ranking the positions.
//
// That makes it an approximation and the response says so: `scanned` reports how
// many traders were examined. A trader whose standout win was cancelled out by
// losses ranks low overall, so their big trade can fall outside the scanned set.
// Scanning deeper closes the gap at a linear cost in upstream calls, which is
// why `scan` is capped rather than unbounded.

const L = require('./_lib/outcome.js');

const DEFAULT_SCAN = 25;
const MAX_SCAN = 40;
const CONCURRENCY = 5; // upstream is rate-limited at 60/min; stay well under

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const win = Object.prototype.hasOwnProperty.call(L.WINDOWS, q.window) ? q.window : '24h';
    const limit = clamp(parseInt(q.limit, 10) || 25, 1, 100);
    const scan = clamp(parseInt(q.scan, 10) || DEFAULT_SCAN, 1, MAX_SCAN);

    const board = await L.leaderboard({ duration: win, limit: scan, offset: 0 });
    // Traders with no username have no address on the leaderboard and cannot be
    // looked up, so they are unreachable here regardless of their PnL.
    const candidates = (board.rows || []).filter((r) => r.username).slice(0, scan);

    const entries = await pool(candidates, CONCURRENCY, async (row) => {
      try {
        const p = await L.profile(row.username);
        const fills = await L.userFills(p.address, null);
        const built = L.buildPositions(fills);
        if (!built.length) return null;

        const markets = await L.markets(built.map((x) => x.outcomeId));
        return {
          username: p.username || row.username,
          address: p.address,
          avatar: L.avatarUrl(p.avatar) || L.avatarUrl(row.avatar),
          verified: Boolean(row.x_verified),
          positions: built.map((x) => L.decorate(x, markets[x.outcomeId])),
        };
      } catch (err) {
        // One unreachable trader must not empty the whole board.
        return null;
      }
    });

    const found = entries.filter(Boolean);
    const trades = L.rankTrades(found, win, limit).map(flatten);

    L.send(
      res,
      200,
      {
        ok: true,
        window: win,
        scanned: found.length,
        requested: candidates.length,
        trades,
      },
      's-maxage=60, stale-while-revalidate=300'
    );
  } catch (err) {
    L.fail(res, err);
  }
};

// The row is self-contained on purpose: the UI renders and builds a card link
// from it without a second request, which is the whole point of this view.
function flatten(t) {
  const p = t.position;
  return {
    username: t.username,
    address: t.address,
    avatar: t.avatar,
    verified: t.verified,
    coin: p.coin,
    title: p.title,
    sideLabel: p.sideLabel,
    theme: p.theme,
    outcome: p.outcome,
    shares: p.shares,
    avgEntry: p.avgEntry,
    exitPrice: p.exitPrice,
    bought: p.bought,
    earned: p.earned,
    pnl: p.pnl,
    pnlPct: p.pnlPct,
    closedAt: p.closedAt,
    cardReady: p.cardReady,
  };
}

// Bounded-concurrency map; preserves input order.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
