#!/usr/bin/env python3
"""P&L share-card renderer (Outcome style).

Usage:
    python3 render.py data.json [out.png]
    python3 render.py '{"position":"DRAW", ...}' [out.png]

Data keys (all strings):
    position, title, price_from, price_to,
    shares, avg_price, bought, to_win, wallet
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
S = 3  # supersample scale vs. 643x647 design grid

# palette
OLIVE   = (63, 68, 4)
LIME    = (225, 255, 1)
ROWLIME = (208, 236, 1)
GRAYTXT = (166, 169, 142)
PREDTXT = (106, 109, 73)

def X(v): return int(round(v * S))

def font_inter(size, weight):
    f = ImageFont.truetype(os.path.join(HERE, 'fonts', 'Inter.ttf'), X(size))
    f.set_variation_by_axes([28, weight])
    return f

def font_archivo(size):
    return ImageFont.truetype(os.path.join(HERE, 'fonts', 'ArchivoBlack.ttf'), X(size))

def font_anton(size):
    return ImageFont.truetype(os.path.join(HERE, 'fonts', 'Anton.ttf'), X(size))

def load_asset(name):
    return Image.open(os.path.join(HERE, name)).convert('RGBA')

def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m

def paste_icon(canvas, icon, cx, cy, target_h=None):
    # assets were extracted from the 4K upscale (6.37x source); render grid is S x source.
    k = S / (4096 / 643.0)
    tw, th = int(round(icon.width * k)), int(round(icon.height * k))
    ic = icon.resize((tw, th), Image.LANCZOS)
    canvas.alpha_composite(ic, (int(cx - tw / 2), int(cy - th / 2)))

def fit_title(draw, text, max_width, start_size=36, min_size=24):
    """Wrap uppercase title into <=2 lines (Anton), shrinking font if needed."""
    text = text.upper()
    best_lines = [text]
    size = start_size
    while size >= min_size:
        f = font_anton(size)
        words = text.split()
        lines, cur = [], ''
        ok = True
        for w in words:
            t = (cur + ' ' + w).strip()
            if draw.textlength(t, font=f) <= max_width:
                cur = t
            else:
                if cur: lines.append(cur)
                cur = w
                if draw.textlength(w, font=f) > max_width:
                    ok = False
        if cur: lines.append(cur)
        if ok and len(lines) <= 2:
            return f, lines, size
        best_lines = lines
        size -= 1
    return font_anton(min_size), best_lines[:2], min_size

def render(data, out_path):
    # ---------- base canvas: original frame/bg/shadow, card interior wiped ----------
    base = Image.open(os.path.join(HERE, 'up4k.png')).convert('RGBA')
    base = base.resize((X(643), X(647)), Image.LANCZOS)

    tex = Image.open(os.path.join(HERE, 'card_texture.png')).convert('RGBA')
    card_x, card_y, card_w, card_h = X(101), X(55), X(444), X(536)
    tex = tex.resize((card_w, card_h), Image.LANCZOS)
    mask = rounded_mask((card_w, card_h), X(17))
    base.paste(tex, (card_x, card_y), mask)

    canvas = base
    draw = ImageDraw.Draw(canvas)

    # ---------- header ----------
    pill_label = str(data.get('position', 'DRAW')).upper()
    pred_text = 'You\u2019ve predicted'
    px, py = X(126), X(92)
    limit = X(392)          # keep clear of trophy zone
    pred_size, pill_size = 19, 15
    while pred_size > 12:
        f_pred = font_inter(pred_size, 500)
        f_pill = font_inter(pill_size, 800)
        tl = draw.textlength(pill_label, font=f_pill)
        pill_x = px + draw.textlength(pred_text, font=f_pred) + X(10)
        pill_w = tl + X(24)
        if pill_x + pill_w <= limit:
            break
        pred_size -= 1
        pill_size = max(10, pill_size - 1)
    draw.text((px, py), pred_text, font=f_pred, fill=PREDTXT, anchor='lm')
    pill_h = X(pill_size + 13)
    draw.rounded_rectangle([pill_x, py - pill_h / 2, pill_x + pill_w, py + pill_h / 2],
                           radius=X(9), fill=OLIVE)
    draw.text((pill_x + pill_w / 2, py - X(0.5)), pill_label, font=f_pill,
              fill=(255, 255, 255), anchor='mm', )

    # ---------- title (max 2 lines, autoshrink; keep clear of trophy at x~385) ----------
    f_title, lines, tsize = fit_title(draw, str(data.get('title', '')), X(258))
    ty = X(107)
    for ln in lines:
        draw.text((X(125), ty), ln, font=f_title, fill=OLIVE)
        ty += X(tsize * 1.14)

    # ---------- prices ----------
    f_price = font_anton(31)
    pyy = X(206)
    x = X(126)
    pf = str(data.get('price_from', ''))
    pt = str(data.get('price_to', ''))
    draw.text((x, pyy), pf, font=f_price, fill=GRAYTXT, anchor='lm')
    x += draw.textlength(pf, font=f_price) + X(16)
    # blocky arrow
    ah, aw, shaft = X(16), X(24), X(7)
    ax, ay = x, pyy
    draw.polygon([
        (ax, ay - shaft / 2), (ax + aw - ah * 0.7, ay - shaft / 2),
        (ax + aw - ah * 0.7, ay - ah / 2), (ax + aw, ay),
        (ax + aw - ah * 0.7, ay + ah / 2), (ax + aw - ah * 0.7, ay + shaft / 2),
        (ax, ay + shaft / 2)], fill=OLIVE)
    x += aw + X(16)
    draw.text((x, pyy), pt, font=f_price, fill=OLIVE, anchor='lm')

    # ---------- lime panel ----------
    panel_x, panel_y = X(125), X(240)
    panel_w, panel_h = X(396), X(273)
    # soft lime glow under panel
    glow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle(
        [panel_x - X(1), panel_y - X(1), panel_x + panel_w + X(1), panel_y + panel_h + X(2)],
        radius=X(17), fill=(200, 225, 0, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(X(2.5)))
    canvas.alpha_composite(glow)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle([panel_x, panel_y, panel_x + panel_w, panel_y + panel_h],
                           radius=X(16), fill=LIME)

    rows = [
        ('icon_ticket.png',      'Shares',     str(data.get('shares', '')),    False),
        ('icon_receipt.png',     'Avg. Price', str(data.get('avg_price', '')), False),
        ('icon_dollar.png',      'Bought',     str(data.get('bought', '')),    False),
        ('icon_dollar_lime.png', 'To Win',     str(data.get('to_win', '')),    True),
    ]
    row_x, row_w = X(132), X(382)
    row_h, row_gap = X(55), X(9)
    ry = panel_y + X(9)
    f_label = font_inter(19, 500)
    f_value = font_inter(21, 700)
    for icon_name, label, value, dark in rows:
        fill = OLIVE if dark else ROWLIME
        draw.rounded_rectangle([row_x, ry, row_x + row_w, ry + row_h],
                               radius=X(11), fill=fill)
        cyy = ry + row_h / 2
        icon = load_asset(icon_name)
        paste_icon(canvas, icon, row_x + X(31), cyy)
        draw = ImageDraw.Draw(canvas)
        tcol = LIME if dark else OLIVE
        draw.text((row_x + X(52), cyy), label, font=f_label, fill=tcol, anchor='lm')
        draw.text((row_x + row_w - X(18), cyy), value, font=f_value, fill=tcol, anchor='rm')
        ry += row_h + row_gap

    # ---------- trophy (in front of panel top, like original) ----------
    trophy = load_asset('trophy_trim.png')
    th = X(186)
    tw = int(round(th * trophy.width / trophy.height))
    trophy = trophy.resize((tw, th), Image.LANCZOS)
    tcx, tby = X(445), X(251)          # gold center-x; base lands exactly on the Shares row top line (y=249 after edge feather)
    shadow = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    sh = trophy.copy()
    sh_alpha = sh.split()[3].point(lambda v: int(v * 0.30))
    dark = Image.new('RGBA', sh.size, (40, 42, 10, 255))
    dark.putalpha(sh_alpha)
    shadow.alpha_composite(dark, (int(tcx - tw / 2) + X(3), int(tby - th) + X(4)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(X(3)))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(trophy, (int(tcx - tw / 2), int(tby - th)))
    draw = ImageDraw.Draw(canvas)

    # ---------- footer ----------
    brand = load_asset('footer_brand.png')
    bh = X(30)
    bw = int(round(bh * brand.width / brand.height))
    brand = brand.resize((bw, bh), Image.LANCZOS)

    f_wallet = font_anton(22)
    wallet = str(data.get('wallet', '')).upper()
    wl = draw.textlength(wallet, font=f_wallet)
    gap = X(20)
    total = bw + gap + X(2) + gap + wl
    fx = X(323) - total / 2
    fy = X(551)
    canvas.alpha_composite(brand, (int(fx), int(fy - bh / 2)))
    draw = ImageDraw.Draw(canvas)
    dx = fx + bw + gap
    draw.rectangle([dx, fy - X(15), dx + X(2), fy + X(15)], fill=OLIVE)
    draw.text((dx + X(2) + gap, fy), wallet, font=f_wallet, fill=OLIVE, anchor='lm')

    # ---------- save ----------
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    canvas.convert('RGB').save(out_path, 'PNG')
    print('rendered:', out_path, canvas.size)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    arg = sys.argv[1]
    data = json.load(open(arg)) if os.path.exists(arg) else json.loads(arg)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'card.png')
    render(data, out)


















