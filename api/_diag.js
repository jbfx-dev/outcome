// TEMPORARY diagnostic - probes which request shape Outcome's API accepts from
// Vercel's egress IPs. Delete once the upstream client is fixed.
// Underscore prefix keeps it off the public routes; invoked via api/diag.js.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VARIANTS = {
  bare: {},
  ua: { 'User-Agent': UA },
  ua_origin: { 'User-Agent': UA, Origin: 'https://outcome.xyz', Referer: 'https://outcome.xyz/' },
  ua_origin_sec: {
    'User-Agent': UA,
    Origin: 'https://outcome.xyz',
    Referer: 'https://outcome.xyz/',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
  },
};

module.exports = async (req, res) => {
  const body = { duration: '24h', filter_by: 'pnl', order_by: 'desc', offset: 0, limit: 1 };
  const out = {};

  for (const [name, extra] of Object.entries(VARIANTS)) {
    try {
      const r = await fetch('https://o1.outcome.xyz/api/v1/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extra },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      out[name] = {
        status: r.status,
        server: r.headers.get('server'),
        cfRay: r.headers.get('cf-ray'),
        cfMitigated: r.headers.get('cf-mitigated'),
        snippet: text.slice(0, 180),
      };
    } catch (e) {
      out[name] = { error: String(e && e.message) };
    }
  }

  // Is Hyperliquid reachable from here at all?
  try {
    const r = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    });
    out.hyperliquid = { status: r.status, len: (await r.text()).length };
  } catch (e) {
    out.hyperliquid = { error: String(e && e.message) };
  }

  try {
    const ip = await (await fetch('https://api.ipify.org?format=json')).json();
    out.egressIp = ip.ip;
  } catch { out.egressIp = 'unknown'; }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
};
