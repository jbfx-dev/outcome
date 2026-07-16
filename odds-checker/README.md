# odds-checker — live World Cup winner odds board

Served at https://outcome.labs.tg/odds-checker/

- `index.html` is fully self-contained (logos + lockup embedded); player
  headshots in `players/`, banner font + trophy in `fonts/` and `assets/`.
- The serverless proxies live at the REPO ROOT in `/api` (kalshi.js, sxbet.js,
  sportsbooks.js, fanatics.js) because Vercel only builds functions from the
  project-root `api/` directory. The page calls them via absolute paths
  (`/api/kalshi` etc.), which works from this subfolder on any domain.
- Env vars on the Vercel project: `ODDS_API_KEY` (The Odds API, paid plan),
  `ODDS_CACHE_S=900`. Optional: `ODDS_REGIONS` (default us,uk,eu,au).
- Share graphic: `og.png` in this folder (meta tags point to
  https://outcome.labs.tg/odds-checker/og.png).
- Trade CTA: `CONFIG.tradeUrl` in index.html -> https://go.outcome.xyz/odds.
