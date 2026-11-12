#!/usr/bin/env python3
"""Regenerates dashboards/v3/index.html from dashboards/pd/index.html.

The two pages are the same file. Only the campaign attribute on <html>, the
<head> meta and the pre-render placeholder text differ; everything else that
varies by campaign lives in CAMPAIGNS in dashboards/pd/pd.js.

Edit dashboards/pd/index.html, then run:  python3 dashboards/sync-v3.py
"""
import io
import os

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, 'pd', 'index.html')
dst = os.path.join(here, 'v3', 'index.html')

PD_DESC = ('Live tracker for the Permissionless Deployment launch: real-time HIP-4 '
           'market share, volume pacing, funnel and content performance.')
V3_DESC = ('Live tracker for the V3 launch: real-time HIP-4 market share, volume '
           'pacing, funnel and content performance.')

# (find, replace, expected occurrences). A count that is off means the PD page
# changed shape and this list needs a look, so it fails loudly.
PAIRS = [
    ('<html lang="en" data-campaign="pd">', '<html lang="en" data-campaign="v3">', 1),
    ('Permissionless Deployment Live | Outcome', 'V3 Launch Live | Outcome', 3),
    (PD_DESC, V3_DESC, 3),
    ('https://outcome.labs.tg/dashboards/pd/"', 'https://outcome.labs.tg/dashboards/v3/"', 1),
    ('id="navSubtitle">PERMISSIONLESS DEPLOYMENT</span>', 'id="navSubtitle">V3 LAUNCH</span>', 1),
    ('id="titleH1">PERMISSIONLESS<br>DEPLOYMENT <span', 'id="titleH1">V3<br>LAUNCH <span', 1),
    ('id="poolBadge">$1M REWARDS POOL</div>', 'id="poolBadge">FROM 12 NOV · 09:00 ET</div>', 1),
    ('id="scoreToggleLabel">WORLD CUP vs PD</span>', 'id="scoreToggleLabel">WORLD CUP vs PD vs V3</span>', 1),
]

html = io.open(src, encoding='utf-8').read()
for find, replace, count in PAIRS:
    found = html.count(find)
    if found != count:
        raise SystemExit('expected %d of %r, found %d' % (count, find[:60], found))
    html = html.replace(find, replace)

os.makedirs(os.path.dirname(dst), exist_ok=True)
io.open(dst, 'w', encoding='utf-8').write(html)
print('wrote', os.path.relpath(dst, os.path.dirname(here)))
