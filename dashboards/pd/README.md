# PD Launch · Live Campaign Tracker

Served at https://outcome.labs.tg/dashboards/pd/ (`/pd` redirects here).

Live view of the Permissionless Deployment (HIP-4) launch campaign. Read-only:
the Google Sheet is the system of record and this page never writes to it.

## Campaigns: PD and V3 share this code

There are two campaign dashboards and they are the same page:

| Campaign | URL | Tracker sheet | Window (UTC) |
|---|---|---|---|
| V3 (live, the site's home page) | `/dashboards/v3/` (`/` and `/v3` redirect here) | `1rnrK9-AitXJBL5fa_6Hmurn-SUq5PpvbLxuD5NWoLwY` | from 12 Nov 2026 14:00 |
| PD (locked archive) | `/dashboards/pd/` (`/pd`) | `1WnBeQxu_bVQA5tdOvRQBK6-pNv0mIJvwbOaDhLJ1Qqw` | 28 Aug 00:00 to 12 Nov 2026 14:00 |

- `dashboards/v3/index.html` is **generated** from `dashboards/pd/index.html`
  by `python3 dashboards/sync-v3.py`. Edit the PD page, then run the script.
  The two differ only in `data-campaign` on `<html>` and the `<head>` meta.
- Everything else that varies by campaign is in `CAMPAIGNS` in `pd.js`: start
  and end, titles, baselines for the pacing chart, the nav link to the other
  dashboard.
- Every `/api/pd/*` route takes `&c=pd|v3`. No `c` means PD, so every URL that
  existed before V3 behaves as it did.
- The V3 tracker is a copy of the PD tracker, and a copy keeps its gids, so the
  same `TAB_SOURCES` gids address both. `tabSource()` swaps the document.

### The hand-over at 09:00 ET on 12 Nov

PD was locked and V3 started at the same instant, 14:00 UTC on 12 Nov. That UTC
day belongs to both: hours 0-13 to PD, hours 14-23 to V3.

One row carries the split: **Hourly Snapshots (2026-11-12, Hour 14) in the PD
tracker** (`BOUNDARY` in `pd.js`). It is PD's final state and V3's zero point.

- **Volume.** `stats.outcome.xyz` only gives whole UTC days, so
  `/api/pd/volume` reads that row and `clipVolumeDays()` uses it: PD's 12 Nov
  *is* the row, V3's 12 Nov is the whole day minus the row. The two halves add
  back to the day exactly. If the row is missing the day is passed through whole
  and flagged `unclipped`, and the page shows an orange badge saying so.
- **PostHog.** `/api/pd/posthog` clamps the query to the campaign window, so
  V3's first day is cumulative from 14:00 and PD gets nothing after it.
- **Snapshots.** `clipSnapshots()` drops rows outside the window. The row at
  exactly 14:00:00Z stays with PD and is dropped for V3.
- **Volume vs plan.** The $4.62B plan is a company number, so on V3 that card
  loads whole days from 1 Sept with `clip=0` rather than the campaign's volume.
- **Unique counts overlap.** Someone active before and after 14:00 on 12 Nov
  counts once in each campaign. Events (signups, trades, clicks) do not.

A locked campaign pins "today" to its last day (`campaignToday()`), shows
`FINAL` instead of `LIVE`, and never reads as stale.

The scorecard reads the tracker's comparison tab. The V3 tracker's tab has a
third campaign column (World Cup, PD, V3); `comparisonBlocks()` detects it from
the heading. The pacing chart on V3 plots V3 against PD and the World Cup; PD's
daily rows come from the `pddaily` tab key, which always reads the PD tracker.

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
| PostHog metrics | `/api/pd/posthog?days=2` | 60 s client poll, `s-maxage=60` |

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

Only seven tabs are reachable, by key rather than by name, so this route can
never be used to read `Budget Tracker` or `Cost Projections` in any
document: `daily`, `hourly`, `content`, `channels`, `comparison`, `wcdaily`,
`pddaily`.

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

## Live metrics: sheet first, PostHog for the rest

The sheet is only written while the Cowork task runs, which needs a laptop that
is open. The dashboard should not freeze because of that, so the hourly series
is a **merge**:

- A written sheet row wins the hour it recorded. History stays frozen — a
  PostHog `uniq()` for a past hour can drift slightly if a person is identified
  later, and nothing should move under the reader.
- PostHog covers hours the task never wrote, and the **current partial hour**,
  which the sheet cannot have yet. That is why the dashboard runs ahead of the
  spreadsheet; the two reconcile as soon as the hourly task writes that hour.
- Precedence is by timestamp, not by source, with ties going to the sheet.
  Keying on `(date, hour)` alone is not enough — see the hour semantics below.

### These definitions are load-bearing

Each was verified to reproduce the sheet **exactly** before being wired up
(2 Sep h4/h6/h14, 3 Sep h6, 1 Sep full day). Changing one silently
desynchronises the dashboard from the spreadsheet.

| Metric | Definition |
|---|---|
| Clicks | `count($pageview)` where `utm_source` is set — tagged pageviews, not distinct humans |
| Unique Visitors | `uniq(person_id)` on `$pageview` |
| Signups | `count(sign_up)` — **events, not unique people**; `uniq` reads ~7% low |
| Depositors | `uniq(person_id)` on `deposit_completed` |
| Active Traders | `uniq(person_id)` on `trade_placed` |
| Trades Placed | `count(trade_placed)` |

`uniq` is not additive, so the cumulative curve cannot be built by summing
hourly buckets; `uniqState`/`uniqMerge` over an expanding window frame gives the
exact running distinct count in one query. The PostHog project timezone is UTC,
which is why the day boundaries line up with the sheet's without conversion.

Impressions are **not** available here — they are X post impressions from the X
API, and stay laptop-bound. Note PostHog has an unrelated `market_impression`
event; conflating the two would be badly wrong.

### Two different trader counts

`Active Traders` and `Outcome Traders (API, hourly)` measure different things
and will never agree:

| | Active Traders | Outcome Traders (API, hourly) |
|---|---|---|
| Source | PostHog `trade_placed` | stats.outcome.xyz builder API |
| Counts | distinct PostHog persons | distinct wallet addresses on-chain |
| Sees | the web app only | every trade carrying the builder code, including API and bots |
| Shape | cumulative for the day | **that hour alone** |

The chain figure runs ~2.6–3.6x higher, mostly because API/bot flow never
touches the frontend and because ad blockers suppress PostHog. The PostHog one
is the attributable number, which is why the funnel uses it.

The API column is hourly, not cumulative, because per-hour distinct counts
cannot be summed into a running unique — doing so overstates by 1.5x–4.5x
depending on the day. A true cumulative would need per-hour user sets, which
the API does not expose.

### Hour semantics — the sharp edge

The sheet files two different instants under the same `Hour (UTC) = H`:

- a **boundary** row at `H:00:00Z`, meaning state at H:00 (buckets 0…H-1), and
- a **live** row at `H:mm:ssZ` from a Cowork run mid-hour, meaning state at H:mm.

The route reproduces both: a completed ClickHouse bucket H becomes `Hour H+1`
stamped `H+1:00:00Z`, while the in-flight bucket becomes `Hour H` stamped with
the current time. Getting this off by one shifts every metric by an hour and
looks entirely plausible.

Live rows are also not permanent: the task later normalises a `07:08:12Z` row
into a clean `07:00:00Z` one. The timestamp-precedence rule absorbs that.

### Configuration

`POSTHOG_API_KEY` is required for this route; without it the route reports
`configured: false` and returns no rows, and the dashboard runs sheet-only
exactly as it did before. `POSTHOG_PROJECT_ID` (default `407955`) and
`POSTHOG_HOST` (default `https://us.posthog.com`) override the rest.

## Volume vs the $4.62B plan

Monthly targets (Sep–Feb: 73 / 205 / 475 / 828 / 1300 / 1740, $M) are spread
across days as a compounding ramp by `goalCurve()`.

Month-on-month growth in the plan decelerates from 2.81x to 1.34x, so **one
global daily rate cannot hit all six months**. Forcing exact monthly sums plus a
continuous daily rate is worse: it yields a saw-tooth alternating between
negative and positive growth, which is not a plan anyone would set.

So each month gets its own rate, derived from where its daily average sits
relative to the next month's, then scaled to hit that month's target exactly.
The curve rises **every single day** (+3.4%/day in Sep easing to +1.4% by Feb),
hits all six targets and totals $4.621B on the nose. Month boundaries carry a
small step, which the cumulative line the dashboard plots absorbs.

The card shows cumulative actual against cumulative goal, because "are we
tracking" is a cumulative question. Alongside it: position vs plan, the current
month's target and what remains, the per-day rate needed to finish the month,
and a **7-day rolling actual-vs-plan**.

### Why the trend measure is a 7-day window

Volume fell 40% from Tue–Thu to Fri–Sat in the first week of September, and
total HIP-4 fell 45% — the whole venue, not just Outcome, whose share rose to a
campaign-high 79% on that Friday.

That was **not** weekly seasonality: there were no weekend sports markets to
trade until match markets launched on 6 Sept. It was missing supply, and the
supply has changed, so nothing here assumes weekends are quiet. On the World Cup
campaign — which did have weekend fixtures — Saturday was the *strongest* day at
+51% against the campaign mean and Monday the weakest at −60%.

A short day-on-day growth rate therefore measures which days had markets, not
the trend: it read −26%/day across that first weekend. The card instead uses a
7-day rolling window, which spans every weekday exactly once, plus a
week-over-week figure on the matching weekday. Both are still distorted while
the campaign is inside its launch ramp, and the week-over-week figure will jump
structurally the first weekend that has matches against one that did not.

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
