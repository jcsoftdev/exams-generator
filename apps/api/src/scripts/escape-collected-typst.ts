import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";
import { prepareCollectedContent } from "../modules/bank/domain/prepare-collected-content";

const COLLECTED_DIR = join(__dirname, "..", "db", "data", "collected");

interface CollectedEntry {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
}

interface CollectedData {
  readonly entries: readonly CollectedEntry[];
}

/**
 * Backfills the Typst escaping that `seed-collected-questions.ts` now applies
 * at ingest onto the web-scraped rows seeded BEFORE it existed.
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
 * a hash present in the collected JSON. AI-authored questions are real Typst
 * markup — `$x^2$`, CeTZ figures — and escaping them would destroy exactly
 * the content the escape is meant to protect.
 */
export async function escapeCollectedTypst(): Promise<{ updated: number; checked: number }> {
  const files = readdirSync(COLLECTED_DIR).filter((name) => name.endsWith(".json"));

  let updated = 0;
  let checked = 0;

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(COLLECTED_DIR, file), "utf8")) as CollectedData;

    for (const entry of data.entries) {
      const content = prepareCollectedContent({
        bodyTypst: entry.bodyTypst,
        alternatives: entry.alternatives,
      });

      // Nothing to rewrite when the scrape held no markup characters at all
      // — the overwhelming majority of the bank. Skipping them keeps this a
      // few thousand UPDATEs instead of sixty-four thousand no-op writes.
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
              ne(sql`${questions.alternatives}::text`, sql`${JSON.stringify(content.alternatives)}::jsonb::text`),
            ),
          ),
        )
        .returning({ id: questions.id });

      checked++;
      updated += result.length;
    }
  }

  return { updated, checked };
}

if (require.main === module) {
  escapeCollectedTypst()
    .then(({ updated, checked }) => {
      console.log(`[escape-collected-typst] ${updated} rows escaped of ${checked} entries needing escaping.`);
    })
    .catch((error: unknown) => {
      console.error("[escape-collected-typst] failed:", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
