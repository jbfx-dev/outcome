// Vercel serverless function: proxies Kalshi's public market data.
// Needed because api.elections.kalshi.com returns 403 to any browser Origin
// other than kalshi.com (CloudFront origin check) - server-side calls are fine.

const DEFAULT_EVENT = 'KXMENWORLDCUP-26';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  res.setHeader('Content-Type', 'application/json');

  const event = (req.query && req.query.event) || DEFAULT_EVENT;
  if (!/^[A-Z0-9-]{1,40}$/.test(event)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'bad_event' }));
    return;
  }

  const url =
    'https://api.elections.kalshi.com/trade-api/v2/markets' +
    `?event_ticker=${encodeURIComponent(event)}&limit=200&status=open`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false, error: `upstream_${r.status}` }));
      return;
    }
    const data = await r.json();
    const markets = (data.markets || []).map((m) => ({
      ticker: m.ticker,
      team: m.yes_sub_title,
      yes_bid: parseFloat(m.yes_bid_dollars),
      yes_ask: parseFloat(m.yes_ask_dollars),
      last: parseFloat(m.last_price_dollars),
      status: m.status,
    }));
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, asOf: new Date().toISOString(), markets }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: 'fetch_failed' }));
  }
};
