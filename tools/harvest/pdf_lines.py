#!/usr/bin/env python3
"""Read a PDF as text lines in true reading order, including two-column pages.

`pdftotext -layout` renders a two-column page as one wide line per row, which
interleaves the two columns and makes "question N ... Respuesta X" pairing
unreliable. This module works from `pdftotext -bbox-layout` word boxes instead:
it detects a two-column page geometrically and emits the left column fully
before the right one.
"""
from __future__ import annotations

import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

XHTML = "http://www.w3.org/1999/xhtml"


def _pages(pdf: Path) -> list[dict]:
    xml = subprocess.run(
        ["pdftotext", "-bbox-layout", str(pdf), "-"],
        capture_output=True, text=True, check=True,
    ).stdout
    # Some PDFs carry glyphs that pdftotext emits as raw control bytes, which are
    # not legal XML; drop them rather than lose the whole document.
    xml = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", xml)
    root = ET.fromstring(xml)
    out = []
    for page in root.iter(f"{{{XHTML}}}page"):
        lines = []
        for line in page.iter(f"{{{XHTML}}}line"):
            text = " ".join((w.text or "") for w in line.iter(f"{{{XHTML}}}word")).strip()
            # Some PDFs emit decomposed accents (MATEMA + U+0301); compose them so
            # heading comparisons and Spanish text match what a reader expects.
            text = unicodedata.normalize("NFC", text)
            if not text:
                continue
            lines.append({
                "xmin": float(line.get("xMin")), "xmax": float(line.get("xMax")),
                "ymin": float(line.get("yMin")), "ymax": float(line.get("yMax")),
                "text": text,
            })
        out.append({"width": float(page.get("width")),
                    "height": float(page.get("height")), "lines": lines})
    return out


def pages(pdf: Path) -> list[dict]:
    """Pages with their geometry, lines sorted into reading order within a page."""
    out = _pages(pdf)
    for page in out:
        page["lines"].sort(key=lambda l: (round(l["ymin"], 1), l["xmin"]))
    return out


def _is_two_column(page: dict) -> bool:
    """True when the page's text splits cleanly either side of the centre line."""
    lines = page["lines"]
    if len(lines) < 12:
        return False
    mid = page["width"] / 2
    crossing = sum(1 for l in lines if l["xmin"] < mid - 20 and l["xmax"] > mid + 20)
    right = sum(1 for l in lines if l["xmin"] >= mid - 20)
    return crossing <= len(lines) * 0.12 and right >= len(lines) * 0.25


def page_lines(page: dict) -> list[str]:
    lines = page["lines"]
    if not _is_two_column(page):
        return [l["text"] for l in sorted(lines, key=lambda l: (round(l["ymin"], 1), l["xmin"]))]
    mid = page["width"] / 2
    left = [l for l in lines if l["xmin"] < mid - 20]
    right = [l for l in lines if l["xmin"] >= mid - 20]
    order = lambda ls: [l["text"] for l in sorted(ls, key=lambda l: (round(l["ymin"], 1), l["xmin"]))]
    return order(left) + order(right)


def document_lines(pdf: Path) -> list[str]:
    """Every line of the PDF, column-aware, one page after another."""
    lines: list[str] = []
    for page in _pages(pdf):
        lines.extend(page_lines(page))
    return lines


if __name__ == "__main__":
    import sys

    for line in document_lines(Path(sys.argv[1])):
        print(line)
