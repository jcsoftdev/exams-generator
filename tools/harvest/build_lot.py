#!/usr/bin/env python3
"""Build the seed JSON lots for one parsed UNI solucionario.

Reads the `--parsed` output of `parse_uni_solucionario.py` and writes:

  <data>/<lot>.json          structured questions (format A), some with a figure
  <data>/<lot>-image.json    whole-question PNGs (format B)
  <data>/<lot>-figures/      the cropped figures
  <data>/<lot>-image/        the baked question images

A question becomes an image when its text cannot be trusted: a missing
alternative, or math that `pdftotext` mangles. Everything else stays text, which
is searchable and re-typesettable.

Course and topic come from `classify_topics.py`; run with `--dry-run` first and
read the printed assignments before seeding — the classifier is a suggestion.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify_topics import classify, classify_course  # noqa: E402

CROP = Path(__file__).resolve().parent / "crop_pdf_figures.py"

SLUG = {"Aritmética": "arit", "Álgebra": "alg", "Geometría": "geo",
        "Trigonometría": "trig", "Física": "fis", "Química": "quim",
        "Razonamiento Matemático": "rm"}

# A crop is anchored on the ENUNCIADO heading. In the `x.y` layout that is the
# section number; in the chaptered layout the enunciado side spells the course in
# caps while the parsed section carries the solution-side title, and anchoring on
# the latter silently crops worked solutions instead of questions.
ENUNCIADO_HEADING = {
    "Matemáticas": "MATEMÁTICA", "Matemática": "MATEMÁTICA",
    "Física": "FÍSICA", "Química": "QUÍMICA", "Aritmética": "ARITMÉTICA",
    "Álgebra": "ÁLGEBRA", "Geometría": "GEOMETRÍA", "Trigonometría": "TRIGONOMETRÍA",
}


def section_anchor(section: dict) -> str:
    key = section["section"]
    return key if re.fullmatch(r"\d\.\d", key) else ENUNCIADO_HEADING.get(key, key.upper())

# `pdftotext` loses superscripts and splits decimals; fix only the certain cases.
FIGURE_HINT = re.compile(
    r"\b(figura|gr[aá]fico|circuito|sistema mostrado|mostrada|se muestra|tabla adjunta)\b", re.I
)


def _fold_ascii(text: str) -> str:
    """Accent-free lowercase, so generated file names stay ASCII."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def normalize(text: str) -> str:
    text = text.replace("ı́", "í").replace("ı", "i").replace("◦", "°")
    text = re.sub(r"(\d),\s(\d)", r"\1,\2", text)
    return " ".join(text.split()).strip()


def build(parsed: dict, pdf: Path, lot: str, data_dir: Path, source_url: str,
          exam_label: str, dry_run: bool,
          all_images: bool = False) -> tuple[list[dict], list[dict], list[tuple]]:
    structured: list[dict] = []
    images: list[dict] = []
    skipped: list[tuple] = []

    for sec in parsed["sections"]:
        for q in sec["questions"]:
            if not q["answer"]:
                skipped.append((sec["title"], q["n"], "no published key"))
                continue
            body = normalize(q["body"].replace("\n", " "))
            course = sec["title"]
            if course in ("Matemáticas", "Matemática"):
                course = classify_course(body)
            if course not in SLUG:
                skipped.append((sec["title"], q["n"], f"course '{course}' not harvested"))
                continue
            topic = classify(course, body)
            letter = q["answer"].lower()
            name = (f"UNI — {exam_label}, {sec['title']}, pregunta {q['n']} "
                    f"(clave {letter.upper()})")
            block = _fold_ascii(sec["title"])[:3]
            slug = f"{SLUG[course]}-{lot}-{block}-{q['n']:02d}"
            alternatives = [normalize(q["alternatives"].get(k, "")) for k in "ABCDE"]
            needs_image = all_images or any(not a for a in alternatives)

            if dry_run:
                (images if needs_image else structured).append(
                    {"courseName": course, "topicName": topic, "n": q["n"],
                     "sourceName": name, "bodyTypst": body[:90]}
                )
                continue

            def whole_crop() -> bool:
                out = data_dir / f"{lot}-image" / f"{slug}.png"
                cmd = ["python3", str(CROP), str(pdf), "--mode", "numbered",
                       "--section-anchor", section_anchor(sec), "--question", str(q["n"]),
                       "--out", str(out), "--dpi", "300"]
                if subprocess.run(cmd, capture_output=True).returncode != 0:
                    return False
                images.append({
                    "courseName": course, "topicName": topic, "gradeLevel": "pre",
                    "difficulty": "hard", "correctAnswer": letter,
                    "imagePath": f"{lot}-image/{slug}.png",
                    "sourceUrl": source_url, "sourceName": name,
                })
                return True

            if needs_image:
                if not whole_crop():
                    skipped.append((sec["title"], q["n"], "empty alternative, crop failed"))
                continue

            entry = {
                "courseName": course, "topicName": topic, "gradeLevel": "pre",
                "difficulty": "hard", "bodyTypst": body, "alternatives": alternatives,
                "correctAnswer": str("ABCDE".index(q["answer"])),
                "sourceUrl": source_url, "sourceName": name,
            }
            if FIGURE_HINT.search(body):
                out = data_dir / f"{lot}-figures" / f"{slug}.png"
                anchor = " ".join(body.split()[:7])
                cmd = ["python3", str(CROP), str(pdf), "--anchor", anchor, "--out", str(out)]
                if subprocess.run(cmd, capture_output=True).returncode == 0:
                    entry["imagePath"] = f"{lot}-figures/{slug}.png"
                    entry["bodyTypst"] += "\n\n(Ver la figura adjunta.)"
                elif not whole_crop():
                    skipped.append((sec["title"], q["n"], "figure question, no usable crop"))
                    continue
                else:
                    continue
            structured.append(entry)

    return structured, images, skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsed", type=Path, required=True)
    ap.add_argument("--pdf", type=Path, required=True)
    ap.add_argument("--lot", required=True, help="lot slug, e.g. uni-2019-2")
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--source-url", required=True)
    ap.add_argument("--exam-label", required=True, help="e.g. 'Examen de Admisión 2019-2'")
    ap.add_argument("--dry-run", action="store_true", help="print assignments, write nothing")
    ap.add_argument("--all-images", action="store_true",
                    help="bake every question as a PNG — for PDFs whose symbol fonts "
                         "pdftotext transcribes wrongly")
    args = ap.parse_args()

    parsed = json.loads(args.parsed.read_text())
    structured, images, skipped = build(
        parsed, args.pdf, args.lot, args.data_dir, args.source_url, args.exam_label,
        args.dry_run, args.all_images
    )

    if args.dry_run:
        for e in sorted(structured + images, key=lambda e: (e["courseName"], e["n"])):
            print(f"{e['courseName']:<16} {e['topicName']:<45} {e['bodyTypst'][:70]}")
    else:
        (args.data_dir / f"{args.lot}.json").write_text(
            json.dumps({"entries": structured}, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        (args.data_dir / f"{args.lot}-image.json").write_text(
            json.dumps({"entries": images}, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(f"structured={len(structured)} image={len(images)} skipped={len(skipped)}", file=sys.stderr)
    for sec, n, why in skipped:
        print(f"  SKIP {sec} {n}: {why}", file=sys.stderr)


if __name__ == "__main__":
    main()
