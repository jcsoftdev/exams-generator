#!/usr/bin/env python3
"""Report where the ink actually is inside a baked question crop.

`restructure-image-lot.ts` takes figure and alternative boxes as fractions of
the image, and estimating those by eye goes wrong in the two ways that matter:
a box a hair too narrow amputates the right edge of a drawing, and a box a hair
too wide swallows the neighbouring option's `c)` label. Both survive the Typst
compile and only surface in a printed exam.

So measure instead of guessing. This scans columns (and then rows) for dark
pixels and prints the groups it finds, separated by a whitespace gap, as the
fractions the transcription file wants.

    figure_bounds.py crop.png --band 0.60 0.99      # the alternatives row
    figure_bounds.py crop.png --band 0.17 0.60      # the statement's figure

A group about as wide as a character is the source's own `a)` / `b)` label, not
a drawing — leave it out of the box.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

INK = 128
"""Anything darker than this counts as ink. Scans of exam sheets are grey, not black."""


def groups_in(mask: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    """Contiguous runs of ink columns, merged across gaps under `min_gap`."""
    found: list[tuple[int, int]] = []
    start: int | None = None
    gap = 0

    for index, filled in enumerate(mask):
        if filled:
            if start is None:
                start = index
            gap = 0
        elif start is not None:
            gap += 1
            if gap > min_gap:
                found.append((start, index - gap))
                start = None
                gap = 0

    if start is not None:
        found.append((start, len(mask) - 1))

    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("--band", type=float, nargs=2, default=(0.0, 1.0),
                    metavar=("TOP", "BOTTOM"),
                    help="restrict the scan to this vertical slice, as fractions")
    ap.add_argument("--min-gap", type=int, default=12,
                    help="whitespace columns needed to split two groups (default 12)")
    ap.add_argument("--margin", type=float, default=0.008,
                    help="padding added to every reported box, as a fraction (default 0.008)")
    args = ap.parse_args()

    with Image.open(args.image).convert("L") as image:
        pixels = np.array(image)

    height, width = pixels.shape
    top, bottom = int(args.band[0] * height), int(args.band[1] * height)
    band = pixels[top:bottom, :] < INK

    print(f"{args.image.name}  {width}x{height}  band {args.band[0]:.2f}..{args.band[1]:.2f}")
    for left, right in groups_in(band.any(axis=0), args.min_gap):
        rows = np.where(band[:, left : right + 1].any(axis=1))[0]
        box = (
            max(0.0, left / width - args.margin),
            max(0.0, (top + rows[0]) / height - args.margin * 2),
            min(1.0, right / width + args.margin),
            min(1.0, (top + rows[-1]) / height + args.margin * 2),
        )
        print(
            f'  {{ "left": {box[0]:.3f}, "top": {box[1]:.3f}, '
            f'"right": {box[2]:.3f}, "bottom": {box[3]:.3f} }}   '
            f"({right - left}px wide)"
        )


if __name__ == "__main__":
    main()
