#!/usr/bin/env python3
"""Crop the figure that sits inside a question of a text-layer PDF.

A UNI/textbook question laid out in LaTeX looks like this on the page:

    12. Una torre de antena se desea sujetar ...      <- statement lines
        Determine la medida del ángulo ABC ...
                                                      <- the figure lives here
        A) 45         B) 60         C) 120            <- alternatives

So the figure band is bounded above by the last statement line and below by the
first alternative line. This script finds those two anchors from `pdftotext
-bbox-layout` word boxes, renders the page with `pdftoppm`, and crops the band.

Usage:
    crop_pdf_figures.py <pdf> --question 12 --anchor "Una torre de antena" \
        --out figures/geo-12.png [--dpi 200]

    crop_pdf_figures.py <pdf> --list-anchors "Una torre"   # find page + boxes

The crop is intentionally the raw band: verify every PNG by eye before seeding —
if it caught statement text or the alternatives, the anchors were wrong.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pdf_lines import pages as bbox_pages  # noqa: E402

ALT_RE = re.compile(r"^[A-E]\)$")
# Running header / footer text that must never bound or enter a crop.
FURNITURE_RE = re.compile(
    r"^(Solucionario\s+ADMISI[ÓO]N|CAP[ÍI]TULO\s+\d|\d{1,3}\.\d\.\s+[A-ZÁÉÍÓÚÑ]"
    r"|Enunciados de la|Solución de la)|^[,z\d\s r]{1,8}$"
)


def column_view(page: dict, anchor_line: dict) -> dict:
    """The page restricted to the column the anchor sits in.

    On a two-column page the y-sorted line list alternates between columns, so
    every "what comes after this line" walk has to happen inside one column.
    """
    mid = page["width"] / 2
    crossing = sum(1 for l in page["lines"] if l["xmin"] < mid - 20 and l["xmax"] > mid + 20)
    if len(page["lines"]) < 12 or crossing > len(page["lines"]) * 0.12:
        return page
    left_side = anchor_line["xmin"] < mid
    kept = [l for l in page["lines"] if (l["xmin"] < mid) == left_side]
    return {**page, "lines": kept}


def column_right(page: dict, left: float) -> float:
    """Right edge of the column that starts at `left`.

    On a two-column page, mirroring the left margin across the full page would
    drag the neighbouring column into the crop, so stop at the gutter instead.
    """
    mid = page["width"] / 2
    crossing = sum(1 for l in page["lines"] if l["xmin"] < mid - 20 and l["xmax"] > mid + 20)
    two_column = len(page["lines"]) >= 12 and crossing <= len(page["lines"]) * 0.12
    if two_column:
        return (mid - 4) if left < mid else (page["width"] - 20)
    return page["width"] - max(0.0, left - 6)


def find_band(pages: list[dict], anchor: str) -> tuple[int, float, float, float, float]:
    """Locate (page_index, top, bottom, left, right) of the figure band for a question.

    `anchor` is a distinctive phrase from the question's statement.
    """
    needle = " ".join(anchor.split()).lower()
    for pidx, full_page in enumerate(pages):
        for anchor_line in full_page["lines"]:
            if needle not in " ".join(anchor_line["text"].split()).lower():
                continue
            page = column_view(full_page, anchor_line)
            lidx = page["lines"].index(anchor_line)
            line = anchor_line
            # Walk forward to the first alternative line — that closes the band.
            alt_idx = None
            for j in range(lidx + 1, min(lidx + 40, len(page["lines"]))):
                first_word = page["lines"][j]["text"].split(" ")[0] if page["lines"][j]["text"] else ""
                if ALT_RE.match(first_word) or re.match(r"^[A-E]\)\S", first_word):
                    alt_idx = j
                    break
            if alt_idx is None or alt_idx == lidx + 1:
                continue
            # Statement lines run from the question's left margin and read as prose;
            # figure content is centred (or short labels). Classify every line between
            # the anchor and the alternatives, then take the widest run of figure
            # lines — a statement line after the drawing closes the band just as the
            # alternatives would.
            margin = page["lines"][lidx]["xmin"]

            def is_statement(line: dict) -> bool:
                # Anything starting at the question's left margin is enunciado — even
                # a one-liner like "g = 9,81 m/s2", which is data, not a figure label.
                return line["xmin"] <= margin + 25 and len(line["text"]) > 2

            span = page["lines"][lidx : alt_idx + 1]
            # The drawing itself carries no text, so it shows up as the largest
            # vertical gap inside the question. Take that gap, then widen it over the
            # centred label lines that sit inside the figure.
            best = None
            for a, b in zip(span, span[1:]):
                gap = b["ymin"] - a["ymax"]
                if best is None or gap > best[0]:
                    best = (gap, a["ymax"], b["ymin"], span.index(a))
            if best is None or best[0] < 12:
                continue
            _, top, bottom, at = best
            for k in range(at, -1, -1):  # labels drawn above the gap
                if is_statement(span[k]):
                    break
                top = min(top, span[k]["ymin"] - 2)
            alt_top = span[-1]["ymin"]
            for k in range(at + 1, len(span)):  # labels drawn below it
                if is_statement(span[k]) or re.match(r"^[A-E]\)", span[k]["text"]):
                    break
                if alt_top - span[k]["ymin"] <= 30:
                    break  # stacked math belonging to the alternatives, not the figure
                bottom = max(bottom, span[k]["ymax"] + 2)

            # An alternative may be stacked math (a radical row, a numerator) drawn
            # ABOVE its own `A)` line — those belong to the alternatives, not the figure.
            for j in range(lidx + 1, alt_idx):
                line = page["lines"][j]
                if line["ymin"] > top and 0 < bottom - line["ymin"] <= 26:
                    bottom = min(bottom, line["ymin"])
            if bottom - top < 20:
                continue  # no room for a figure — the question is text-only
            left = min([l["xmin"] for l in page["lines"][lidx:alt_idx]] + [margin])
            return pidx, top, bottom, left, column_right(page, left)
    raise SystemExit(f"anchor not found (or no figure band): {anchor!r}")


def find_numbered(pages: list[dict], section_anchor: str, number: int) -> list[tuple[int, float, float, float, float]]:
    """Locate question `number` inside the section opened by `section_anchor`.

    Whole-question crops must be anchored by number, not by statement text: exams
    repeat wordings ("Indique la secuencia correcta...") across questions, and
    matching on text silently crops the wrong one.
    """
    needle = " ".join(section_anchor.split()).lower()
    started = False
    for pidx, full_page in enumerate(pages):
        for anchor_line in list(full_page["lines"]):
            flat = " ".join(anchor_line["text"].split())
            if not started:
                # The table of contents repeats every heading — its rows carry a dot
                # leader, so they are easy to reject. A heading like "2.1. Aritmética"
                # can also land as two bbox lines, so a bare "2.1." opens the section.
                if "..." in flat or re.search(r"\.( \.){3,}", flat):
                    continue  # a table-of-contents row, with either dot leader style
                if re.fullmatch(r"\d\.\d", needle):
                    started = bool(re.match(rf"^{re.escape(needle)}\.(\s|$)", flat))
                elif section_anchor.isupper():
                    # An all-caps course heading stands alone on its line; requiring an
                    # exact match keeps "Física y Química" in a contents row from opening it.
                    started = flat == section_anchor
                else:
                    started = needle in flat.lower()
                continue
            if not re.match(rf"^{number}\.\s+\S", flat):
                continue
            page = column_view(full_page, anchor_line)
            lidx = page["lines"].index(anchor_line)
            line = anchor_line
            # The question ends where the next number, or the next section, starts —
            # possibly only after a page break, so collect one segment per page.
            segments: list[tuple[int, float, float, float, float]] = []
            start_line = lidx
            for seg_page_idx in range(pidx, min(pidx + 3, len(pages))):
                seg_page = page if seg_page_idx == pidx else column_view(
                    pages[seg_page_idx], anchor_line)
                end_y = seg_page["height"]
                closed = False
                for j in range(start_line + (1 if seg_page_idx == pidx else 0), len(seg_page["lines"])):
                    nxt = " ".join(seg_page["lines"][j]["text"].split())
                    # Any following numbered line inside this column ends the
                    # question — the next one is not always `number + 1`, since a
                    # two-column page interleaves the two halves of the exam.
                    numbered = re.match(r"^(\d{1,3})\.\s+\S", nxt)
                    if ((numbered and int(numbered.group(1)) != number)
                            or re.match(r"^\d\.\d\.(\s|$)", nxt)
                            or nxt.startswith(("Enunciados de la", "Solución de la"))):
                        end_y = seg_page["lines"][j]["ymin"]
                        closed = True
                        break
                body = [l for l in seg_page["lines"][start_line:]
                        if l["ymin"] < end_y
                        and not FURNITURE_RE.match(" ".join(l["text"].split()))]
                if not body:
                    break
                seg_top = (line["ymin"] - 4) if seg_page_idx == pidx else min(l["ymin"] for l in body) - 4
                # When the next question closes the span, crop all the way down to it:
                # the last alternative is often a drawing whose box extends below the
                # text bbox of its own "E)" label.
                seg_bottom = (end_y - 8) if closed else (max(l["ymax"] for l in body) + 4)
                seg_left = min(l["xmin"] for l in body)
                segments.append((seg_page_idx, seg_top, seg_bottom,
                                 seg_left, column_right(seg_page, seg_left)))
                if closed:
                    break
                start_line = 0
            if not segments:
                continue
            return segments
    raise SystemExit(f"question {number} not found after section {section_anchor!r}")


def find_whole(pages: list[dict], anchor: str) -> tuple[int, float, float, float, float]:
    """Locate the whole question — statement plus alternatives — as one band.

    Used when the statement's math is too rich for `pdftotext` to transcribe
    faithfully; the question then ships as a single baked PNG (seed format B).
    """
    needle = " ".join(anchor.split()).lower()
    for pidx, page in enumerate(pages):
        for lidx, line in enumerate(page["lines"]):
            if needle not in " ".join(line["text"].split()).lower():
                continue
            # Alternatives may each be their own bbox line (stacked fractions), so
            # the question ends where the NEXT numbered question begins, not at the
            # last `A)`-looking line.
            saw_alt = False
            end = None
            for j in range(lidx + 1, min(lidx + 80, len(page["lines"]))):
                first = page["lines"][j]["text"].split(" ")[0] if page["lines"][j]["text"] else ""
                if re.match(r"^[A-E]\)", first):
                    saw_alt = True
                    continue
                if saw_alt and re.match(r"^\d{1,3}\.$", first):
                    end = j
                    break
            if not saw_alt:
                continue
            end = end if end is not None else min(lidx + 80, len(page["lines"]))
            top = page["lines"][lidx]["ymin"]
            bottom = max(l["ymax"] for l in page["lines"][lidx:end])
            xs = [l["xmin"] for l in page["lines"][lidx:end]]
            xe = [l["xmax"] for l in page["lines"][lidx:end]]
            return pidx, top - 3, bottom + 3, min(xs), max(xe)
    raise SystemExit(f"anchor not found for whole-question crop: {anchor!r}")


def crop(pdf: Path, page_idx: int, box: tuple[float, float, float, float],
         page_size: tuple[float, float], out: Path, dpi: int, pad: float,
         mode: str = "figure") -> None:
    top, bottom, left, right = box
    scale = dpi / 72.0
    tmp = out.parent / f".page-{page_idx + 1}"
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), "-f", str(page_idx + 1), "-l", str(page_idx + 1),
         "-singlefile", str(pdf), str(tmp)],
        check=True, capture_output=True,
    )
    src = tmp.with_suffix(".png")
    x = max(0, int((left - pad) * scale))
    y = max(0, int((top + (2 if mode == "figure" else 0)) * scale))
    w = int((right - left + 2 * pad) * scale)
    h = int((bottom - top - (4 if mode == "figure" else 0)) * scale)
    h = max(h, 1)
    subprocess.run(
        ["magick", str(src), "-crop", f"{w}x{h}+{x}+{y}", "+repage",
         "-bordercolor", "white", "-border", "8", str(out)],
        check=True, capture_output=True,
    )
    src.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--anchor", help="distinctive phrase from the statement (figure/whole modes)")
    ap.add_argument("--section-anchor", help="section heading text, for --mode numbered")
    ap.add_argument("--question", type=int, help="question number, for --mode numbered")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--pad", type=float, default=6.0, help="horizontal padding, in points")
    ap.add_argument("--pad-bottom", type=float, default=0.0,
                    help="extra points below the band, for figures that overlap the alternatives")
    ap.add_argument("--mode", choices=("figure", "whole", "numbered"), default="figure",
                    help="'figure' crops only the drawing; 'whole' bakes statement + alternatives")
    ap.add_argument("--list-only", action="store_true")
    args = ap.parse_args()

    pages = bbox_pages(args.pdf)
    if args.mode == "numbered":
        if args.question is None or not args.section_anchor:
            raise SystemExit("--mode numbered needs --section-anchor and --question")
        segments = find_numbered(pages, args.section_anchor, args.question)
        total = sum(b - t for _, t, b, _, _ in segments)
        if total < 40:
            raise SystemExit(f"question {args.question}: crop too short ({total:.0f}pt)")
        if not args.out:
            print(segments, file=sys.stderr)
            return
        parts = []
        for k, (spidx, t, b, l, r) in enumerate(segments):
            part = args.out.parent / f".part-{k}.png"
            crop(args.pdf, spidx, (t, b, l, r),
                 (pages[spidx]["width"], pages[spidx]["height"]), part, args.dpi, args.pad, "whole")
            parts.append(part)
        if len(parts) == 1:
            parts[0].replace(args.out)
        else:
            subprocess.run(["magick", *[str(p) for p in parts], "-background", "white",
                            "-gravity", "west", "-append", str(args.out)], check=True)
            for part in parts:
                part.unlink(missing_ok=True)
        print(f"wrote {args.out} ({len(parts)} page segment(s))", file=sys.stderr)
        return
    else:
        if not args.anchor:
            raise SystemExit(f"--mode {args.mode} needs --anchor")
        locate = find_whole if args.mode == "whole" else find_band
        pidx, top, bottom, left, right = locate(pages, args.anchor)
        bottom += args.pad_bottom
    print(f"page {pidx + 1}: y {top:.1f}..{bottom:.1f}  x {left:.1f}..{right:.1f}", file=sys.stderr)
    if args.list_only or not args.out:
        return
    crop(args.pdf, pidx, (top, bottom, left, right),
         (pages[pidx]["width"], pages[pidx]["height"]), args.out, args.dpi, args.pad, args.mode)
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
