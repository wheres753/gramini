#!/usr/bin/env python3
"""Generate the Gramini app icon (1024x1024 PNG, no alpha).

An original mark: a bold rounded lowercase "g" in dark forest green on a warm
cream background, with a small solid half-sun sitting on the g's baseline.
Everything is drawn geometrically (no fonts, no external artwork).

Usage:
    python3 -m venv tools/.venv && tools/.venv/bin/pip install pillow
    tools/.venv/bin/python tools/gen_icon.py
"""
from pathlib import Path

import math

from PIL import Image, ImageChops, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

SIZE = 1024
SUPER = 4  # draw at 4x and downsample for smooth edges

CREAM = (244, 235, 215)
FOREST = (30, 74, 56)
SUN = (212, 130, 59)


def main() -> None:
    S = SIZE * SUPER
    img = Image.new("RGB", (S, S), CREAM)

    def px(v: float) -> float:
        return v * SUPER

    # --- geometry (in 1024-space) -------------------------------------------
    stroke = 112
    r_bowl = 188
    bowl_cx, bowl_cy = 420, 448
    stem_x = bowl_cx + r_bowl              # stem hugs the bowl's right edge
    stem_top = 318
    baseline = bowl_cy + r_bowl + stroke / 2   # outer bottom of the bowl
    r_hook = 156
    hook_cy = baseline - 2                 # hook grows straight out of the bowl
    hook_cx = stem_x - r_hook              # arc's right end sits under the stem
    hook_end_deg = 145                     # where the descender stops (0 = 3 o'clock, clockwise)

    # Shapes are built as masks and composited, because PIL's wide `arc`
    # leaves seams at the joins.
    def new_mask():
        return Image.new("L", (S, S), 0)

    def ring_mask(cx, cy, r, width):
        m = new_mask()
        d = ImageDraw.Draw(m)
        ro, ri = r + width / 2, r - width / 2
        d.ellipse([px(cx - ro), px(cy - ro), px(cx + ro), px(cy + ro)], fill=255)
        d.ellipse([px(cx - ri), px(cy - ri), px(cx + ri), px(cy + ri)], fill=0)
        return m

    def dot_mask(cx, cy, r):
        m = new_mask()
        ImageDraw.Draw(m).ellipse([px(cx - r), px(cy - r), px(cx + r), px(cy + r)], fill=255)
        return m

    def bar_mask(x, y0, y1, width):
        m = new_mask()
        ImageDraw.Draw(m).rectangle([px(x - width / 2), px(y0), px(x + width / 2), px(y1)], fill=255)
        return m

    def wedge_mask(cx, cy, r, start, end):
        m = new_mask()
        ImageDraw.Draw(m).pieslice([px(cx - r), px(cy - r), px(cx + r), px(cy + r)],
                                   start=start, end=end, fill=255)
        return m

    g = new_mask()
    # bowl
    g = ImageChops.lighter(g, ring_mask(bowl_cx, bowl_cy, r_bowl, stroke))
    # stem with rounded top cap
    g = ImageChops.lighter(g, bar_mask(stem_x, stem_top, hook_cy, stroke))
    g = ImageChops.lighter(g, dot_mask(stem_x, stem_top, stroke / 2))
    # descender: part of a ring, clipped to a wedge, with a rounded end
    hook = ImageChops.multiply(ring_mask(hook_cx, hook_cy, r_hook, stroke),
                               wedge_mask(hook_cx, hook_cy, r_hook + stroke, 0, hook_end_deg))
    g = ImageChops.lighter(g, hook)
    end_x = hook_cx + r_hook * math.cos(math.radians(hook_end_deg))
    end_y = hook_cy + r_hook * math.sin(math.radians(hook_end_deg))
    g = ImageChops.lighter(g, dot_mask(end_x, end_y, stroke / 2))

    img.paste(FOREST, mask=g)

    # half-sun sitting on the baseline, to the right of the stem
    sun_r = 84
    sun_cx = stem_x + stroke / 2 + 30 + sun_r
    sun = wedge_mask(sun_cx, baseline, sun_r, 180, 360)
    img.paste(SUN, mask=sun)

    # --- centre the composition ---------------------------------------------
    left = bowl_cx - r_bowl - stroke / 2
    right = sun_cx + sun_r
    top = min(stem_top - stroke / 2, bowl_cy - r_bowl - stroke / 2)
    bottom = hook_cy + r_hook + stroke / 2
    dx = (SIZE - (left + right)) / 2
    dy = (SIZE - (top + bottom)) / 2
    img = img.transform(img.size, Image.AFFINE, (1, 0, -px(dx), 0, 1, -px(dy)),
                        resample=Image.BICUBIC, fillcolor=CREAM)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
