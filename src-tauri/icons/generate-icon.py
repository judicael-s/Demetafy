"""Generate the Demetafy source app icon to match the in-app brand mark
(src/ui/components/Logo.tsx): a gradient "D" on a dark polar-grey rounded tile
with an Instagram-gradient border. Run from the repo root, then regenerate the
platform set:

    python src-tauri/icons/generate-icon.py
    pnpm tauri icon src-tauri/icons/source-icon.png

Gradient stops mirror --ig-gradient in app.css and the <linearGradient> in
Logo.tsx; keep all three in sync.
"""

import math

from PIL import Image, ImageChops, ImageDraw

SIZE = 1024
SS = 2  # supersample factor → crisp edges after the final downscale
BIG = SIZE * SS
OUT = "src-tauri/icons/source-icon.png"

TILE = (27, 31, 38, 255)  # #1b1f26 dark polar grey
RADIUS = round(8 / 32 * SIZE)  # rx=8 on Logo.tsx's 32-unit viewBox
STROKE = round(1.5 / 32 * SIZE)  # ~1px border on 32, nudged up for icon legibility

# Instagram gradient (offset, RGB), diagonal bottom-left → top-right (Logo.tsx).
STOPS = [
    (0.00, (254, 218, 117)),  # #feda75
    (0.25, (250, 126, 30)),   # #fa7e1e
    (0.50, (214, 41, 118)),   # #d62976
    (0.75, (150, 47, 191)),   # #962fbf
    (1.00, (79, 91, 213)),    # #4f5bd5
]

# D glyph polygon points from Logo.tsx, in its 32-unit viewBox. Outer is the
# stem + right bulge; inner is the counter we subtract from the mask. The arcs
# from the SVG (rx=10 ry=6.5 outer, rx=6.5 ry=3 inner, centered at y=16) are
# sampled into polylines so we can fill them with ImageDraw.polygon.
_ARC_STEPS = 96  # smooth enough at 1024×SS without measurable seams


def _arc(cx, cy, rx, ry, start_deg, end_deg, n=_ARC_STEPS):
    """Polyline along an elliptical arc, inclusive of both endpoints."""
    return [
        (
            cx + rx * math.cos(math.radians(start_deg + (end_deg - start_deg) * i / n)),
            cy + ry * math.sin(math.radians(start_deg + (end_deg - start_deg) * i / n)),
        )
        for i in range(n + 1)
    ]


D_OUTER_32 = [(8, 9.5), (14, 9.5)] + _arc(14, 16, 10, 6.5, -90, 90) + [(8, 22.5)]
D_INNER_32 = [(11.5, 13), (14, 13)] + _arc(14, 16, 6.5, 3, -90, 90) + [(11.5, 19)]


def _color_at(t):
    t = min(1.0, max(0.0, t))
    for i in range(len(STOPS) - 1):
        o0, c0 = STOPS[i]
        o1, c1 = STOPS[i + 1]
        if t <= o1:
            f = 0.0 if o1 == o0 else (t - o0) / (o1 - o0)
            return tuple(round(c0[k] + (c1[k] - c0[k]) * f) for k in range(3)) + (255,)
    return STOPS[-1][1] + (255,)


def _make_gradient(n):
    """Linear gradient over t = (x - y + n) / (2n): bottom-left → top-right."""
    ramp = [_color_at(i / 1023) for i in range(1024)]
    data = []
    for y in range(n):
        for x in range(n):
            data.append(ramp[round((x - y + n) / (2 * n) * 1023)])
    g = Image.new("RGBA", (n, n))
    g.putdata(data)
    return g


def main():
    grad = _make_gradient(SIZE).resize((BIG, BIG), Image.LANCZOS)

    # Dark rounded tile (full-bleed; corners stay transparent).
    base = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    ImageDraw.Draw(base).rounded_rectangle(
        [0, 0, BIG - 1, BIG - 1], radius=RADIUS * SS, fill=TILE
    )

    # Gradient border: rounded-rect outline, inset half the stroke so it sits inside.
    border = Image.new("L", (BIG, BIG), 0)
    inset = STROKE * SS / 2
    ImageDraw.Draw(border).rounded_rectangle(
        [inset, inset, BIG - 1 - inset, BIG - 1 - inset],
        radius=RADIUS * SS,
        outline=255,
        width=STROKE * SS,
    )

    # Gradient D glyph: fill the outer polygon, then carve the counter back
    # out by re-filling it with 0 on the same L mask.
    d = Image.new("L", (BIG, BIG), 0)
    draw = ImageDraw.Draw(d)
    draw.polygon([(x / 32 * BIG, y / 32 * BIG) for (x, y) in D_OUTER_32], fill=255)
    draw.polygon([(x / 32 * BIG, y / 32 * BIG) for (x, y) in D_INNER_32], fill=0)

    # Paint the gradient through (border ∪ D) onto the dark tile, then downscale.
    base.paste(grad, (0, 0), ImageChops.lighter(border, d))
    base.resize((SIZE, SIZE), Image.LANCZOS).save(OUT)
    print(f"wrote {OUT} {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()
