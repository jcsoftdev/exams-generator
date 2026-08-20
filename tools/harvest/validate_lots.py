#!/usr/bin/env python3
"""Check harvested lots against everything the seeder will demand of them.

Run this before seeding a lot. It answers, per lot, whether every entry would
survive `seed-lot-questions.ts` and the bank's own validation — taxonomy names
that must match byte for byte, answers that must land inside the alternatives,
images that must exist on disk, and provenance that must be there, since it is
the only handle an image question has.

It also reports what the seeder would silently swallow: entries that collide on
the content hash (statement + figure) and would come back as a duplicate, and
PNGs on disk that no entry references.

Usage:
    validate_lots.py <taxonomy.json> <lot-dir> [<lot-dir> ...]
Exit status is 1 when any lot has an error.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

GRADE_LEVELS = {"pre"} | {f"primaria_{n}" for n in range(1, 7)} | {
    f"secundaria_{n}" for n in range(1, 6)
}
DIFFICULTIES = {"easy", "medium", "hard"}
LETTERS = "abcde"


def taxonomy_pairs(path: Path) -> set[tuple[str, str]]:
    data = json.loads(path.read_text())
    return {
        (course["course"], topic["name"])
        for course in data["courses"]
        for topic in course["topics"]
    }


def content_hash(body: str, image: Path | None) -> str:
    statement = body.strip()
    if image and image.exists():
        fingerprint = hashlib.sha256(image.read_bytes()).hexdigest()
        statement = f"{statement}\0figure:{fingerprint}"
    return hashlib.sha256(statement.encode()).hexdigest()


def check_entry(entry: dict, lot_dir: Path, valid: set[tuple[str, str]]) -> list[str]:
    problems: list[str] = []
    course, topic = entry.get("courseName"), entry.get("topicName")
    if (course, topic) not in valid:
        problems.append(f"taxonomy: '{course}' / '{topic}' is not in the canonical taxonomy")
    if entry.get("gradeLevel") not in GRADE_LEVELS:
        problems.append(f"gradeLevel: {entry.get('gradeLevel')!r}")
    if entry.get("difficulty") not in DIFFICULTIES:
        problems.append(f"difficulty: {entry.get('difficulty')!r}")
    if not (entry.get("sourceName") or "").strip():
        problems.append("sourceName is empty — nothing could dedupe this entry")

    image = entry.get("imagePath")
    if image and not (lot_dir / image).exists():
        problems.append(f"imagePath does not exist: {image}")

    body = (entry.get("bodyTypst") or "").strip()
    answer = entry.get("correctAnswer")
    if body:
        alternatives = entry.get("alternatives") or []
        if len(alternatives) < 2:
            problems.append(f"only {len(alternatives)} alternatives")
        if any(not str(a).strip() for a in alternatives):
            problems.append("an alternative is empty")
        if not (isinstance(answer, str) and answer.isdigit() and int(answer) < len(alternatives)):
            problems.append(f"correctAnswer {answer!r} is not an index into {len(alternatives)} alternatives")
    else:
        if not image:
            problems.append("neither a statement nor an image")
        if answer not in list(LETTERS):
            problems.append(f"correctAnswer {answer!r} is not a printed letter a-e")
    return problems


def main() -> int:
    valid = taxonomy_pairs(Path(sys.argv[1]))
    failed = False
    seen_hashes: dict[str, str] = {}
    seen_sources: dict[str, str] = {}

    for directory in sys.argv[2:]:
        lot_dir = Path(directory)
        # A lot's images are referenced from its `-image.json` sibling, so orphan
        # detection has to look at the directory as a whole, not one file.
        referenced_in_dir: set[str] = set()
        for path in sorted(lot_dir.glob("*.json")):
            if path.name in {"canonical-taxonomy.json"}:
                continue
            try:
                entries = json.loads(path.read_text()).get("entries", [])
            except (json.JSONDecodeError, KeyError):
                print(f"BAD  {path.name}: not a lot file")
                failed = True
                continue
            if not entries:
                continue

            problems: Counter[str] = Counter()
            examples: dict[str, str] = {}
            collisions = 0
            cross_lot: list[str] = []

            for entry in entries:
                for problem in check_entry(entry, lot_dir, valid):
                    key = problem.split(":")[0]
                    problems[key] += 1
                    examples.setdefault(key, problem)

                if entry.get("imagePath"):
                    referenced_in_dir.add(entry["imagePath"])

                source = entry.get("sourceName") or ""
                if source in seen_sources and seen_sources[source] != path.name:
                    cross_lot.append(source)
                seen_sources.setdefault(source, path.name)

                body = (entry.get("bodyTypst") or "").strip()
                if body:
                    image = lot_dir / entry["imagePath"] if entry.get("imagePath") else None
                    digest = content_hash(body, image)
                    if digest in seen_hashes:
                        collisions += 1
                    seen_hashes.setdefault(digest, path.name)

            status = "OK  " if not problems else "FAIL"
            if problems:
                failed = True
            print(f"{status} {path.name:<44} {len(entries):5d} entries")
            for key, count in problems.most_common():
                print(f"       {count:5d} x {examples[key]}")
            if collisions:
                print(f"       {collisions:5d} x would come back as a duplicate (same statement AND figure)")
            if cross_lot:
                print(f"       {len(cross_lot):5d} x sourceName also used by another lot")


        for sibling in sorted(lot_dir.glob("*-image")) + sorted(lot_dir.glob("*-figures")):
            if not sibling.is_dir():
                continue
            on_disk = {f"{sibling.name}/{png.name}" for png in sibling.glob("*.png")}
            orphans = on_disk - referenced_in_dir
            if orphans:
                print(f"ORPH {sibling.name}: {len(orphans)} PNG that no entry references")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
