// GET /api/resolve?url=https://outcome.xyz/profile/<username>
// Accepts a pasted profile link or a bare username and confirms it exists.

const L = require('./_lib/outcome.js');

module.exports = async (req, res) => {
  try {
    const input = (req.query && (req.query.url || req.query.q)) || '';
    const username = L.parseProfileUrl(input);
    if (!username) {
      return L.send(res, 400, {
        ok: false,
        error: 'bad_input',
        hint: 'Paste an outcome.xyz/profile/<username> link, or just the username.',
      });
    }
    const p = await L.profile(username);
    L.send(
      res,
      200,
      { ok: true, username: p.username || username, address: p.address },
      's-maxage=300, stale-while-revalidate=600'
    );
  } catch (err) {
    if (err instanceof L.UpstreamError && err.status === 404) {
      return L.send(res, 404, { ok: false, error: 'no_such_trader' });
    }
    L.fail(res, err);
  }
};
