// GET /api/pd/oembed?url=https://x.com/<handle>/status/<id>
//
// Returns X's oEmbed HTML for one post. Proxied because publish.twitter.com
// sends no CORS headers and rate-limits by IP.
//
// The url parameter is parsed and REBUILT from its handle and status id before
// it is used, so this cannot be pointed at any other host - it is a post-embed
// endpoint, not a general fetcher.
//
// Embeds do not change once published, so a hit is cached hard: a day at the
// CDN, an hour in the instance.

const L = require('../_lib/pd.js');
const D = L.D;

module.exports = async (req, res) => {
  try {
    const raw = (req.query && req.query.url) || '';
    const post = D.parsePostUrl(raw);
    if (!post) throw new L.UpstreamError('bad_post_url', 400);

    const url =
      'https://publish.twitter.com/oembed?url=' + encodeURIComponent(post.url) +
      '&omit_script=true&theme=dark&dnt=true&maxwidth=400&hide_thread=true';

    // A deleted or protected post 404s upstream. That is a normal outcome, not
    // a failure: the page keeps its native card and must not see an error.
    let data = null;
    try {
      data = await L.cached('oe:' + post.id, 3600000, () => L.fetchJSON(url, { timeout: 4000 }));
    } catch (err) {
      return L.send(
        res, 200,
        { ok: true, id: post.id, url: post.url, html: null, unavailable: true },
        's-maxage=3600, stale-while-revalidate=86400'
      );
    }

    L.send(
      res, 200,
      {
        ok: true,
        id: post.id,
        url: post.url,
        html: data.html || null,
        authorName: data.author_name || null,
        authorUrl: data.author_url || null,
      },
      's-maxage=86400, stale-while-revalidate=604800'
    );
  } catch (err) {
    L.fail(res, err);
  }
};
