"""Render an Outcome PnL share card as a PNG.

GET /api/card?address=0x..&coin=%23123900[&username=][&closedAt=][&theme=][&title=][&side=]
GET /api/card?username=<name>&coin=%23123900[&closedAt=][&theme=]

Every financial figure on the card is re-derived server-side from the trader's
own Hyperliquid fills, never taken from the query string. That is deliberate:
these cards carry Outcome branding, so an endpoint that rendered whatever
amounts a caller passed would be a forgery tool.

Two addressing modes, because Cloudflare currently blocks our egress from
Outcome's API while Hyperliquid stays reachable:

  address= (preferred) -> /api/position, which needs only Hyperliquid for the
      money. Market title and side may be supplied by the caller but are used
      only when Outcome's API is unreachable, and are cosmetic either way.
  username= (original) -> /api/positions, which needs Outcome's API to resolve
      the name. Used when that API is reachable.

Derivation is never reimplemented here; both modes call the Node routes that
back the UI, so a card always agrees with the table that produced it.
"""

import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_kit")
sys.path.insert(0, KIT)

import render as card_renderer  # noqa: E402  (needs KIT on sys.path first)

CACHE = os.path.join(tempfile.gettempdir(), "outcome-cards")
AVATARS = os.path.join(tempfile.gettempdir(), "outcome-avatars")
THEMES = {"default", "hype", "btc"}
COIN_RE = re.compile(r"^#\d+$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class CardError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _self_base(headers):
    """Origin of this deployment, so the function can reach its sibling routes."""
    host = headers.get("x-forwarded-host") or headers.get("host")
    proto = headers.get("x-forwarded-proto") or "https"
    if not host:
        raise CardError("no_host", 500)
    return "%s://%s" % (proto, host)


def _get_json(url, timeout=25):
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def find_by_address(base, params):
    """Rebuild one position from Hyperliquid fills alone (no Outcome API)."""
    # Hit the function file directly rather than /api/position: that flat path
    # is an edge rewrite, and this request originates inside another function.
    # /api/lb?_r=position needs no rewrite to resolve, so it cannot be affected
    # by routing changes.
    url = "%s/api/lb?%s" % (base, urllib.parse.urlencode(dict(params, _r="position")))
    try:
        payload = _get_json(url)
    except urllib.error.HTTPError as e:
        raise CardError("no_such_position" if e.code == 404 else "position_failed", e.code)
    except Exception:
        raise CardError("position_failed", 502)

    if not payload.get("ok"):
        raise CardError(payload.get("error") or "position_failed", 502)
    position = payload.get("position") or {}
    if not position.get("cardReady"):
        raise CardError("position_not_card_ready", 409)
    return payload, position


def find_position(base, username, coin, closed_at):
    """Locate one position in the trader's rebuilt history."""
    url = "%s/api/lb?%s" % (
        base,
        urllib.parse.urlencode({"_r": "positions", "username": username, "window": "all"}),
    )
    try:
        payload = _get_json(url)
    except urllib.error.HTTPError as e:
        raise CardError("no_such_trader" if e.code == 404 else "positions_failed", e.code)
    except Exception:
        raise CardError("positions_failed", 502)

    if not payload.get("ok"):
        raise CardError(payload.get("error") or "positions_failed", 502)

    matches = [p for p in payload.get("positions", []) if p.get("coin") == coin]
    if not matches:
        raise CardError("no_such_position", 404)

    # A trader can hold the same coin more than once; closedAt disambiguates.
    if closed_at:
        exact = [p for p in matches if str(p.get("closedAt")) == str(closed_at)]
        if exact:
            matches = exact
    chosen = max(matches, key=lambda p: p.get("closedAt") or p.get("openedAt") or 0)

    if not chosen.get("cardReady"):
        raise CardError("position_not_card_ready", 409)
    return payload, chosen


def usd(value, decimals=2):
    return "$" + format(round(float(value or 0), decimals), ",.%df" % decimals)


def money(value):
    """Round thousands drop their cents, matching cardFields() in _lib/outcome.js."""
    v = float(value or 0)
    return usd(v, 0 if abs(v) >= 1000 and v.is_integer() else 2)


def card_fields(position, username):
    """Mirror of cardFields() in api/_lib/outcome.js - keep the two in step."""
    bought = float(position.get("bought") or 0)
    entry = float(position.get("avgEntry") or 0)
    exit_px = position.get("exitPrice")
    shares = float(position.get("shares") or 0)
    return {
        "theme": position.get("theme") or "default",
        "outcome": position.get("outcome") or "win",
        "position": position.get("sideLabel") or "YES",
        "title": position.get("title") or "Outcome market",
        "price_from": usd(entry),
        "price_to": usd(0 if exit_px is None else exit_px),
        "shares": format(int(round(shares)), ","),
        "avg_price": "%.2f\u00a2" % (entry * 100),
        "bought": money(bought),
        "earned": money(position.get("earned")),
        "username": (username or "").upper(),
    }


# Avatars are only ever fetched from X's image CDN. The URL can reach us from
# the browser in address mode, so it is a caller-controlled fetch target and
# must be host-allowlisted - otherwise the renderer becomes an SSRF probe into
# anything the function can reach.
AVATAR_HOSTS = {"pbs.twimg.com", "abs.twimg.com"}


def safe_avatar_url(url):
    """Return the URL only if it is an https X-CDN image, else None."""
    raw = str(url or "").strip()
    if not raw.startswith("https://"):
        return None
    try:
        parsed = urllib.parse.urlparse(raw)
    except Exception:
        return None
    if parsed.scheme != "https" or parsed.hostname not in AVATAR_HOSTS:
        return None
    return raw


def fetch_avatar(url):
    """Cache avatars on the instance; a missing one is not fatal to the card."""
    url = safe_avatar_url(url)
    if not url:
        return None
    os.makedirs(AVATARS, exist_ok=True)
    path = os.path.join(AVATARS, hashlib.sha1(url.encode()).hexdigest() + ".img")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=8) as r:
            if r.status != 200:
                return None
            data = r.read(3_000_000)
        with open(path, "wb") as fh:
            fh.write(data)
        return path
    except Exception:
        return None


