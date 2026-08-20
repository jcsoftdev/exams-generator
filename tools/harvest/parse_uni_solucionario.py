#!/usr/bin/env python3
"""Parse an official UNI admission "solucionario" PDF into structured questions.

The PDFs published at https://admision.uni.edu.pe/descargas/ are LaTeX-built and
follow a stable shape:

    Parte I  — Enunciados      sections `1.1. Razonamiento Matemático`, `3.1. Física`, ...
    Parte II — Solución        sections `4.1. Raz. Matemático`, `6.1. Física`, ...

Answers live in the solution half, either as a `Respuesta X` line closing each
worked solution or as a compact `Pregunta / Clave` table for the sections that
are not worked out (Raz. Verbal, Humanidades).

Usage:
    parse_uni_solucionario.py <pdf> [--out out.json]

Emits `{ "source": ..., "sections": [ { "section", "title", "questions": [...] } ] }`
where every question carries `n`, `body`, `alternatives`, `answer` (letter) and
`hasFigureGap` — True when the enunciado text shows a vertical gap, i.e. the PDF
draws a figure there and the question needs an image crop before it can be used.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SECTION_RE = re.compile(r"^\s{0,12}(\d)\.(\d)\.\s{2,}([A-ZÁÉÍÓÚÑ][^\d]{2,30}?)\s*$")
QUESTION_RE = re.compile(r"^\s{0,5}(\d{1,3})\.\s+(\S.*)$")
ALT_RE = re.compile(r"^\s{0,8}([A-E])\)\s?(.*)$")
INLINE_ALTS_RE = re.compile(r"\bA\)\s.*\bB\)\s.*\bC\)\s")
ANSWER_RE = re.compile(r"Respuesta\s*:?\s*([A-E])\b")
KEY_ROW_RE = re.compile(r"^\s*(\d{1,3})\s+([A-E])\s*$")

# Page furniture that pdftotext keeps and we never want inside a question body.
NOISE_RES = [
    re.compile(r"^\s*Solucionario\s+ADMISI[ÓO]N\s+UNI", re.I),
    re.compile(r"^\s*CAP[ÍI]TULO\s+\d", re.I),
    re.compile(r"^\s*\d{1,3}\.\d\.\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .,]{4,}$"),
    re.compile(r"CAP[ÍI]TULO\s+\d"),
    re.compile(r"^\s*[a-zA-Z]?\d{1,3}\s*[a-zA-Z]?\s*$"),  # bare page numbers / "z24 r"
    re.compile(r"^\s*,\s*,\s*$"),
    re.compile(r"^\s*Parte\s+[IV]+\s*$", re.I),
]


def is_noise(line: str) -> bool:
    return any(rx.search(line) for rx in NOISE_RES)


def pdf_to_text(pdf: Path) -> list[str]:
    out = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True,
        text=True,
        check=False,
    )
    if not out.stdout:
        raise SystemExit(f"pdftotext produced nothing for {pdf}: {out.stderr[:300]}")
    return out.stdout.splitlines()


def split_sections(lines: list[str]) -> list[dict]:
    """Return the document's real sections, skipping the table of contents."""
    sections: list[dict] = []
    for idx, line in enumerate(lines):
        m = SECTION_RE.match(line)
        if not m:
            continue
        title = m.group(3).strip()
        if "." * 3 in line or title.endswith("."):
            continue  # a table-of-contents row
        if title.upper() == title and len(title) > 6:
            continue  # a running page header, not the real section opener
        sections.append(
            {"section": f"{m.group(1)}.{m.group(2)}", "title": title, "start": idx}
        )
    # Deduplicate repeated running headers: keep the first occurrence of each key.
    seen: set[str] = set()
    uniq = []
    for s in sections:
        key = s["section"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(s)
    for i, s in enumerate(uniq):
        s["end"] = uniq[i + 1]["start"] if i + 1 < len(uniq) else len(lines)
    return uniq


def parse_questions(block: list[str]) -> list[dict]:
    """Pull `N.` numbered questions with their A)-E) alternatives out of a block."""
    questions: list[dict] = []
    current: dict | None = None
    alt_key: str | None = None
    blank_run = 0

    def close() -> None:
        nonlocal current, alt_key
        if current is not None:
            current["body"] = "\n".join(current["_body"]).strip()
            del current["_body"]
            questions.append(current)
        current, alt_key = None, None

    for raw in block:
        if is_noise(raw):
            continue
        if not raw.strip():
            blank_run += 1
            if current is not None and alt_key is None:
                current["_gap"] = max(current.get("_gap", 0), blank_run)
            continue

        qm = QUESTION_RE.match(raw)
        # A question number only starts a new question when we are not mid-alternatives
        # of the previous one and the number moves forward.
        if qm and (current is None or (alt_key is not None and int(qm.group(1)) == current["n"] + 1)
                   or (alt_key is None and int(qm.group(1)) == current["n"] + 1)):
            close()
            current = {"n": int(qm.group(1)), "_body": [qm.group(2).strip()], "alternatives": {}}
            blank_run = 0
            continue

        if current is None:
            continue

        if INLINE_ALTS_RE.search(raw):
            parts = re.split(r"\s{2,}(?=[A-E]\))|(?<=\S)\s+(?=[B-E]\)\s)", raw.strip())
            for part in parts:
                pm = ALT_RE.match(part.strip())
                if pm:
                    current["alternatives"][pm.group(1)] = pm.group(2).strip()
            alt_key = max(current["alternatives"], default=None)
            blank_run = 0
            continue

        am = ALT_RE.match(raw)
        if am:
            alt_key = am.group(1)
            current["alternatives"][alt_key] = am.group(2).strip()
            blank_run = 0
            continue

        if alt_key is not None:
            current["alternatives"][alt_key] += " " + raw.strip()
        else:
            current["_body"].append(raw.strip())
        blank_run = 0

    close()
    return questions


def parse_answers(block: list[str]) -> dict[int, str]:
    """Answers from a solution block: `Respuesta X` per question, or a key table."""
    answers: dict[int, str] = {}

    # Compact `Pregunta / Clave` tables.
    for line in block:
        km = KEY_ROW_RE.match(line)
        if km:
            answers.setdefault(int(km.group(1)), km.group(2))

    # Worked solutions: track the current question number, take its `Respuesta X`.
    current: int | None = None
    for raw in block:
        if is_noise(raw):
            continue
        qm = QUESTION_RE.match(raw)
        if qm:
            n = int(qm.group(1))
            if current is None or n in (current + 1, current):
                current = n
        am = ANSWER_RE.search(raw)
        if am and current is not None:
            answers[current] = am.group(1)
    return answers


def parse(pdf: Path) -> dict:
    lines = pdf_to_text(pdf)
    sections = split_sections(lines)
    if not sections:
        raise SystemExit(f"no sections found in {pdf.name}")

    # Sections 1.x/2.x/3.x hold enunciados; 4.x/5.x/6.x hold the matching solutions,
    # offset by exactly 3 in the leading chapter number.
    by_key = {s["section"]: s for s in sections}
    out_sections = []
    for key, sec in by_key.items():
        chapter, sub = key.split(".")
        if int(chapter) > 3:
            continue
        sol = by_key.get(f"{int(chapter) + 3}.{sub}")
        if sol is None:
            continue
        questions = parse_questions(lines[sec["start"] + 1 : sec["end"]])
        answers = parse_answers(lines[sol["start"] + 1 : sol["end"]])
        for q in questions:
            q["answer"] = answers.get(q["n"])
            q["hasFigureGap"] = q.pop("_gap", 0) >= 3 or len(q["alternatives"]) < 4
        out_sections.append(
            {
                "section": key,
                "title": sec["title"],
                "solutionSection": f"{int(chapter) + 3}.{sub}",
                "questions": questions,
            }
        )
    return {"source": pdf.name, "sections": out_sections}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    data = parse(args.pdf)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf8")
        total = sum(len(s["questions"]) for s in data["sections"])
        keyed = sum(1 for s in data["sections"] for q in s["questions"] if q["answer"])
        print(f"{args.pdf.name}: {total} questions, {keyed} with an explicit key", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
