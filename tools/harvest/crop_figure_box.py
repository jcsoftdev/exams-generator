#!/usr/bin/env python3
"""Cut the figure out of a whole-question crop.

`build_lot.py --all-images` bakes an entire question — statement, alternatives,
source numbering, watermark — into one PNG. Once the statement has been read
back into text (`restructure-image-lot.ts`), the only part of that PNG still
worth keeping is the drawing, and reusing the whole thing as the complement
would reprint the statement a second time.

The box arrives as FRACTIONS of the image, not pixels: whoever reads the PNG
sees it scaled, so a fraction is what they can actually judge, and it stays
correct if the source is ever re-rendered at another DPI.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def crop(source: Path, target: Path, box: tuple[float, float, float, float]) -> tuple[int, int]:
    left, top, right, bottom = box
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise SystemExit(f"box {box} is not a rectangle inside the image")

    with Image.open(source) as image:
        width, height = image.size
        cut = image.crop((
            round(left * width), round(top * height),
            round(right * width), round(bottom * height),
        ))
        target.parent.mkdir(parents=True, exist_ok=True)
        cut.save(target)

        return cut.size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--target", type=Path, required=True)
    ap.add_argument("--left", type=float, required=True)
    ap.add_argument("--top", type=float, required=True)
    ap.add_argument("--right", type=float, required=True)
    ap.add_argument("--bottom", type=float, required=True)
    args = ap.parse_args()

    width, height = crop(args.source, args.target, (args.left, args.top, args.right, args.bottom))
    print(f"{args.target} {width}x{height}")


if __name__ == "__main__":
    main()
