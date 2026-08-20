#!/usr/bin/env python3
"""Check that a lot's recorded `sourceUrl` really contains the lot's questions.

A harvested question carries a URL as its provenance, and that string is what a
licensing question gets answered with later. For the scanned UNAC exams the URL
turned out to be unreliable — the site publishes the same booklet under several
names, and an agent can record the file it downloaded rather than the file the
crops came from.

This proves the link instead of trusting it: OCR the lot's first question crop,
take a distinctive phrase out of it, then OCR the first pages of the PDF the lot
names and look for that phrase.

Usage:
    check_source_url.py <lots-dir> [<lot-slug> ...]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

# Booklets run to ~14 pages; scan past the end rather than risk a false FAIL,
# which would quarantine a lot whose provenance is actually fine.
PAGES_TO_SCAN = 22


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.lower())
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", stripped)


def ocr(image: Path) -> str:
    out = subprocess.run(
        ["tesseract", str(image), "stdout", "-l", "spa"],
        capture_output=True, text=True, check=False,
    )
    return out.stdout


def signature(text: str) -> str:
    """Drop short words, which OCR mangles most, and keep the rest in order.

    Both the crop and the page go through this, so the comparison is like for
    like — comparing a filtered phrase against unfiltered page text never
    matches, however right the lot is.
    """
    return " ".join(w for w in fold(text).split() if len(w) > 3)


def distinctive_phrase(text: str) -> str | None:
    """A run of words long enough to be unique, short enough to survive OCR drift."""
    words = signature(text).split()
    return " ".join(words[:6]) if len(words) >= 6 else None


def pdf_contains(pdf: Path, phrase: str) -> bool:
    with tempfile.TemporaryDirectory() as tmp:
        for page in range(2, PAGES_TO_SCAN + 1):
            stem = Path(tmp) / "page"
            subprocess.run(
                ["pdftoppm", "-png", "-r", "130", "-f", str(page), "-l", str(page),
                 "-singlefile", str(pdf), str(stem)],
                capture_output=True, check=False,
            )
            png = stem.with_suffix(".png")
            if not png.exists():
                continue
            if phrase in signature(ocr(png)):
                return True
    return False


def main() -> int:
    lots_dir = Path(sys.argv[1])
    wanted = sys.argv[2:]
    failures = 0

    for path in sorted(lots_dir.glob("scan-*-image.json")):
        slug = path.stem.replace("-image", "")
        if wanted and slug not in wanted:
            continue
        raw = json.loads(path.read_text())
        entries = raw["entries"] if isinstance(raw, dict) else raw
        if not entries:
            continue
        # A figure-heavy first question can OCR to almost nothing; try a few
        # entries before giving up on the lot.
        phrase, url = None, ""
        for candidate in entries[:6]:
            crop = lots_dir / candidate.get("imagePath", "")
            url = candidate.get("sourceUrl", "")
            if not url or not crop.exists():
                continue
            phrase = distinctive_phrase(ocr(crop))
            if phrase:
                break
        if not phrase:
            print(f"SKIP {slug}: no crop OCRed to anything distinctive")
            continue

        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "source.pdf"
            subprocess.run(["curl", "-skL", "-o", str(pdf), url], capture_output=True, check=False)
            if not pdf.exists() or pdf.stat().st_size < 10_000:
                print(f"FAIL {slug}: sourceUrl did not download ({url})")
                failures += 1
                continue
            found = pdf_contains(pdf, phrase)

        status = "OK  " if found else "FAIL"
        failures += 0 if found else 1
        print(f"{status} {slug:<26} phrase={phrase!r}")
        if not found:
            print(f"       not found in {url}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
