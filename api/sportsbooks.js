// Vercel serverless function: proxies The Odds API for sportsbook outright odds.
// Keeps ODDS_API_KEY server-side and edge-caches responses to conserve credits.
//
// Env vars:
//   ODDS_API_KEY   (required) - your key from https://the-odds-api.com
//   ODDS_REGIONS   (optional) - default "us,uk,eu,au"  (each region = 1 credit per call)
//   ODDS_CACHE_S   (optional) - edge cache seconds, default 900 (15 min)

const SPORT_KEY = 'soccer_fifa_world_cup_winner';

// The bookmaker keys we surface (The Odds API key -> display name)
const BOOKS = {
  fanduel: 'FanDuel',
  draftkings: 'DraftKings',
  fanatics: 'Fanatics',
  betus: 'BetUS',
  onexbet: '1xBet',
  ladbrokes_uk: 'Ladbrokes',
  bet365_au: 'bet365',
  betfair_ex_uk: 'Betfair',
  williamhill: 'William Hill',
  unibet: 'Unibet',
  tab: 'TAB',
};

module.exports = async (req, res) => {
  const key = process.env.ODDS_API_KEY;
  const cacheS = parseInt(process.env.ODDS_CACHE_S || '900', 10);
  res.setHeader('Cache-Control', `s-maxage=${cacheS}, stale-while-revalidate=${cacheS * 2}`);
  res.setHeader('Content-Type', 'application/json');

  if (!key) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: 'missing_key' }));
    return;
  }

  const regions = process.env.ODDS_REGIONS || 'us,uk,eu,au';
  const url =
    `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/` +
    `?apiKey=${encodeURIComponent(key)}&regions=${encodeURIComponent(regions)}` +
    `&markets=outrights&oddsFormat=decimal&dateFormat=iso`;

  try {
    const r = await fetch(url);
    const remaining = r.headers.get('x-requests-remaining');
    if (!r.ok) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false, error: `upstream_${r.status}` }));
      return;
    }
    const events = await r.json();
    // Outrights come back as a single "event" whose bookmakers each carry an
    // outrights market with { name, price } outcomes (decimal odds).
    const books = [];
    for (const ev of events) {
      for (const bk of ev.bookmakers || []) {
        if (!BOOKS[bk.key]) continue;
        const market = (bk.markets || []).find((m) => m.key === 'outrights');
        if (!market) continue;
        books.push({
          key: bk.key,
          name: BOOKS[bk.key],
          last_update: market.last_update || bk.last_update,
          outcomes: (market.outcomes || []).map((o) => ({ name: o.name, price: o.price })),
        });
      }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, asOf: new Date().toISOString(), creditsRemaining: remaining, books }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: 'fetch_failed' }));
  }
};
