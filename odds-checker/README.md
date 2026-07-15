# odds-checker — live World Cup winner odds board

Served at https://dev.jbfx.me/odds-checker/

- `index.html` here is fully self-contained (logos + lockup embedded).
- The serverless proxies live at the REPO ROOT in `/api` (kalshi.js, sxbet.js,
  sportsbooks.js, fanatics.js) because Vercel only builds functions from the
  project-root `api/` directory. The page calls them via absolute paths
  (`/api/kalshi` etc.), which works from this subfolder.
- Required env var on the Vercel project: `ODDS_API_KEY` (The Odds API).
  Optional: `ODDS_REGIONS` (default us,uk,eu,au), `ODDS_CACHE_S` (default 900).
- Drop the 1200x630 share graphic in THIS folder as `og.png` (meta tags
  already point to https://dev.jbfx.me/odds-checker/og.png).
- Trade CTA: `CONFIG.tradeUrl` in index.html → https://go.outcome.xyz/odds.
