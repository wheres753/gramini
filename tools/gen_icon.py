#!/usr/bin/env python3
"""Generate the Gramini app icon (1024x1024 PNG, no alpha).

An original mark: a bold striding figure — mid-run, leaning into the hill —
in dark forest green on warm cream. Drawn geometrically from thick rounded
strokes (no fonts, no external artwork, no reference to any existing logo).

Usage:
    python3 -m venv tools/.venv && tools/.venv/bin/pip install pillow
    tools/.venv/bin/python tools/gen_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
CHROME_OUT = ROOT / "chrome/icon128.png"

SIZE = 1024
SUPER = 4  # draw at 4x and downsample for smooth edges

CREAM = (244, 235, 215)
FOREST = (30, 74, 56)


def main() -> None:
    S = SIZE * SUPER
    img = Image.new("RGB", (S, S), CREAM)
    d = ImageDraw.Draw(img)

    def px(v: float) -> float:
        return v * SUPER

    def dot(p, r):
        d.ellipse([px(p[0] - r), px(p[1] - r), px(p[0] + r), px(p[1] + r)], fill=FOREST)

    def limb(points, width):
        """Polyline with round joints and caps."""
        for a, b in zip(points, points[1:]):
            d.line([px(a[0]), px(a[1]), px(b[0]), px(b[1])], fill=FOREST, width=int(px(width)))
        for p in points:
            dot(p, width / 2)

    # --- figure (1024-space) -------------------------------------------------
    w = 88                      # limb thickness
    head_c, head_r = (612, 236), 74
    shoulder = (560, 350)
    hip = (462, 566)

    limb([shoulder, hip], 104)                              # torso, a little heavier
    limb([(590, 300), shoulder], 70)                        # neck
    limb([shoulder, (692, 392), (760, 262)], w)             # front arm, reaching up the slope
    limb([shoulder, (430, 400), (348, 300)], w)             # back arm, bent and swung back
    limb([hip, (606, 626), (650, 796)], w)                  # front leg, planting
    limb([hip, (356, 664), (232, 748)], w)                  # back leg, kicking out
    dot(head_c, head_r)

    # --- centre the composition ---------------------------------------------
    xs = [232 - w / 2, 760 + w / 2]
    ys = [head_c[1] - head_r, 796 + w / 2]
    dx = (SIZE - (xs[0] + xs[1])) / 2
    dy = (SIZE - (ys[0] + ys[1])) / 2
    img = img.transform(img.size, Image.AFFINE, (1, 0, -px(dx), 0, 1, -px(dy)),
                        resample=Image.BICUBIC, fillcolor=CREAM)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    img.resize((128, 128), Image.LANCZOS).save(CHROME_OUT, "PNG", optimize=True)
    print(f"wrote {OUT} and {CHROME_OUT}")


if __name__ == "__main__":
    main()
