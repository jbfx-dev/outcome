# Outcome Leaderboard & PnL Share Cards

Creator tool at `/leaderboard`. Mirrors Outcome's leaderboard, rolls up each
trader's full position history, and renders a downloadable PnL share card PNG
for any resolved position. No login, no wallet, read-only.

## How the data fits together

Outcome runs its markets on Hyperliquid, so identity and market metadata come
from Outcome while the actual trades come from Hyperliquid.

| Need | Source |
|---|---|
| Ranked traders | `POST o1.outcome.xyz/api/v1/leaderboard` (`24h`/`168h`/`720h`/`all`) |
| username → address | `POST o1.outcome.xyz/api/v1/profile/lookup` |
| 30-day PnL / volume | `POST o1.outcome.xyz/api/v1/portfolio/lookup` |
| Market names, sides, settlement | `POST o1.outcome.xyz/api/v1/markets/lookup` |
| Trades | `POST api.hyperliquid.xyz/info` (`userFills`, `userFillsByTime`) |

Neither upstream sends permissive CORS headers, and Outcome's API returns 403
without a browser `User-Agent`, so **every call goes through `api/`** — the page
never talks to an upstream directly.

### Coin ↔ market

Outcome market coins are `#<outcome_id><side>`, last digit being the side:
`#13030` → outcome 1303, side 0; `#13031` → outcome 1303, side 1.

A trader's fills also contain ordinary Hyperliquid perps and spot (`xyz:META`,
`FOGO`, `@188`). Those are not prediction markets and are filtered out — for a
typical trader they are the majority of fills.

### Rebuilding positions

A position is one coin's full lifecycle: opened from flat, closed back to flat
or settled at resolution. Re-entering the same market after fully closing counts
as a separate position.

Two things about Hyperliquid's fills matter and are easy to get wrong:

- Fills come back **newest-first**, and fills sharing a timestamp are only
  correctly ordered by array position — partial fills of one order all carry the
  same `time`. Chronological order is therefore the *reversed array*, never a
  sort by `.time`. Sorting scrambles `startPosition` and corrupts the rebuild.
- Closes arrive as four `dir` values, not one: `Sell`, `Settlement` (market
  resolved), and `Merge Outcome` (trader held both sides and redeemed the pair),
  alongside `Buy`.

Correctness check: summing rebuilt realised PnL for `drogo` gives **$7,847.47**
against the leaderboard's reported 168h figure of **$7,847.45**.

### Market titles

Names arrive as template ids (`template:binaryPrice`, `Recurring`, …) with a
pipe-delimited description. `marketTitle()` formats each kind: threshold markets,
touch markets, recurring up/down dailies, price buckets, and multi-outcome
questions, with a fallback for anything unrecognised. A sweep of the top 12
all-time traders (938 positions) produced 0 unknown markets and 0 unformatted
titles.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/leaderboard?duration=24h\|168h\|720h\|all&limit=&offset=` | Ranked traders |
| `GET /api/trader?username=` | Profile + 30-day volume/PnL + daily `pnlHistory` |
| `GET /api/positions?username=&window=&include=resolved\|all` | Rebuilt positions + summary |
| `GET /api/resolve?url=` | Pasted profile link or username → username |
| `GET /api/card?username=&coin=&closedAt=&theme=&download=1` | Rendered PNG |

### Why the card endpoint re-derives its own numbers

`/api/card` takes a trader and a coin, then fetches `/api/positions` and derives
the figures itself. It deliberately does **not** accept amounts from the query
string: these cards carry Outcome branding, and an endpoint that rendered
whatever numbers a caller passed would be a forgery tool. `theme` is the only
caller-overridable field, because it changes artwork and nothing factual.

Cards for resolved positions are immutable, so they are cached on disk by
`(trader, coin, closedAt, theme)` and served with a long `Cache-Control`.

## Renderer

`api/_kit/` is a vendored copy of `outcome-pnl-card-kit` — `render.py` plus the
assets it loads by name. Only the assets `render.py` actually references are
vendored (10MB of the kit's 24MB; `up4k.png`, `card_texture.png`,
`trophy_trim.png`, `footer_outcome.png` and `icon_dollar_lime.png` are unused).

Do not rename anything in `_kit/` — `render.py` loads assets by filename from
its own directory. `vercel.json` ships the folder via `includeFiles`.

Warm render is ~0.3s for a 1780×2188 PNG.

## Local development

`vercel dev` runs the whole thing. Without it, any static server plus a shim
that maps `/api/<name>` to `api/<name>.js` works; `api/card.py` needs
`pip install pillow numpy`.

## Known limits

- Hyperliquid returns at most 2,000 recent fills, and `userFillsByTime` pages
  backwards 2,000 at a time. Heavy traders are therefore capped at "recent
  history", which the UI states rather than hides.
- Leaderboard rows for traders who never set a username come back with
  `username: null` and no address, so they are shown ranked but not clickable.
- Outcome's portfolio endpoint returns **30-day** figures, not lifetime ones —
  `pnlHistory` is 30 daily samples rebased to 0, and `vlm` matches. Verified
  against the leaderboard: `zk_nft9293` reports 30d PnL $0 / `vlm` $75 against
  all-time PnL $15.5k / volume $2.85M. They are labelled "30d" for that reason;
  calling either "lifetime" would show $0 for a trader who has made a fortune.
- `pnlHistory` is sampled at 00:00 UTC and can be up to 24h stale, so it never
  backs a rolling window. Windowed PnL is summed from real position closes,
  which is why the header and the stat row can differ by a few dollars.
- Open positions are listed but cannot produce a card — there is no final price.
