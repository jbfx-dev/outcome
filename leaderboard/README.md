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

### Two paths, because Cloudflare blocks our egress

Outcome's API sits behind Cloudflare, which serves its "Attention Required!"
block page (403) to Vercel's AWS egress. This is an ASN reputation decision, not
a request-shape problem: from a residential IP the same call returns 200 with
*any* header set (verified across eight permutations — UA, Origin, Referer,
`Sec-Fetch-*`), and from Vercel it returns 403 with all of them. Hyperliquid is
unaffected and reachable from both.

Both upstreams do send `access-control-allow-origin: *`, so the browser is
allowed to call them directly. The page therefore tries the proxy first and
falls back to a direct call only when the proxy reports it was blocked,
remembering that per session with a 5-minute re-probe.

**This is self-healing by design.** When the WAF rule is added, the proxy stops
returning `upstream_403`, an open tab re-probes within five minutes, and every
call reverts to the server-side path with its caching and shared rate-limit
budget — no deploy, no code change. Nothing needs to be undone.

The derivation logic that both paths share lives in `leaderboard/derive.js`,
loaded by Node *and* the browser. Keeping it in one file is the point: if the
two paths derived differently, a card could disagree with the table row that
opened it. Verified identical — `drogo` rebuilds to $7,847 realised, 31
positions, 25W/6L, 80.6% win rate on both.

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

### Top trades is derived, not fetched

Outcome ranks *traders*, not trades — there is no upstream endpoint for "biggest
trades" (probed: `/trades`, `/activity`, `/positions`, `/fills`, `/top-trades`,
`/recent-trades`, `/feed`, all 404). So the trade board takes the window's
top-ranked traders, rebuilds each one's positions, and ranks the positions.

That makes it an approximation, and the UI says so rather than implying
completeness: a trader whose standout win was cancelled out by losses ranks low
overall, so their big trade can fall outside the scanned set. `scan` trades
coverage against upstream calls and is capped at 40; the response returns
`scanned` so the page can state what it actually looked at.

Cost measured against live data: ~5MB and ~9s for 20 traders at 5x
concurrency. On the proxied path that is one cached server-side pass shared by
every visitor. On the direct path it is real work in each visitor's browser,
which is why results render progressively as each trader lands rather than
after all of them, and why concurrency is held at 4 to stay inside Outcome's
60/min rate limit.

### Market titles

Names arrive as template ids (`template:binaryPrice`, `Recurring`, …) with a
pipe-delimited description. `marketTitle()` formats each kind: threshold markets,
touch markets, recurring up/down dailies, price buckets, and multi-outcome
questions, with a fallback for anything unrecognised. A sweep of the top 12
all-time traders (938 positions) produced 0 unknown markets and 0 unformatted
titles.

## Endpoints

All leaderboard routes are handlers inside a **single** serverless function.
Vercel counts every non-underscore file under `api/` as its own function and the
Hobby plan caps that at 12; seven separate route files pushed the project to 13
and the build failed. They now live in `api/_lb/` (underscore = not deployed
separately) behind `api/lb.js`, the same shape as `api/pd.js`. Project total is
7 of 12.

`vercel.json` rewrites both `/api/lb/:route` and the original flat paths
(`/api/leaderboard`, `/api/positions`, …) onto that function, so every URL that
was ever live still resolves. `api/card.py` calls `/api/lb?_r=…` directly rather
than a flat path: that request originates inside another function, and hitting
the function file needs no rewrite to resolve.

Adding a route means adding a file to `api/_lb/` and a line to `ROUTES` — it
costs no function slots.

| Route | Purpose |
|---|---|
| `GET /api/leaderboard?duration=24h\|168h\|720h\|all&limit=&offset=` | Ranked traders |
| `GET /api/trader?username=` | Profile + 30-day volume/PnL + daily `pnlHistory` |
| `GET /api/positions?username=&window=&include=resolved\|all` | Rebuilt positions + summary |
| `GET /api/resolve?url=` | Pasted profile link or username → username |
| `GET /api/position?address=&coin=` | One position, rebuilt from Hyperliquid alone |
| `GET /api/top-trades?window=&limit=&scan=` | Biggest single trades across traders |
| `GET /api/card?address=\|username=&coin=&…` | Rendered PNG |
| `GET /api/diag` | **Temporary** — probes upstream reachability. Delete once the WAF rule lands. |

### Why the card endpoint re-derives its own numbers

These cards carry Outcome branding, so an endpoint that rendered whatever
amounts a caller passed would be a forgery tool. **Every financial figure is
always rebuilt server-side** from the address's own Hyperliquid fills — shares,
entry, exit, staked, earned, win/loss. There is no query parameter that can
change any of them, in either addressing mode.

`address=` mode exists so this survives the Cloudflare block: Hyperliquid is
reachable from Vercel even when Outcome's API is not, and Hyperliquid is where
the money comes from. Only the market's display title and side label may be
supplied by the caller, and only as a fallback — when Outcome's API is
reachable the server looks them up itself and ignores what was passed. The worst
a forged request achieves is mislabelling which market a real trade was in; it
can never invent the money. Verified: with the API stubbed out, caller-supplied
`title=I MADE A MILLION` is accepted as a label while shares/bought/earned stay
at the true 9,040 / $5,246.32 / $9,040.

Cards for resolved positions are immutable, so they are cached on disk by
`(trader, coin, closedAt, theme)` and served with a long `Cache-Control`.

## Two card designs

| Design | Kit | Output | Used for |
|---|---|---|---|
| Themed | `api/_kit/` | 1780×2188 | Everything, in `default` / `hype` / `btc` × win / loss |
| World Cup | `api/_kit_wc/` | 1929×1941 | Winning World Cup positions |

Both define a module named `render`, so `card.py` loads them by explicit path
rather than `sys.path` — importing one would otherwise shadow the other.

The World Cup design is chosen automatically: `isWorldCup()` matches "world cup"
in the question or outcome name, scoped to `sports`/`football` so an unrelated
market mentioning the phrase cannot pull in the trophy artwork. It is applied to
**wins only** — its panel reads "To Win" and there is no loss variant, so a loss
dressed in it would read as a win.

`theme=wc` is refused on non-World-Cup positions (409 `wc_style_unavailable`).
The design asserts something about the trade; a gold-price position under a FIFA
trophy is a false claim on a branded asset. The UI only offers the option where
it applies.

Its field contract differs from the themed card — `to_win` not `earned`,
`wallet` not `username`, no theme, no avatar — mapped by `wc_card_fields()`.
Pill text follows the approved reference cards in `Share cards/`: "SPAIN TO WIN"
for the Yes side, "ARGENTINA NO" for the No side, bare "DRAW" for a draw option.

### Multi-outcome questions

A question like "2026 World Cup Champion" has one outcome per team, each named
for the team with sideSpecs Yes/No. Titling such a position "Spain" loses the
question, so `isNamedOutcome()` makes the question the title and the option the
side: **"2026 World Cup Champion" / "SPAIN"**, not "Spain" / "YES". This applies
to every multi-outcome market, not just football.

## Renderer

`api/_kit/` is a vendored copy of `outcome-pnl-card-kit` (v2) — `render.py` plus the
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
