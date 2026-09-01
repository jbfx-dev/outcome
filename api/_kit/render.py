#!/usr/bin/env python3
"""P&L share-card renderer v2 (Outcome -- post-World Cup designs).

Usage:
    python3 render.py data.json [out.png]
    python3 render.py '{"theme":"default","outcome":"win",...}' [out.png]

Themes: default, hype, btc
Outcomes: win, loss

Data keys (all strings):
    theme       -- "default", "hype", or "btc"  (default: "default")
    outcome     -- "win" or "loss"               (default: "win")
    position    -- pill badge text, e.g. "UP"
    title       -- market title, auto-uppercased
    price_from  -- entry price, e.g. "$36.74"
    price_to    -- exit price, e.g. "$38.32"
    shares      -- share count, e.g. "1,500"
    avg_price   -- avg price in cents, e.g. "0.42c"
    bought      -- trade size, e.g. "$1,000"
    earned      -- payout earned, e.g. "$1,300"
    username    -- display name for footer (optional)
    avatar_path -- path to avatar image (optional)
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
S = 4          # supersample vs 445x547 design grid
W, H = 445, 547

# --------------- helpers ---------------

def X(v):
    return int(round(v * S))

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgba(color, alpha):
    """Return RGBA tuple from hex color + 0-1 alpha."""
    r, g, b = hex_rgb(color) if isinstance(color, str) else color
    return (r, g, b, int(round(alpha * 255)))

def font_inter(size, weight=400):
    f = ImageFont.truetype(os.path.join(HERE, 'fonts', 'Inter.ttf'), X(size))
    f.set_variation_by_axes([28, weight])
    return f

def font_anton(size):
    return ImageFont.truetype(os.path.join(HERE, 'fonts', 'Anton.ttf'), X(size))

def load_asset(name):
    return Image.open(os.path.join(HERE, name)).convert('RGBA')

def rounded_mask(w, h, r):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return m

def tint_icon(icon, color):
    """Recolor an RGBA icon, preserving alpha."""
    r, g, b = color[:3]
    arr = np.array(icon, dtype=np.float32)
    # Use alpha channel as mask, replace RGB
    arr[:, :, 0] = r
    arr[:, :, 1] = g
    arr[:, :, 2] = b
    return Image.fromarray(arr.astype(np.uint8))

def paste_icon(canvas, icon, cx, cy, color=None, target_h=None):
    """Paste an icon centered at (cx, cy), optionally tinting it."""
    # Scale from extracted asset size to design grid
    k = S / (4096.0 / 445.0)
    tw, th = int(round(icon.width * k)), int(round(icon.height * k))
    if target_h:
        ratio = target_h / th
        tw, th = int(round(tw * ratio)), target_h
    ic = icon.resize((tw, th), Image.LANCZOS)
    if color:
        ic = tint_icon(ic, color)
    canvas.alpha_composite(ic, (int(cx - tw / 2), int(cy - th / 2)))

# --------------- theme configs ---------------

THEME_CFG = {
    ('default', 'win'): dict(
        bg='#FAFAFA',
        panel='#0B0C0F', panel_a=1.0,
        row='#FFF1E6', row_a=0.1,
        earned='#FFFFFF', earned_a=1.0, earned_stroke=None,
        pill='#0B0C0F', pill_text=(255, 255, 255),
        header=hex_rgb('#808080'),
        title=hex_rgb('#0B0C0F'),
        price_from=hex_rgb('#808080'), price_to=hex_rgb('#0B0C0F'),
        arrow=hex_rgb('#0B0C0F'),
        row_txt=(255, 255, 255), row_val=(255, 255, 255),
        earned_txt=hex_rgb('#0B0C0F'), earned_val=hex_rgb('#0B0C0F'),
        footer=hex_rgb('#0B0C0F'), sep=hex_rgb('#0B0C0F'),
        icon_tint=(180, 180, 170), earned_icon_tint=hex_rgb('#0B0C0F'),
        art='art_default_win.png',
        art_rect=(267, 0, 275, 206),
    ),
    ('default', 'loss'): dict(
        bg='#0B0C0F',
        panel='#FAFAFA', panel_a=0.1,
        row='#FAFAFA', row_a=0.1,
        earned='#FAFAFA', earned_a=1.0, earned_stroke=None,
        pill='#FFFFFF', pill_text=hex_rgb('#0B0C0F'),
        header=hex_rgb('#808080'),
        title=(255, 255, 255),
        price_from=hex_rgb('#808080'), price_to=(255, 255, 255),
        arrow=(255, 255, 255),
        row_txt=(255, 255, 255), row_val=(255, 255, 255),
        earned_txt=hex_rgb('#0B0C0F'), earned_val=hex_rgb('#0B0C0F'),
        footer=(255, 255, 255), sep=(255, 255, 255),
        icon_tint=(180, 180, 170), earned_icon_tint=hex_rgb('#0B0C0F'),
        art='art_default_loss.png',
        art_rect=(267, 0, 275, 206),
    ),
    ('hype', 'win'): dict(
        bg='#FAFAFA',
        panel='#0B231B', panel_a=1.0,
        row='#E6FFF7', row_a=0.03,
        earned='#99FFBC', earned_a=0.05, earned_stroke='#99FFBC',
        pill='#0B231B', pill_text=(255, 255, 255),
        header=hex_rgb('#808080'),
        title=hex_rgb('#0B231B'),
        price_from=hex_rgb('#808080'), price_to=hex_rgb('#0B231B'),
        arrow=hex_rgb('#0B231B'),
        row_txt=(255, 255, 255), row_val=(255, 255, 255),
        earned_txt=hex_rgb('#99FFBC'), earned_val=hex_rgb('#99FFBC'),
        footer=hex_rgb('#0B231B'), sep=hex_rgb('#0B231B'),
        icon_tint=(180, 200, 190), earned_icon_tint=hex_rgb('#99FFBC'),
        art='art_hype.png',
        art_rect=(248, 0, 232, 232),  # flipped horizontally
    ),
    ('hype', 'loss'): dict(
        bg='#0B231B',
        panel='#FFFFFF', panel_a=0.1,
        row='#FFFFFF', row_a=0.05,
        earned='#99FFBC', earned_a=0.05, earned_stroke='#99FFBC',
        pill='#FFFFFF', pill_text=hex_rgb('#0B231B'),
        header=hex_rgb('#808080'),
        title=(255, 255, 255),
        price_from=hex_rgb('#808080'), price_to=(255, 255, 255),
        arrow=(255, 255, 255),
        row_txt=(255, 255, 255), row_val=(255, 255, 255),
        earned_txt=hex_rgb('#99FFBC'), earned_val=hex_rgb('#99FFBC'),
        footer=(255, 255, 255), sep=(255, 255, 255),
        icon_tint=(180, 200, 190), earned_icon_tint=hex_rgb('#99FFBC'),
        art='art_hype.png',
        art_rect=(248, 0, 232, 232),
    ),
    ('btc', 'win'): dict(
        bg='#FAFAFA',
        panel='#D9711C', panel_a=1.0,
        row='#FFF1E6', row_a=0.1,
        earned='#FFFFFF', earned_a=1.0, earned_stroke=None,
        pill='#D9711C', pill_text=(255, 255, 255),
        header=hex_rgb('#D9711C'),
        title=hex_rgb('#D9711C'),
        price_from=hex_rgb('#D9711C'), price_to=hex_rgb('#D9711C'),
        arrow=hex_rgb('#D9711C'),
        row_txt=(255, 255, 255), row_val=(255, 255, 255),
        earned_txt=hex_rgb('#D9711C'), earned_val=hex_rgb('#D9711C'),
        footer=hex_rgb('#D9711C'), sep=hex_rgb('#D9711C'),
        icon_tint=(240, 210, 180), earned_icon_tint=hex_rgb('#D9711C'),
        art='art_btc.png',
        art_rect=(217, -40, 328, 246),
    ),
    ('btc', 'loss'): dict(
        bg='#D9711C',
        panel='#FFFFFF', panel_a=0.1,
        row='#FFFFFF', row_a=0.1,
        earned='#FFFFFF', earned_a=1.0, earned_stroke=None,
        pill='#FFFFFF', pill_text=hex_rgb('#D9711C'),
        header=(255, 255, 255),
        title=(255, 255, 255),
        price_from=hex_rgb('#E8A060'), price_to=(255, 255, 255),
        arrow=(255, 255, 255),
        row_txt=(255, 255, 255), row_val=(255, 255, 255),
        earned_txt=hex_rgb('#D9711C'), earned_val=hex_rgb('#D9711C'),
        footer=(255, 255, 255), sep=(255, 255, 255),
        icon_tint=(240, 210, 180), earned_icon_tint=hex_rgb('#D9711C'),
        art='art_btc.png',
        art_rect=(217, -40, 328, 246),
    ),
}

# --------------- title wrapping ---------------

def fit_title(draw, text, max_width, start_size=36, min_size=24):
    """Wrap uppercase title into <=2 lines (Anton), shrinking if needed."""
    text = text.upper()
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
                if cur:
                    lines.append(cur)
                cur = w
                if draw.textlength(w, font=f) > max_width:
                    ok = False
        if cur:
            lines.append(cur)
        if ok and len(lines) <= 2:
            return f, lines, size
        size -= 1
    return font_anton(min_size), lines[:2], min_size

# --------------- main renderer ---------------

def render(data, out_path):
    theme = str(data.get('theme', 'default')).lower()
    outcome = str(data.get('outcome', 'win')).lower()
    cfg = THEME_CFG.get((theme, outcome), THEME_CFG[('default', 'win')])

    cw, ch = X(W), X(H)

    # ---- base canvas with background color ----
    bg_rgb = hex_rgb(cfg['bg']) if isinstance(cfg['bg'], str) else cfg['bg']
    canvas = Image.new('RGBA', (cw, ch), bg_rgb + (255,))

    # ---- texture overlay ----
    try:
        tex = load_asset('bg_texture.png').convert('RGBA')
        tex = tex.resize((cw, ch), Image.LANCZOS)
        # Apply opacity
        arr = np.array(tex, dtype=np.float32)
        arr[:, :, 3] *= cfg.get('texture_opacity', 0.4) if 'texture_opacity' in cfg else 0.4
        tex = Image.fromarray(arr.astype(np.uint8))
        canvas.alpha_composite(tex)
    except FileNotFoundError:
        pass

    # ---- card rounded corners (clip to 16px radius) ----
    card_mask = rounded_mask(cw, ch, X(16))

    # ---- artwork ----
    try:
        art = load_asset(cfg['art'])
        ax, ay, aw, ah = cfg['art_rect']
        art_w, art_h = X(aw), X(ah)
        art = art.resize((art_w, art_h), Image.LANCZOS)

        # Clip artwork to visible area (top-right, within card bounds)
        clip_x, clip_y = X(276), 0
        clip_w, clip_h = X(169), X(202)

        # For hype theme: artwork is flipped horizontally
        if theme == 'hype':
            art = art.transpose(Image.FLIP_LEFT_RIGHT)

        # Create artwork layer and paste clipped
        art_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        art_layer.paste(art, (X(ax), X(ay) if ay >= 0 else X(ay)))
        # Clip to artwork visible area
        art_mask = Image.new('L', (cw, ch), 0)
        ImageDraw.Draw(art_mask).rectangle(
            [clip_x, clip_y, clip_x + clip_w, clip_y + clip_h], fill=255)
        art_layer.putalpha(
            Image.fromarray(np.minimum(np.array(art_layer.split()[3]),
                                       np.array(art_mask))))
        canvas.alpha_composite(art_layer)
    except FileNotFoundError:
        pass

    draw = ImageDraw.Draw(canvas)

    # ---- header: "You predicted" + pill badge ----
    pred_text = 'You predicted'
    pill_label = str(data.get('position', 'UP')).upper()
    px, py = X(28), X(38)  # text left, baseline center

    pred_size, pill_size = 14, 11
    f_pred = font_inter(pred_size, 500)
    f_pill = font_inter(pill_size, 800)

    pred_len = draw.textlength(pred_text, font=f_pred)
    pill_tl = draw.textlength(pill_label, font=f_pill)
    pill_pad = X(10)
    pill_x = int(px + pred_len + X(8))
    pill_w = int(pill_tl + pill_pad * 2)
    pill_h = X(pill_size + 10)

    draw.text((px, py), pred_text, font=f_pred, fill=cfg['header'], anchor='lm')

    pill_color = hex_rgb(cfg['pill']) if isinstance(cfg['pill'], str) else cfg['pill']
    draw.rounded_rectangle(
        [pill_x, py - pill_h // 2, pill_x + pill_w, py + pill_h // 2],
        radius=X(7), fill=pill_color)
    draw.text((pill_x + pill_w // 2, py), pill_label, font=f_pill,
              fill=cfg['pill_text'], anchor='mm')

    # ---- title (max 2 lines, Anton, auto-shrink) ----
    max_title_w = X(260)  # keep clear of artwork zone
    f_title, lines, tsize = fit_title(draw, str(data.get('title', '')), max_title_w)
    ty = X(60)
    for ln in lines:
        draw.text((X(28), ty), ln, font=f_title, fill=cfg['title'])
        ty += X(tsize * 1.14)

    # ---- price range ----
    f_price = font_anton(26)
    price_y = X(170)
    x = X(28)
    pf = str(data.get('price_from', ''))
    pt = str(data.get('price_to', ''))
    draw.text((x, price_y), pf, font=f_price, fill=cfg['price_from'], anchor='lm')
    x += int(draw.textlength(pf, font=f_price)) + X(14)
    # arrow
    ah_size, aw_size, shaft = X(12), X(20), X(5)
    ax, ay = x, price_y
    draw.polygon([
        (ax, ay - shaft // 2), (ax + aw_size - int(ah_size * 0.7), ay - shaft // 2),
        (ax + aw_size - int(ah_size * 0.7), ay - ah_size // 2), (ax + aw_size, ay),
        (ax + aw_size - int(ah_size * 0.7), ay + ah_size // 2),
        (ax + aw_size - int(ah_size * 0.7), ay + shaft // 2),
        (ax, ay + shaft // 2)], fill=cfg['arrow'])
    x += aw_size + X(14)
    draw.text((x, price_y), pt, font=f_price, fill=cfg['price_to'], anchor='lm')

    # ---- data panel ----
    panel_x, panel_y = X(24), X(202)
    panel_w, panel_h = X(397), X(264)
    panel_r = X(12)

    panel_fill = hex_rgb(cfg['panel']) if isinstance(cfg['panel'], str) else cfg['panel']
    panel_a = cfg['panel_a']

    if panel_a < 1.0:
        # Semi-transparent panel -- apply backdrop blur
        region = canvas.crop((panel_x, panel_y, panel_x + panel_w, panel_y + panel_h))
        region = region.filter(ImageFilter.GaussianBlur(X(8)))
        blur_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        blur_mask = Image.new('L', (panel_w, panel_h), 0)
        ImageDraw.Draw(blur_mask).rounded_rectangle(
            [0, 0, panel_w - 1, panel_h - 1], radius=panel_r, fill=255)
        blur_layer.paste(region, (panel_x, panel_y), blur_mask)
        canvas.alpha_composite(blur_layer)
        draw = ImageDraw.Draw(canvas)

    # Panel fill (solid or semi-transparent)
    panel_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel_layer)
    pd.rounded_rectangle(
        [panel_x, panel_y, panel_x + panel_w, panel_y + panel_h],
        radius=panel_r, fill=panel_fill + (int(panel_a * 255),))
    canvas.alpha_composite(panel_layer)

    # Panel border (subtle)
    draw = ImageDraw.Draw(canvas)
    border_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border_layer)
    bd.rounded_rectangle(
        [panel_x + 1, panel_y + 1, panel_x + panel_w - 1, panel_y + panel_h - 1],
        radius=panel_r - 1,
        outline=rgba('#FFFFFF', 0.05) if outcome == 'loss' else rgba('#FFF1E6', 0.05),
        width=X(0.5))
    canvas.alpha_composite(border_layer)
    draw = ImageDraw.Draw(canvas)

    # ---- rows ----
    rows_data = [
        ('icon_ticket.png',  'Shares',     str(data.get('shares', '')),    False),
        ('icon_receipt.png', 'Avg. Price', str(data.get('avg_price', '')), False),
        ('icon_dollar.png',  'Bought',     str(data.get('bought', '')),    False),
        ('icon_dollar.png',  'Earned',     str(data.get('earned', '')),    True),
    ]

    row_x, row_right = X(32), X(413)
    row_w = row_right - row_x
    row_h = X(56)
    row_gap = X(8)
    ry = panel_y + X(8)  # first row top
    row_r = X(8)  # corner radius for rows
    f_label = font_inter(15, 500)
    f_value = font_inter(17, 700)

    for icon_name, label, value, is_earned in rows_data:
        # Row fill
        if is_earned:
            fill_hex = cfg['earned']
            fill_a = cfg['earned_a']
        else:
            fill_hex = cfg['row']
            fill_a = cfg['row_a']

        fill_rgb = hex_rgb(fill_hex) if isinstance(fill_hex, str) else fill_hex
        row_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        rd = ImageDraw.Draw(row_layer)
        rd.rounded_rectangle(
            [row_x, ry, row_x + row_w, ry + row_h],
            radius=row_r, fill=fill_rgb + (int(fill_a * 255),))
        canvas.alpha_composite(row_layer)

        # Earned row stroke
        if is_earned and cfg.get('earned_stroke'):
            stroke_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
            sd = ImageDraw.Draw(stroke_layer)
            stroke_c = hex_rgb(cfg['earned_stroke'])
            sd.rounded_rectangle(
                [row_x, ry, row_x + row_w, ry + row_h],
                radius=row_r, outline=stroke_c + (80,), width=X(1))
            canvas.alpha_composite(stroke_layer)

        draw = ImageDraw.Draw(canvas)
        cy = ry + row_h // 2

        # Icon
        try:
            icon = load_asset(icon_name)
            ic_tint = cfg['earned_icon_tint'] if is_earned else cfg.get('icon_tint')
            paste_icon(canvas, icon, row_x + X(22), cy, color=ic_tint, target_h=X(18))
            draw = ImageDraw.Draw(canvas)
        except FileNotFoundError:
            pass

        # Label and value text
        if is_earned:
            tcol_l, tcol_v = cfg['earned_txt'], cfg['earned_val']
        else:
            tcol_l, tcol_v = cfg['row_txt'], cfg['row_val']

        draw.text((row_x + X(40), cy), label, font=f_label, fill=tcol_l, anchor='lm')
        draw.text((row_x + row_w - X(12), cy), value, font=f_value, fill=tcol_v, anchor='rm')

        ry += row_h + row_gap

    # ---- footer ----
    username = str(data.get('username', '')).strip()
    avatar_path = str(data.get('avatar_path', '')).strip()
    has_user = bool(username)

    footer_y = X(506)

    # Load Outcome logo (the original brand asset, not the extracted avatar)
    try:
        logo = load_asset('footer_brand.png')
        logo_h = X(24)
        logo_w = int(round(logo_h * logo.width / logo.height))
        logo = logo.resize((logo_w, logo_h), Image.LANCZOS)
        # Tint logo to match footer color
        logo = tint_icon(logo, cfg['footer'])
    except FileNotFoundError:
        logo = None
        logo_w, logo_h = 0, 0

    if has_user and logo:
        # Layout: logo | avatar username
        sep_gap = X(8)
        sep_w = X(1.5)
        sep_h = X(32)

        f_user = font_inter(14, 800)
        user_len = draw.textlength(username, font=f_user)

        avatar_d = X(31)  # avatar circle diameter
        avatar_gap = X(6)

        total_w = logo_w + sep_gap + sep_w + sep_gap
        if avatar_path and os.path.exists(avatar_path):
            total_w += avatar_d + avatar_gap + int(user_len)
        else:
            total_w += int(user_len)

        fx = X(W // 2) - total_w // 2  # center everything

        # Logo
        canvas.alpha_composite(logo, (fx, footer_y - logo_h // 2))
        draw = ImageDraw.Draw(canvas)

        # Separator
        sx = fx + logo_w + sep_gap
        draw.rectangle(
            [sx, footer_y - sep_h // 2, sx + sep_w, footer_y + sep_h // 2],
            fill=cfg['sep'])

        ux = sx + sep_w + sep_gap

        # Avatar (if provided)
        if avatar_path and os.path.exists(avatar_path):
            try:
                av = Image.open(avatar_path).convert('RGBA')
                av = av.resize((avatar_d, avatar_d), Image.LANCZOS)
                # Circular mask
                av_mask = Image.new('L', (avatar_d, avatar_d), 0)
                ImageDraw.Draw(av_mask).ellipse([0, 0, avatar_d - 1, avatar_d - 1], fill=255)
                av_layer = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
                av.putalpha(Image.fromarray(
                    np.minimum(np.array(av.split()[3]), np.array(av_mask))))
                av_layer.paste(av, (ux, footer_y - avatar_d // 2))
                canvas.alpha_composite(av_layer)
                # Border
                draw = ImageDraw.Draw(canvas)
                draw.ellipse(
                    [ux, footer_y - avatar_d // 2,
                     ux + avatar_d, footer_y + avatar_d // 2],
                    outline=(255, 255, 255, 180), width=X(0.5))
                ux += avatar_d + avatar_gap
            except Exception:
                pass

        draw = ImageDraw.Draw(canvas)
        draw.text((ux, footer_y), username, font=f_user, fill=cfg['footer'], anchor='lm')

    elif logo:
        # Centered logo only (no user)
        fx = X(W // 2) - logo_w // 2
        canvas.alpha_composite(logo, (fx, footer_y - logo_h // 2))

    # ---- apply card rounded corners ----
    final = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    final.paste(canvas, (0, 0), card_mask)
    canvas = final

    # ---- save ----
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    canvas.convert('RGB').save(out_path, 'PNG')
    print(f'rendered: {out_path} {canvas.size}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    arg = sys.argv[1]
    data = json.load(open(arg)) if os.path.exists(arg) else json.loads(arg)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'card.png')
    render(data, out)
