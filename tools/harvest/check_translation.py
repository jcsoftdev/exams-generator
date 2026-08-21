#!/usr/bin/env python3
"""Compare a translated lot against its original, structurally.

Translation is where a question quietly stops being the question the source
published: an alternative gets reordered and the key now points elsewhere, a
number drifts, a formula gets "tidied". None of that is visible by reading the
Spanish on its own — it only shows against the original.

Checks, per entry and in order:
  - the entry count and the order are unchanged
  - `correctAnswer`, `courseName`, `topicName`, `gradeLevel`, `difficulty`,
    `sourceUrl` and the alternative count are untouched
  - every number in the statement and in each alternative survives, as a multiset
  - every `$...$` math span survives verbatim
  - the text actually changed (a "translation" identical to the source is a
    batch that was skipped)

Usage:
    check_translation.py <original.json> <translated.json>
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")
MATH_RE = re.compile(r"\$[^$]*\$")
FROZEN = ("correctAnswer", "courseName", "topicName", "gradeLevel", "difficulty", "sourceUrl")


def numbers(text: str) -> Counter:
    return Counter(n.replace(",", ".") for n in NUMBER_RE.findall(text))


def main() -> int:
    original = json.loads(Path(sys.argv[1]).read_text())["entries"]
    translated = json.loads(Path(sys.argv[2]).read_text())["entries"]

    problems: list[str] = []
    if len(original) != len(translated):
        print(f"FAIL entry count: {len(original)} original vs {len(translated)} translated")
        return 1

    unchanged_text = 0
    for i, (src, dst) in enumerate(zip(original, translated)):
        where = f"[{i}] {src.get('sourceName', '')[:60]}"
        for field in FROZEN:
            if src.get(field) != dst.get(field):
                problems.append(f"{where}: {field} changed ({src.get(field)!r} -> {dst.get(field)!r})")

        src_alts, dst_alts = src.get("alternatives", []), dst.get("alternatives", [])
        if len(src_alts) != len(dst_alts):
            problems.append(f"{where}: {len(src_alts)} alternatives became {len(dst_alts)}")
            continue

        for label, a, b in [("body", src.get("bodyTypst", ""), dst.get("bodyTypst", ""))] + [
            (f"alt{j}", a, b) for j, (a, b) in enumerate(zip(src_alts, dst_alts))
        ]:
            if numbers(a) != numbers(b):
                lost = numbers(a) - numbers(b)
                gained = numbers(b) - numbers(a)
                problems.append(f"{where}: {label} numbers differ (lost {dict(lost)}, gained {dict(gained)})")
            if MATH_RE.findall(a) != MATH_RE.findall(b):
                problems.append(f"{where}: {label} math spans differ")

        if src.get("bodyTypst") == dst.get("bodyTypst") and src.get("bodyTypst"):
            unchanged_text += 1

    for problem in problems[:25]:
        print(f"  {problem}")
    if len(problems) > 25:
        print(f"  ...and {len(problems) - 25} more")

    print(
        f"{'FAIL' if problems else 'OK  '} {Path(sys.argv[2]).name}: "
        f"{len(translated)} entries, {len(problems)} problems, "
        f"{unchanged_text} statements identical to the original"
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
