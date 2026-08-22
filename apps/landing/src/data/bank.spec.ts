import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { bank, courses } from "./bank.ts";

/**
 * Guard against the failure this repo already lived through: the harvest grew
 * the central bank from ~1.1k to ~64k questions, and the landing page kept
 * advertising 1,066 — on a live domain — for two weeks. Nothing broke, nothing
 * failed, nobody noticed. A number with no test is a number that rots.
 *
 * Runs on `node --test` (built into Node >= 22, which this package already
 * requires) rather than pulling a test framework in for one file.
 *
 * These assertions deliberately split into two kinds:
 *
 *   - EXACT, for invariants internal to the published figures. They cost
 *     nothing and catch the half-update, where someone refreshes the headline
 *     and forgets the per-course breakdown.
 *   - BANDED, for the comparison against the seed corpus on disk. Exact
 *     equality would be wrong there: the seeder dedups by sha256(bodyTypst)
 *     and skips malformed entries, so the database always lands slightly under
 *     the raw file count. The band is wide enough to ignore that and narrow
 *     enough that a 60x drift cannot hide.
 */

const COLLECTED_DIR = fileURLToPath(new URL("../../../api/src/db/data/collected/", import.meta.url));

interface CollectedFile {
  readonly entries: readonly unknown[];
}

function readCorpus() {
  const files = readdirSync(COLLECTED_DIR).filter((name) => name.endsWith(".json"));
  let entries = 0;
  const courseSlugs = new Set<string>();
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(COLLECTED_DIR, file), "utf8")) as CollectedFile;
    entries += parsed.entries.length;
    // Filenames are `<courseSlug>__<topicSlug>.json`, one file per topic.
    courseSlugs.add(file.replace(/\.json$/, "").split("__")[0]);
  }
  return { entries, topicFiles: files.length, courses: courseSlugs.size };
}

describe("published bank figures", () => {
  it("labels the same number it publishes", () => {
    assert.equal(
      bank.questionsLabel,
      bank.questions.toLocaleString("en-US"),
      "questionsLabel and questions disagree — the visitor would read one number while the page means another",
    );
  });

  it("breaks down to exactly the published total", () => {
    const summed = courses.reduce((total, [, n]) => total + n, 0);
    assert.equal(
      summed,
      bank.questions,
      "the per-course breakdown does not sum to the headline figure — one of them was refreshed without the other",
    );
  });

  it("lists exactly as many courses as it claims", () => {
    assert.equal(courses.length, bank.courses);
  });

  it("stays within range of the seed corpus on disk", () => {
    const corpus = readCorpus();

    assert.equal(
      bank.topics,
      corpus.topicFiles,
      `published topic count (${bank.topics}) no longer matches the collected corpus (${corpus.topicFiles} topic files)`,
    );
    assert.equal(
      bank.courses,
      corpus.courses,
      `published course count (${bank.courses}) no longer matches the collected corpus (${corpus.courses})`,
    );

    // The seeder dedups and skips, so the DB lands at or just under the corpus.
    // Anything below 90% means the published figure was measured against a
    // materially smaller bank than the one that now ships.
    const ratio = bank.questions / corpus.entries;
    assert.ok(
      ratio > 0.9 && ratio <= 1,
      `published question count (${bank.questions}) is out of range for the ${corpus.entries} entries in the collected corpus ` +
        `(ratio ${ratio.toFixed(3)}, expected 0.9-1.0). Re-measure and update src/data/bank.ts — see apps/landing/README.md.`,
    );
  });
});
