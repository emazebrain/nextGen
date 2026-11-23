#!/usr/bin/env python3
"""
Prepares pictures supplied by the product owner for In My Skin.

  python3 scripts/import-pictures.py <folder of transparent PNGs, named <id>.png>

For each picture: drops stray specks that are not part of the subject, trims the empty margin, centres the subject
on a transparent square and writes assets/<id>.webp at 384 px. The picture itself is not altered.
Prints how colourful each one is: below about 0.13 a picture is hard to tell from its grey outline.
"""
import colorsys, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SIZE = 384
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def prepare(path: str) -> tuple[Image.Image, float]:
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    solid = arr[:, :, 3] > 24
    labels, n = ndimage.label(solid)
    if n > 1:
        sizes = ndimage.sum(solid, labels, range(1, n + 1))
        keep = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * 0.015])
        arr[~keep, 3] = 0
        solid = keep
    ys, xs = np.where(solid)
    crop = Image.fromarray(arr).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = max(crop.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    out = square.resize((SIZE, SIZE), Image.LANCZOS)
    px = [(r, g, b) for r, g, b, a in out.resize((64, 64)).getdata() if a >= 60]
    colour = sum(colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[1] * max(r, g, b) / 255 for r, g, b in px) / len(px)
    return out, colour


if __name__ == "__main__":
    src = sys.argv[1]
    for f in sorted(os.listdir(src)):
        if not f.lower().endswith(".png"):
            continue
        pid = f[:-4]
        out, colour = prepare(os.path.join(src, f))
        out.save(os.path.join(ROOT, "assets", pid + ".webp"), "WEBP", quality=84, method=6)
        print(f"{pid:28s} colour {colour:.2f}{'  (close to grey)' if colour < 0.13 else ''}")
