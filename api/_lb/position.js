// GET /api/position?address=0x..&coin=%23123900[&closedAt=][&title=][&side=][&theme=]
//
// One rebuilt position, addressed by wallet rather than username. This exists so
// the card renderer keeps working while Cloudflare blocks our egress from
// Outcome's API: Hyperliquid is reachable from Vercel, and Hyperliquid is where
// every financial figure comes from.
//
// The integrity split matters. Shares, entry price, exit price, amount staked,
// amount earned and win/loss are ALWAYS rebuilt here from the address's own
// fills - a caller cannot inflate them. Only the market's display title and side
// label may be supplied by the caller, and only as a fallback: when Outcome's
// API is reachable we fetch those ourselves and ignore whatever was passed. So
// the worst a forged request achieves is mislabelling which market a real trade
// was in; it can never invent the money.

const L = require('../_lib/outcome.js');

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const COIN = /^#\d+$/;
const THEMES = new Set(['default', 'hype', 'btc']);

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const address = String(q.address || '').trim();
    const coin = String(q.coin || '').trim();

    if (!ADDRESS.test(address)) return L.send(res, 400, { ok: false, error: 'bad_address' });
    if (!COIN.test(coin)) return L.send(res, 400, { ok: false, error: 'bad_coin' });

    const parsed = L.parseCoin(coin);
    if (!parsed) return L.send(res, 400, { ok: false, error: 'bad_coin' });

    const fills = await L.userFills(address, null);
    const built = L.buildPositions(fills).filter((p) => p.coin === coin);
    if (!built.length) return L.send(res, 404, { ok: false, error: 'no_such_position' });

    // Same coin can be traded more than once; closedAt disambiguates.
    let match = built;
    if (q.closedAt) {
      const exact = built.filter((p) => String(p.closedAt) === String(q.closedAt));
      if (exact.length) match = exact;
    }
    const chosen = match.reduce((a, b) =>
      (b.closedAt || b.openedAt) > (a.closedAt || a.openedAt) ? b : a
    );

    // Best-effort market metadata. If Outcome's API is blocked this stays null
    // and we fall back to the caller's labels.
    let entry = null;
    let upstream = 'ok';
    try {
      const found = await L.markets([parsed.outcomeId]);
      entry = found[parsed.outcomeId] || null;
    } catch (err) {
      upstream = err instanceof L.UpstreamError ? err.message : 'unavailable';
    }

    const position = L.decorate(chosen, entry);

    // Only fill gaps left by unreachable metadata - never override real data.
    if (!position.known) {
      const title = String(q.title || '').trim().slice(0, 120);
      const side = String(q.side || '').trim().slice(0, 24);
      if (title) {
        position.title = title;
        position.known = true;
        position.titleSource = 'client';
      }
      if (side) position.sideLabel = side.toUpperCase();
      const theme = String(q.theme || '').trim().toLowerCase();
      if (THEMES.has(theme)) position.theme = theme;
      position.cardReady = Boolean(position.resolved && position.title);
    }

    L.send(
      res,
      200,
      { ok: true, address, upstream, position },
      's-maxage=45, stale-while-revalidate=180'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
