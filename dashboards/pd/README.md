# PD Launch · Live Campaign Tracker

Served at https://outcome.labs.tg/dashboards/pd/ (`/pd` redirects here).

Live view of the Permissionless Deployment (HIP-4) launch campaign. Read-only:
the Google Sheet is the system of record and this page never writes to it.

## Layout

| File | Role |
|---|---|
| `index.html` | The whole page. Self-contained, hand-rolled SVG charts, no chart library. |
| `../../api/pd.js` | The one deployed function. Dispatches to the four handlers in `api/_pd/`. |
| `pd.js` | Pure derivation logic, no I/O. Loaded by the browser **and** by `api/pd/*`. |
| `pd.test.js` | Unit tests. `node dashboards/pd/pd.test.js` — no dependencies, exits non-zero on failure. |

`pd.js` is loaded both ways on purpose, the same way `leaderboard/derive.js` is:
the hero cards, the charts and the API responses must derive identical numbers.
Do not reference `process`, `fetch`, `window` or `document` in it.

## Data sources

| Source | Route | Refresh |
|---|---|---|
| Builder volume, daily | `/api/pd/volume` | 60 s client poll, `s-maxage=60` |
| Builder volume, hourly | `/api/pd/hourly?builder=outcome\|hl` | 60 s |
| Campaign Tracker sheets | `/api/pd/sheet?tab=…` | 5 min client poll, `s-maxage=60` |
| X post embeds | `/api/pd/oembed?url=…` | cached 24 h at the CDN |

Everything is proxied because none of these upstreams can be called from a
browser: `stats.outcome.xyz` sends no CORS headers, and neither does
`publish.twitter.com`.

**All four routes are one serverless function.** Vercel counts every
non-underscore file under `api/` against the plan's function limit, and the
site is at it. So the handlers live in `api/_pd/` — underscore, therefore not
deployed individually — and `api/pd.js` dispatches to them. A rewrite maps
`/api/pd/:route` to `/api/pd?_r=:route`, so the URLs above are unchanged; the
dispatcher also falls back to reading the route off the path if the rewrite is
ever bypassed. Adding a fifth PD route means adding a key to `ROUTES`, not a
file to `api/`.

### The sheets

Two documents, both read through the plain CSV export endpoint
(`/export?format=csv&gid=…`) while they are link-readable:

- **PD tracker** `1WnBeQxu_bVQA5tdOvRQBK6-pNv0mIJvwbOaDhLJ1Qqw` — everything live.
- **World Cup tracker** `1D8UPwj3pF6m4hNSEisXp9LvEu7u4lf5HpWB3UPnGd-U` — the
  `wcdaily` tab only, supplying the campaign-pacing baseline. It carries the
  same Daily Totals headers, so `COLS.daily` reads both. 41 days, 10 Jun–20 Jul.
  Its first four days of volume sum to $848,400, matching the figure the
  scorecard quotes.

`TAB_SOURCES` in `pd.js` maps each tab key to its document and gid.

**Not gviz.** `gviz/tq?tqx=out:csv` infers a header row, which merges a banner
row into the header line and blanks cells whose type it disagrees with —
Channel Summary loses its `Posts` column that way. The export endpoint returns
the grid exactly as the sheet shows it.

Only six tabs are reachable, by key rather than by name, so this route can
never be used to read `Budget Tracker` or `Cost Projections` in either
document: `daily`, `hourly`, `content`, `channels`, `comparison`, `wcdaily`.

Note that link-readability applies to the **whole** document: anyone with either
spreadsheet URL can export any tab, including the cost ones. Tightening that
means either moving the cost tabs to a separate file or switching this route to
a service account and revoking link access.

### Column contract

Sheet headers are the contract and live in exactly one place: `COLS` in
`pd.js`. Header rows are *detected* by scoring candidate rows against that map
rather than assumed at a fixed index, because Daily Totals puts its header on
row 1 and Channel Summary carries a banner above it. Unknown columns are
ignored, so adding a column to the sheet cannot break the page.

Two date formats are in play and both are handled: `dd/mm/yyyy` in Daily
Totals, `yyyy-mm-dd` in Content Log and Hourly Snapshots.

**Blank is not zero.** `Impressions` and `Outcome Traders (API)` are empty on
backfill rows, so `rowsToObjects` records which fields were blank and
`pacingSeries` skips those hours instead of plotting a drop to zero. Today's
impressions curve can therefore be a single point until a full run lands; the
chart says so rather than showing a lone dot.

## Campaign pacing vs World Cup

Cumulative totals indexed by **campaign day**, so PD day 1 (28 Aug) is compared
against World Cup day 1 (10 Jun) rather than against a calendar date. Six
metrics: volume, impressions, UVs, signups, depositors, active traders.

## Market share

Always **Outcome ÷ total HIP-4 volume**, summed across every builder. Never
`Outcome / (Outcome + HL)` — other builders are real volume and excluding them
overstates the share. There is a regression test pinning this.

## Content timeline

Only the selected day is mounted. Within a day, embeds mount lazily through an
`IntersectionObserver`; each post renders a native card first and the X embed is
layered on top only once it arrives. A deleted post, a 4 s timeout or a blocked
`widgets.js` therefore leaves a complete native card rather than a blank hole.

## Local development

There is no build step. For the API routes, either `vercel dev`, or serve the
directory with any static server and proxy `/api/pd/*` to the handlers — each
one is a plain `(req, res)` function with `req.query`.
