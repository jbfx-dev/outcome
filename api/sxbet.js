// Vercel serverless function: proxies SX Bet's public API.
// api.sx.bet only sends CORS headers to an allowlist (sx.bet, localhost:3000),
// so production browser calls must go through this proxy.
//
// Usage:
//   /api/sxbet?fn=markets              -> active outright markets (league 10048)
//   /api/sxbet?fn=orders&hashes=0x..,  -> resting orders for market hashes

const LEAGUE_ID = '10048'; // "Outrights - World Cup"

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  res.setHeader('Content-Type', 'application/json');

  const q = req.query || {};
  let url;
  if (q.fn === 'markets') {
    const league = q.league && /^\d{1,8}$/.test(q.league) ? q.league : LEAGUE_ID;
    url = `https://api.sx.bet/markets/active?leagueId=${league}`;
  } else if (q.fn === 'orders') {
    const hashes = q.hashes || '';
    if (!/^0x[0-9a-fA-F]{64}(,0x[0-9a-fA-F]{64}){0,29}$/.test(hashes)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'bad_hashes' }));
      return;
    }
    url = `https://api.sx.bet/orders?marketHashes=${hashes}`;
  } else {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'bad_fn' }));
    return;
  }

  try {
    const r = await fetch(url);
    if (!r.ok) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false, error: `upstream_${r.status}` }));
      return;
    }
    const data = await r.json();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, asOf: new Date().toISOString(), data: data.data }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: 'fetch_failed' }));
  }
};