def slugify(text, limit=48):
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return (s[:limit].rstrip("-")) or "market"


def build(query, headers):
    username = (query.get("username") or [""])[0].strip()
    address = (query.get("address") or [""])[0].strip()
    coin = (query.get("coin") or [""])[0].strip()
    closed_at = (query.get("closedAt") or [""])[0].strip()
    theme_override = (query.get("theme") or [""])[0].strip().lower()

    if not COIN_RE.match(coin):
        raise CardError("bad_coin")
    if theme_override and theme_override not in THEMES:
        raise CardError("bad_theme")
    if username and not USERNAME_RE.match(username):
        raise CardError("bad_username")
    if not address and not username:
        raise CardError("bad_username")
    if address and not ADDRESS_RE.match(address):
        raise CardError("bad_address")

    base = _self_base(headers)

    if address:
        params = {"address": address, "coin": coin}
        if closed_at:
            params["closedAt"] = closed_at
        for key in ("title", "side", "theme"):
            val = (query.get(key) or [""])[0].strip()
            if val:
                params[key] = val
        payload, position = find_by_address(base, params)
        # /api/position speaks only to Hyperliquid, so it has no profile image.
        # The page already holds one from its own (unblocked) profile lookup;
        # accept it, host-allowlisted. Purely decorative - it cannot alter a figure.
        payload = dict(payload)
        payload["avatar"] = safe_avatar_url((query.get("avatar") or [""])[0])
    else:
        payload, position = find_position(base, username, coin, closed_at)

    display = payload.get("username") or username
    data = card_fields(position, display)
    if theme_override:
        data["theme"] = theme_override

    key = "%s-%s-%s-%s-%s" % (
        display.lower(),
        (address or "").lower(),
        coin.lstrip("#"),
        position.get("closedAt") or 0,
        data["theme"] + "|" + data["title"] + "|" + (payload.get("avatar") or ""),
    )
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest() + ".png")

    # A resolved position never changes, so a rendered card is immutable.
    if not (os.path.exists(out) and os.path.getsize(out) > 0):
        avatar = fetch_avatar(payload.get("avatar"))
        if avatar:
            data["avatar_path"] = avatar
        card_renderer.render(data, out)

    with open(out, "rb") as fh:
        png = fh.read()

    filename = "%s-%s-%s-%s.png" % (
        slugify(display),
        slugify(position.get("title")),
        slugify(data["position"], 12),
        data["outcome"],
    )
    return png, filename


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        download = (query.get("download") or [""])[0] in ("1", "true", "yes")
        try:
            png, filename = build(query, self.headers)
        except CardError as e:
            return self._fail(e.status, e.message)
        except Exception as e:  # noqa: BLE001 - never leak a stack trace
            print("card render failed: %r" % (e,), file=sys.stderr)
            return self._fail(500, "render_failed")

        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.send_header(
            "Cache-Control", "public, max-age=86400, s-maxage=604800, immutable"
        )
        disposition = "attachment" if download else "inline"
        self.send_header(
            "Content-Disposition", '%s; filename="%s"' % (disposition, filename)
        )
        self.end_headers()
        self.wfile.write(png)

    def _fail(self, status, message):
        body = json.dumps({"ok": False, "error": message}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep function logs to real errors
        pass
