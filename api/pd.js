// GET /api/pd/<route>  ->  one function, four handlers.
//
// Vercel counts every non-underscore file under api/ as a separate serverless
// function, and the plan caps them. Four PD routes would spend four slots, so
// the handlers live in api/_pd/ (underscore = not deployed on its own) and this
// single entry point dispatches to them.
//
// The public URLs are unchanged: a rewrite in vercel.json maps
// /api/pd/:route -> /api/pd?_r=:route, preserving the original query string.

const L = require('./_lib/pd.js');

const ROUTES = {
  sheet: require('./_pd/sheet.js'),
  volume: require('./_pd/volume.js'),
  hourly: require('./_pd/hourly.js'),
  oembed: require('./_pd/oembed.js'),
};

module.exports = async (req, res) => {
  const q = req.query || {};
  // The rewrite supplies _r. Fall back to the path so a direct hit on
  // /api/pd/sheet still resolves if the rewrite is ever bypassed.
  let key = q._r;
  if (!key) {
    const m = /\/api\/pd\/([a-z]+)/i.exec(req.url || '');
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
