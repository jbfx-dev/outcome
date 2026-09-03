// Pure derivation logic for Outcome positions and market titles. No I/O.
//
// This file is loaded BOTH ways and must stay environment-agnostic:
//   - Node, by api/_lib/outcome.js, for the proxied path
//   - the browser, by leaderboard/index.html, for the direct-to-upstream path
//     used when Cloudflare blocks our datacenter egress
//
// Keeping it in one file is the point: the two paths must derive identical
// numbers, or a card would disagree with the table that produced it. Do not
// reference `process`, `fetch`, `window` or `document` here.

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OutcomeDerive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------- coin <-> market ----
  // Hyperliquid coins for Outcome markets are "#<outcome_id><side>", where the
  // trailing digit is the side (0 = first side / YES, 1 = second / NO). Fills also
  // contain ordinary Hyperliquid perps and spot ("xyz:META", "FOGO", "@188");
  // those are not prediction markets and are filtered out everywhere.

  const MARKET_COIN = /^#(\d+)$/;

  function parseCoin(coin) {
    const m = MARKET_COIN.exec(coin || '');
    if (!m) return null;
    const n = m[1];
    if (n.length < 2) return null;
    return { outcomeId: parseInt(n.slice(0, -1), 10), side: parseInt(n.slice(-1), 10) };
  }

  // -------------------------------------------------------- title formatting --
  // Market names come back as template ids with a pipe-delimited description.
  // markets/lookup also pre-parses some fields onto the outcome/question objects;
  // where it does we prefer those over re-parsing the description string.

  function kv(description) {
    const out = {};
    for (const part of String(description || '').split('|')) {
      const i = part.indexOf(':');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "20260901-2100" -> "1 Sep 2026, 21:00 UTC"
  function stamp(s, { withTime = true } = {}) {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const [, y, mo, d, hh, mm] = m;
    const date = `${parseInt(d, 10)} ${MONTHS[parseInt(mo, 10) - 1] || mo} ${y}`;
    return withTime ? `${date}, ${hh}:${mm} UTC` : date;
  }

  // "xyz:SP500" / "BTC-USDC mark" -> "SP500" / "BTC"
  function ticker(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/^perp:/i, '').replace(/^xyz:/i, '');
    s = s.split(/[-\s]/)[0];
    return s.toUpperCase();
  }

  // Group the integer part but keep the threshold's own precision: a market on
  // "7719.4" must not be titled "7,719", and one on "66.646" must keep 3 places.
  function num(v) {
    const raw = String(v).replace(/,/g, '').trim();
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(v);
    const decimals = Math.min((raw.split('.')[1] || '').replace(/0+$/, '').length, 6);
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  const PERIOD = { '1d': 'Daily', '1w': 'Weekly', '1h': 'Hourly', '1m': 'Monthly' };

  // Sides are UP/DOWN on the recurring price markets (matching Outcome's own UI
  // and the card artwork), YES/NO on the one-off threshold and touch markets, and
  // the explicit outcome name on multi-outcome questions.
  function sideLabel(entry, side) {
    const o = (entry && entry.outcome) || {};
    const spec = (o.sideSpecs || [])[side];
    const raw = spec && spec.name;
    const cls = o.class || (entry && entry.question && entry.question.class);

    if (cls === 'priceBinary') return side === 0 ? 'UP' : 'DOWN';
    if (cls === 'priceBucket') return side === 0 ? 'YES' : 'NO';

    // "SPAIN" / "ARGENTINA NO" reads far better than "YES" / "NO" sitting under
    // a title of "2026 World Cup Champion".
    if (isNamedOutcome(entry)) {
      const label = String(o.name).toUpperCase();
      return side === 0 ? label : label + ' NO';
    }

    if (raw && !/^template:/.test(raw)) return String(raw).toUpperCase();
    if (raw === 'template:Yes') return 'YES';
    if (raw === 'template:No') return 'NO';
    return side === 0 ? 'YES' : 'NO';
  }

  // A multi-outcome question ("2026 World Cup Champion") has one outcome per
  // option, each named for the option ("Spain") with sideSpecs Yes/No. Titling
  // such a position "Spain" loses the question entirely, so the question's name
  // becomes the title and the option becomes the side label.
  function isNamedOutcome(entry) {
    const q = (entry && entry.question) || {};
    const o = (entry && entry.outcome) || {};
    if (!q.name || !o.name || o.name === q.name) return false;
    const sides = (o.sideSpecs || []).map(function (x) {
      return String((x && x.name) || '').toLowerCase();
    });
    return sides.length === 2 && sides[0] === 'yes' && sides[1] === 'no';
  }

  // The World Cup cards are a separate design, so these need identifying rather
  // than merely formatting. Scoped to football so an unrelated market that
  // happens to mention the phrase cannot pull in the trophy artwork.
  function isWorldCup(entry) {
    if (!entry || !entry.outcome) return false;
    const o = entry.outcome;
    const q = entry.question || {};
    const cat = String(o.category || q.category || '').toLowerCase();
    const sub = String(o.subCategory || q.subCategory || '').toLowerCase();
    if (cat && cat !== 'sports') return false;
    if (sub && sub !== 'football') return false;
    return /world cup/i.test(String(q.name || '') + ' ' + String(o.name || ''));
  }

  function marketTitle(entry) {
    if (!entry || !entry.outcome) return null;
    const o = entry.outcome;
    const q = entry.question || {};
    if (isNamedOutcome(entry)) return q.name;
    const d = kv(o.description);
    const qd = kv(q.description);
    const name = o.name || '';
    const cls = o.class || q.class;

    // One-off threshold market: "SP500 above 7,719.4 on 29 Aug 2026, 20:00 UTC"
    if (name === 'template:binaryPrice') {
      const sym = ticker(d.perp || d.priceDescription);
      const when = stamp(d.time);
      const thr = d.threshold != null ? num(d.threshold) : null;
      if (sym && thr) return `${sym} above ${thr}${when ? ` on ${when}` : ''}`;
    }

    // Touch market: "BTC touches 95,000 by 1 Oct 2026, 00:00 UTC"
    if (name === 'template:priceTouch') {
      const sym = ticker(d.perp || d.priceDescription);
      const when = stamp(d.time);
      const tgt = d.target != null ? num(d.target) : null;
      if (sym && tgt) return `${sym} touches ${tgt}${when ? ` by ${when}` : ''}`;
    }

    // Recurring up/down: "Bitcoin Up or Down Daily"
    if (cls === 'priceBinary') {
      const sym = ticker(o.underlying || d.underlying);
      const per = PERIOD[o.period || d.period] || '';
      if (sym) return `${sym} Up or Down${per ? ` ${per}` : ''}`;
    }

    // Recurring price buckets: one outcome per band, plus a "fallback" band for
    // "none of the above". outcome.targetPrice carries this outcome's own band
    // ("<77498"), while question.priceThresholds lists every boundary.
    if (cls === 'priceBucket') {
      const sym = ticker(o.underlying || d.underlying);
      const per = PERIOD[o.period || d.period] || '';
      const band = bucketLabel(o.targetPrice, q.priceThresholds || qd.priceThresholds, name);
      if (sym && band) return `${sym} ${band}${per ? ` ${per}` : ''}`;
      if (sym) return `${sym} price range${per ? ` ${per}` : ''}`;
    }

    // Multi-outcome question (e.g. a central-bank rate decision).
    if (/^template:policyRate/.test(q.name || '')) {
      const label = qd.decisionLabel || '';
      const inst = shortInstitution(qd.institution);
      const move =
        { policyRateNoChange: 'no change', policyRateDecrease: 'a decrease', policyRateIncrease: 'an increase' }[
          name.replace(/^template:/, '')
        ] || null;
      if (inst && move) return `${inst} ${label ? `${label} ` : ''}decision: ${move}`;
      if (inst) return `${inst} ${label ? `${label} ` : ''}rate decision`;
    }

    // Anything else: prefer a human-looking name over a template id.
    if (name && !/^template/.test(name) && !/^Recurring/.test(name)) return name;
    if (q.name && !/^template/.test(q.name) && !/^Recurring/.test(q.name)) return q.name;
    return null;
  }

  function bucketLabel(targetPrice, thresholds, name) {
    const t = String(targetPrice == null ? '' : targetPrice).trim();
    if (!t) return null;
    // Fallback outcome carries the whole threshold list rather than one band.
    if (/Fallback/i.test(name || '') || /,/.test(t)) {
      const parts = String(thresholds || t)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length >= 2) return `between ${num(parts[0])} and ${num(parts[parts.length - 1])}`;
      return 'in range';
    }
    if (t.startsWith('<')) return `below ${num(t.slice(1))}`;
    if (t.startsWith('>')) return `above ${num(t.slice(1))}`;
    return `at ${num(t)}`;
  }

  function shortInstitution(s) {
    const v = String(s || '');
    if (/Federal Reserve/i.test(v)) return 'Fed';
    if (/European Central Bank|ECB/i.test(v)) return 'ECB';
    if (/Bank of England/i.test(v)) return 'BoE';
    if (/Bank of Japan/i.test(v)) return 'BoJ';
    return v.split(/[',]/)[0].trim() || null;
  }

  // The renderer ships three themes; pick from the market's underlying asset.
  function themeFor(entry) {
    const o = (entry && entry.outcome) || {};
    const d = kv(o.description);
    const sym = ticker(o.underlying || d.underlying || d.perp || d.priceDescription);
    if (sym === 'BTC' || sym === 'BITCOIN' || sym === 'XBT') return 'btc';
    if (sym === 'HYPE') return 'hype';
    return 'default';
  }

  // ------------------------------------------------------------- positions ----
  // A position is one coin's full lifecycle: opened from flat, closed back to flat
  // (or settled at resolution). Re-entering the same market after fully closing
  // produces a separate position.
  //
  // Hyperliquid returns fills newest-first, and fills sharing a timestamp are NOT
  // ordered by time - within one order's partial fills only array order is
  // correct. So chronological order is the reversed array, never a sort by .time.

  const BUY = new Set(['Buy']);
  const CLOSE = new Set(['Sell', 'Settlement', 'Merge Outcome']);

  function buildPositions(fills) {
    const chronological = [...fills].reverse();
    const open = new Map(); // coin -> position being accumulated
    const done = [];

    for (const f of chronological) {
      const parsed = parseCoin(f.coin);
      if (!parsed) continue; // ordinary HL perp/spot, not an Outcome market

      const px = Number(f.px);
      const sz = Number(f.sz);
      const pnl = Number(f.closedPnl) || 0;
      const fee = Number(f.fee) || 0;
      if (!Number.isFinite(px) || !Number.isFinite(sz) || sz <= 0) continue;

      const isBuy = BUY.has(f.dir);
      const isClose = CLOSE.has(f.dir);
      if (!isBuy && !isClose) continue;

      let p = open.get(f.coin);
      // A buy from flat starts a new position.
      if (isBuy && !p) {
        p = newPosition(f, parsed);
        open.set(f.coin, p);
      }
      if (!p) continue; // a close with no tracked open (history predates our window)

      p.lastTime = f.time;
      p.fees += fee;

      if (isBuy) {
        p.shares += sz;
        p.bought += px * sz;
        p.qty += sz;
        p.buyFills++;
      } else {
        p.proceeds += px * sz;
        p.realized += pnl;
        p.qty -= sz;
        p.exitPx = px;
        if (f.dir === 'Settlement') p.settled = true;
        if (f.dir === 'Merge Outcome') p.merged = true;
        if (p.qty <= 1e-9) {
          p.closedAt = f.time;
          done.push(p);
          open.delete(f.coin);
        }
      }
    }

    for (const p of open.values()) done.push(p); // still-open positions
    return done;
  }

  function newPosition(f, parsed) {
    return {
      coin: f.coin,
      outcomeId: parsed.outcomeId,
      side: parsed.side,
      openedAt: f.time,
      lastTime: f.time,
      closedAt: null,
      shares: 0,
      bought: 0,
      proceeds: 0,
      realized: 0,
      fees: 0,
      qty: 0,
      buyFills: 0,
      exitPx: null,
      settled: false,
      merged: false,
    };
  }

  // Turn a raw position into the shape the UI and the renderer both consume.
  function decorate(p, entry) {
    const title = marketTitle(entry);
    const resolved = p.closedAt != null;
    const avgEntry = p.shares > 0 ? p.bought / p.shares : 0;
    const exit = resolved ? (p.shares > 0 ? p.proceeds / p.shares : 0) : null;
    const win = p.realized > 0;

    return {
      coin: p.coin,
      outcomeId: p.outcomeId,
      side: p.side,
      sideLabel: sideLabel(entry, p.side),
      title: title || 'Unknown market',
      known: Boolean(entry && title),
      theme: themeFor(entry),
    // The World Cup renderer has no loss variant - its panel reads "To Win" -
    // so a losing position would be dressed as a win. Wins only; losses fall
    // through to the standard card, which has a proper loss treatment.
    cardStyle: isWorldCup(entry) && win ? 'wc' : 'default',
    wcPosition: isWorldCup(entry) ? worldCupPosition(entry, p.side) : null,
      resolved,
      settled: p.settled,
      merged: p.merged,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      shares: round(p.shares, 2),
      avgEntry: round(avgEntry, 4),
      exitPrice: exit == null ? null : round(exit, 4),
      bought: round(p.bought, 2),
      earned: round(p.proceeds, 2),
      fees: round(p.fees, 4),
      pnl: round(p.realized, 2),
      pnlPct: p.bought > 0 ? round((p.realized / p.bought) * 100, 2) : 0,
      outcome: win ? 'win' : 'loss',
      // Only a closed position has a final price to put on a card.
      cardReady: Boolean(resolved && entry && title),
    };
  }

  const round = (n, dp) => {
    const f = Math.pow(10, dp);
    return Math.round((Number(n) || 0) * f) / f;
  };

  // ------------------------------------------------------------ formatting ----
  // The renderer takes pre-formatted strings, so the same helpers back both the
  // positions API and the card endpoint - a card always reads like its table row.

  const usd = (n, dp = 2) =>
    '$' +
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

  // Cards drop cents at four figures and up, matching the approved reference
  // cards ("$514,526", "$10,900", "$1,000"). Cents on a half-million-dollar
  // figure are noise on a social graphic; smaller trades keep them, where the
  // pennies are a real part of the number. The tables show exact values either
  // way - this is a display rule for the card only.
  const money = (n) => usd(n, Math.abs(Number(n) || 0) >= 1000 ? 0 : 2);

  function cardFields(pos, username) {
    return {
      theme: pos.theme,
      outcome: pos.outcome,
      position: pos.sideLabel,
      title: pos.title,
      price_from: usd(pos.avgEntry, 2),
      price_to: usd(pos.exitPrice == null ? 0 : pos.exitPrice, 2),
      shares: Number(pos.shares).toLocaleString('en-US', { maximumFractionDigits: 0 }),
      avg_price: `${(pos.avgEntry * 100).toFixed(2)}¢`,
      bought: money(pos.bought),
      earned: money(pos.earned),
      username: (username || '').toUpperCase(),
    };
  }

  const WINDOWS = { '24h': 24, '168h': 168, '720h': 720, all: null };

  function windowStart(win) {
    const hours = WINDOWS[win];
    if (hours == null) return null;
    return Date.now() - hours * 3600 * 1000;
  }

  // ---------------------------------------------------------------- helpers --

  // Leaderboard avatars are either an X profile image URL or a numeric string
  // naming one of Outcome's built-in avatars, which we cannot resolve.
  function avatarUrl(avatar, { hi = true } = {}) {
    const s = String(avatar || '').trim();
    if (!/^https?:\/\//.test(s)) return null;
    return hi ? s.replace('_normal.', '_400x400.') : s;
  }

  const USERNAME = /^[A-Za-z0-9_.-]{1,40}$/;

  function parseProfileUrl(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (USERNAME.test(s)) return s;
    let u;
    try {
      u = new URL(s.startsWith('http') ? s : `https://${s}`);
    } catch {
      return null;
    }
    if (!/(^|\.)outcome\.xyz$/i.test(u.hostname)) return null;
    const m = /^\/profile\/([^/?#]+)/.exec(u.pathname);
    if (!m) return null;
    const name = decodeURIComponent(m[1]);
    return USERNAME.test(name) ? name : null;
  }

  // ----------------------------------------------------------- top trades --
  // There is no upstream endpoint for "biggest trades" - only biggest traders -
  // so a leaderboard of trades is assembled by rebuilding the histories of the
  // top-ranked traders and ranking their individual positions.
  //
  // That makes it an approximation, and the UI says so: a trader whose huge win
  // was cancelled out by losses ranks low overall, so their standout trade can
  // fall outside the scanned set. Scanning deeper narrows the gap at a linear
  // cost in upstream calls.

  function inWindow(position, win, now) {
    var hours = WINDOWS[win];
    if (hours == null) return true;
    var at = position.closedAt || position.openedAt;
    return at >= (now || Date.now()) - hours * 3600000;
  }

  // entries: [{ username, address, avatar, verified, positions: [decorated] }]
  function rankTrades(entries, win, limit) {
    var now = Date.now();
    var out = [];
    (entries || []).forEach(function (t) {
      (t.positions || []).forEach(function (p) {
        if (!p.resolved) return;              // no final price, no card
        if (!inWindow(p, win, now)) return;
        out.push({
          username: t.username,
          address: t.address,
          avatar: t.avatar || null,
          verified: Boolean(t.verified),
          position: p,
          pnl: p.pnl,
        });
      });
    });
    out.sort(function (a, b) { return b.pnl - a.pnl; });
    return limit ? out.slice(0, limit) : out;
  }

  // Pill text for the World Cup card, following the approved reference cards:
  // "SPAIN TO WIN" for the Yes side, "ARGENTINA NO" for the No side, and a bare
  // "DRAW" where the option is the draw rather than a team.
  function worldCupPosition(entry, side) {
    const o = (entry && entry.outcome) || {};
    const name = String(o.name || '').trim();
    if (!name) return side === 0 ? 'YES' : 'NO';
    const upper = name.toUpperCase();
    if (/^draw$/i.test(name)) return side === 0 ? 'DRAW' : 'DRAW NO';
    return side === 0 ? upper + ' TO WIN' : upper + ' NO';
  }

  return {
    isWorldCup: isWorldCup,
    isNamedOutcome: isNamedOutcome,
    worldCupPosition: worldCupPosition,
    inWindow: inWindow,
    rankTrades: rankTrades,
    parseCoin: parseCoin,
    marketTitle: marketTitle,
    sideLabel: sideLabel,
    themeFor: themeFor,
    buildPositions: buildPositions,
    decorate: decorate,
    cardFields: cardFields,
    windowStart: windowStart,
    WINDOWS: WINDOWS,
    avatarUrl: avatarUrl,
    parseProfileUrl: parseProfileUrl,
    usd: usd,
    money: money,
    round: round,
  };
});
