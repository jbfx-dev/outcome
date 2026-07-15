// Vercel serverless function: proxies Fanatics Markets' public event API.
// api.fanaticsmarkets.com hard-403s any browser Origin except fanaticsmarkets.com,
// but server-to-server requests (no Origin header) return 200.
//
// Fanatics Markets event contracts are listed/cleared on CDNA (Crypto.com's
// CFTC-regulated exchange, formerly Nadex) - symbols look like
// NX.F.OPT.FIFA-WNWCW.O.1.40. The `probability` field is the headline
// yes-price in dollars ($1 payout contract).

const DEFAULT_SLUG = 'world-cup-winner-2026';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  res.setHeader('Content-Type', 'application/json');

  const slug = (req.query && req.query.slug) || DEFAULT_SLUG;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'bad_slug' }));
    return;
  }

  try {
    const r = await fetch(`https://api.fanaticsmarkets.com/events/${slug}`);
    if (!r.ok) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false, error: `upstream_${r.status}` }));
      return;
    }
    const ev = await r.json();
    const markets = (ev.markets?.outright || []).map((m) => ({
      team: m.title,
      probability: m.probability,
      marketId: m.marketId,
      symbol: m.symbol,
    }));
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      asOf: ev.lastSeenAt ? new Date(ev.lastSeenAt).toISOString() : new Date().toISOString(),
      markets,
    }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: 'fetch_failed' }));
  }
};
