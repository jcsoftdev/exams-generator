import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";
import { flattenGradeScopedQuestions } from "../db/flatten-grade-scoped-questions";
import { prepareCollectedContent } from "../modules/bank/domain/prepare-collected-content";

const DATA_DIR = join(__dirname, "..", "db", "data");
const COLLECTED_DIR = join(DATA_DIR, "collected");
/**
 * `seed-collected-questions.ts` escapes the school-level `escolar-*.json`
 * files through the very same `prepareCollectedContent`, so their rows carry
 * the same damage and have to be repaired from the same source of truth.
 * Reading only `collected/` left every school question stuck with whatever
 * the escaper wrote on the day it was seeded.
 */
const SCHOOL_FILE_PREFIX = "escolar-";

interface CollectedEntry {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
}

interface CollectedData {
  readonly entries: readonly CollectedEntry[];
}

/**
 * Backfills onto already-seeded web-scraped rows whatever
 * `prepareCollectedContent` does at ingest today — Typst escaping first, and
 * since audit 2026-08-20 H2 the stripping of solution tails as well.
 *
 * Those rows stored raw scraped prose in `body_typst`/`alternatives`, which
 * `typst-template.ts` embeds verbatim — measured against the real binary,
 * 5.3% of the bank failed to compile outright and a further slice rendered
 * SILENTLY wrong (`34_(n) + 15_(n)` printing as "3 4 (n) + 1 5 (n)").
 *
 * Idempotent by construction: every value written is derived from the JSON
 * source files, never from what is currently in the column, so re-running
 * can never double-escape. That is also why rows are matched by `body_hash`
 * — it keys off the RAW statement (see `prepare-collected-content.ts`), so
 * it still matches rows whose stored body has already been rewritten by an
 * earlier run of this same script.
 *
 * Scope is deliberately narrow: `tenant_id IS NULL` (central bank only) AND
 * a hash present in the collected JSON, so tenant-authored questions — real
 * Typst markup, CeTZ figures — are never rewritten from a file they did not
 * come from.
 *
 * Re-running this is also how the escaper's own fixes reach rows already in
 * the bank. It is what repairs the statements whose `$...$` math the escaper
 * used to flatten into literal dollars (see `split-typst-math-spans.ts`):
 * the JSON always held the formula, only the column was wrong.
 */
/**
 * The same two sources `seed-collected-questions.ts` reads: the flat
 * preuniversitario bank under `data/collected/`, and the grade-scoped
 * school files in `data/` that `flattenGradeScopedQuestions` unnests.
 */
function readAllEntries(): CollectedEntry[] {
  const entries: CollectedEntry[] = [];

  for (const file of readdirSync(COLLECTED_DIR).filter((name) => name.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(COLLECTED_DIR, file), "utf8")) as CollectedData;
    entries.push(...(data.entries ?? []));
  }

  const school = readdirSync(DATA_DIR).filter(
    (name) => name.startsWith(SCHOOL_FILE_PREFIX) && name.endsWith(".json"),
  );
  for (const file of school) {
    entries.push(...flattenGradeScopedQuestions(JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"))));
  }

  return entries;
}

export async function normalizeCollectedContent(): Promise<{ updated: number; checked: number }> {
  let updated = 0;
  let checked = 0;

  for (const entry of readAllEntries()) {
    const content = prepareCollectedContent({
      bodyTypst: entry.bodyTypst,
      alternatives: entry.alternatives,
    });

    // Nothing to rewrite when the scrape held neither markup characters nor
    // a solution tail — the overwhelming majority of the bank. Skipping them
    // keeps this a few thousand UPDATEs instead of sixty-four thousand
    // no-op writes.
    const unchanged =
      content.bodyTypst === entry.bodyTypst &&
      content.alternatives.every((alternative, index) => alternative === entry.alternatives[index]);
    if (unchanged) {
      continue;
    }

    // The inequality guard is what makes this affordable to run on EVERY
    // boot (see `seed.ts`): after the first pass every row already matches,
    // so the statement touches nothing and the whole backfill costs one
    // cheap indexed lookup per entry instead of ~7.6k writes per deploy.
    const result = await db
      .update(questions)
      .set({ bodyTypst: content.bodyTypst, alternatives: content.alternatives })
      .where(
        and(
          isNull(questions.tenantId),
          eq(questions.bodyHash, content.bodyHash),
          or(
            ne(questions.bodyTypst, content.bodyTypst),
            ne(
              sql`${questions.alternatives}::text`,
              sql`${JSON.stringify(content.alternatives)}::jsonb::text`,
            ),
          ),
        ),
      )
      .returning({ id: questions.id });

    checked++;
    updated += result.length;
  }

  return { updated, checked };
}

if (require.main === module) {
  normalizeCollectedContent()
    .then(({ updated, checked }) => {
      console.log(
        `[normalize-collected-content] rewrote ${updated} rows of ${checked} entries needing a rewrite.`,
      );
    })
    .catch((error: unknown) => {
      console.error("[normalize-collected-content] failed:", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
