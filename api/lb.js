// GET /api/lb/<route>  ->  one function, one handler per route.
//
// Vercel counts every non-underscore file under api/ as a separate serverless
// function, and the Hobby plan caps them at 12. The leaderboard app alone needs
// six routes plus a diagnostic, which would blow the budget on its own, so the
// handlers live in api/_lb/ (underscore = not deployed separately) and this
// single entry point dispatches to them. Same shape as api/pd.js.
//
// Public URLs are preserved by rewrites in vercel.json: both /api/lb/:route and
// the original flat paths (/api/leaderboard, /api/positions, …) land here.

const L = require('./_lib/outcome.js');

const ROUTES = {
  leaderboard: require('./_lb/leaderboard.js'),
  trader: require('./_lb/trader.js'),
  positions: require('./_lb/positions.js'),
  position: require('./_lb/position.js'),
  resolve: require('./_lb/resolve.js'),
  'top-trades': require('./_lb/top-trades.js'),
  diag: require('./_lb/diag.js'),
};

module.exports = async (req, res) => {
  const q = req.query || {};
  // The rewrite supplies _r. Fall back to the path so a direct hit on
  // /api/lb/positions still resolves if the rewrite is ever bypassed.
  let key = q._r;
  if (!key) {
    const m = /\/api\/lb\/([a-z-]+)/i.exec(req.url || '');
    key = m && m[1];
  }

  const handler = ROUTES[String(key || '').toLowerCase()];
  if (!handler) {
    return L.send(res, 404, {
      ok: false,
      error: 'unknown_route',
      routes: Object.keys(ROUTES),
    });
  }
  return handler(req, res);
};
