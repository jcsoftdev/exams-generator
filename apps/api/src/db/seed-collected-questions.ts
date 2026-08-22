import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Difficulty } from "@exams-generator/shared";
import { and, isNotNull, isNull } from "drizzle-orm";
import { CollectedEntry, flattenGradeScopedQuestions } from "./flatten-grade-scoped-questions";
import { findPrivateUseGlyph } from "../modules/bank/domain/find-private-use-glyph";
import { findUnescapedTypstMarkup } from "../modules/bank/domain/find-unescaped-typst-markup";
import { prepareCollectedContent } from "../modules/bank/domain/prepare-collected-content";
import { validateStructuredContent } from "../modules/bank/domain/validate-structured-content";
import { isGradeLevel } from "../modules/exams/domain/value-objects/grade-level";
import { db } from "./client";
import { courses, questions, topics } from "./schema";

const DATA_DIR = join(__dirname, "data");
const COLLECTED_DIR = join(DATA_DIR, "collected");
/**
 * School-level questions live one directory up, as `escolar-<course>-<grade>.json`,
 * in a grade-scoped shape rather than the flat one — see
 * `flatten-grade-scoped-questions.ts`.
 */
const SCHOOL_FILE_PREFIX = "escolar-";
const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

interface CollectedData {
  readonly entries: readonly CollectedEntry[];
}

/**
 * Every question file this seeder consumes, already normalized to flat
 * entries: the preuniversitario bank under `data/collected/`, plus the
 * school-level files in `data/` that no seeder had ever read.
 */
function readAllEntries(): { entries: CollectedEntry[]; fileCount: number } {
  const entries: CollectedEntry[] = [];
  let fileCount = 0;

  const collected = safeReaddir(COLLECTED_DIR).filter((name) => name.endsWith(".json"));
  for (const name of collected) {
    const data = JSON.parse(readFileSync(join(COLLECTED_DIR, name), "utf8")) as CollectedData;
    entries.push(...(data.entries ?? []));
    fileCount++;
  }

  const school = safeReaddir(DATA_DIR).filter(
    (name) => name.startsWith(SCHOOL_FILE_PREFIX) && name.endsWith(".json"),
  );
  for (const name of school) {
    const flattened = flattenGradeScopedQuestions(JSON.parse(readFileSync(join(DATA_DIR, name), "utf8")));
    entries.push(...flattened);
    fileCount++;
  }

  return { entries, fileCount };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Seeds the web-sourced structured questions collected under
 * `db/data/collected/*.json` directly via Drizzle — same insert shape and
 * same sha256(bodyTypst) dedup rule as `POST /bank/questions/structured`,
 * but run at deploy boot (before the Nest/HTTP app exists) instead of over
 * the network. Course/topic/hash lookups are preloaded once so a re-run
 * against an already-seeded DB costs ~3 queries total, not one query per
 * question — this runs on every boot via `seed.ts`, not just once.
 *
 * `tenant_id` is NULL for every central-bank row, and Postgres treats NULL
 * as distinct from NULL in unique indexes, so `questions_tenant_id_body_hash_idx`
 * never catches central-bank duplicates on its own — the explicit hash-set
 * check below is load-bearing, not a redundant safety net.
 *
 * Never throws: a malformed entry is logged and skipped so one bad question
 * can't fail app boot.
 */
export async function seedCollectedQuestions(createdBy: string): Promise<void> {
  const { entries: allEntries, fileCount } = readAllEntries();
  if (allEntries.length === 0) {
    return;
  }

  const courseRows = await db.select({ id: courses.id, name: courses.name }).from(courses);
  const courseIdsByName = new Map<string, string[]>();
  for (const row of courseRows) {
    courseIdsByName.set(row.name, [...(courseIdsByName.get(row.name) ?? []), row.id]);
  }

  const topicRows = await db
    .select({ id: topics.id, courseId: topics.courseId, name: topics.name, gradeLevel: topics.gradeLevel })
    .from(topics);
  const topicIdByKey = new Map<string, string>();
  for (const row of topicRows) {
    topicIdByKey.set(`${row.courseId}|${row.name}|${row.gradeLevel}`, row.id);
  }

  const existingHashRows = await db
    .select({ hash: questions.bodyHash })
    .from(questions)
    .where(and(isNull(questions.tenantId), isNotNull(questions.bodyHash)));
  const existingHashes = new Set(existingHashRows.map((row) => row.hash as string));

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let unprintable = 0;

  /**
   * Rows waiting to be written. The bank crossed 60k questions, and one
   * awaited INSERT per question is 60k sequential round-trips on every boot
   * — minutes of blocked startup against a remote database. This runs inside
   * our own deploy, with no rate limit to respect, so rows go out in chunks
   * instead. `BATCH_SIZE` stays well under Postgres' 65535-parameter cap:
   * ~13 columns per row leaves plenty of headroom at 1000.
   */
  const BATCH_SIZE = 1000;
  let pending: (typeof questions.$inferInsert)[] = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) {
      return;
    }
    const batch = pending;
    pending = [];
    try {
      await db.insert(questions).values(batch);
      ok += batch.length;
    } catch (error) {
      // One bad row must not cost the other 999. Retry the batch row by row
      // so the failure is attributed to the entry that actually caused it.
      console.error(
        `[seed-collected-questions] batch of ${batch.length} failed, retrying individually: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      for (const row of batch) {
        try {
          await db.insert(questions).values(row);
          ok++;
        } catch (rowError) {
          failed++;
          console.error(
            `[seed-collected-questions] FAIL ${row.sourceName ?? row.bodyHash}: ${
              rowError instanceof Error ? rowError.message : String(rowError)
            }`,
          );
        }
      }
    }
  };

  {
    for (const entry of allEntries) {
      const label = `${entry.gradeLevel}: ${entry.courseName} / ${entry.topicName} — ${entry.sourceName}`;
      try {
        const contentErrors = validateStructuredContent({
          bodyTypst: entry.bodyTypst,
          alternatives: entry.alternatives,
          correctAnswer: entry.correctAnswer,
        });
        if (contentErrors.length > 0) {
          throw new Error(contentErrors.join("; "));
        }
        if (!entry.difficulty || !VALID_DIFFICULTIES.has(entry.difficulty)) {
          throw new Error(`invalid difficulty: ${entry.difficulty}`);
        }
        if (!entry.gradeLevel || !isGradeLevel(entry.gradeLevel)) {
          throw new Error(`invalid gradeLevel: ${entry.gradeLevel}`);
        }

        const courseIds = courseIdsByName.get(entry.courseName);
        if (!courseIds || courseIds.length === 0) {
          throw new Error(`course not found: ${entry.courseName}`);
        }
        const topicId = courseIds
          .map((courseId) => topicIdByKey.get(`${courseId}|${entry.topicName}|${entry.gradeLevel}`))
          .find(Boolean);
        if (!topicId) {
          throw new Error(`topic not found: ${entry.topicName} (${entry.gradeLevel}) in ${entry.courseName}`);
        }

        // Scraped prose is NOT Typst markup — escape it before it ever
        // reaches a column the PDF template embeds verbatim. `bodyHash`
        // still keys off the RAW statement so this boot recognises the rows
        // seeded before escaping existed; see `prepare-collected-content.ts`.
        const content = prepareCollectedContent({
          bodyTypst: entry.bodyTypst,
          alternatives: entry.alternatives,
        });
        // Self-check on the escaper rather than a real compile: 64k entries
        // through the typst binary would add minutes to every boot. It has
        // already shipped with one gap (`/` opening a term list), so an entry
        // that still holds live markup is refused `approved` here instead of
        // failing an exam weeks later.
        const unescaped = [content.bodyTypst, ...content.alternatives]
          .map((value) => findUnescapedTypstMarkup(value))
          .find((found) => found !== undefined);
        if (unescaped !== undefined) {
          throw new Error(`unescaped Typst markup '${unescaped}' survived escaping`);
        }

        // Legacy Symbol-font codepoints print as tofu boxes and cannot be
        // translated back safely — see `find-private-use-glyph.ts`. Skipped
        // rather than thrown: this is a KNOWN, permanent property of ~60
        // source entries, so routing it through the failure path would log
        // sixty errors on every single boot and train everyone to ignore the
        // seeder's output. Counted separately and summarised once instead.
        const privateUse = [content.bodyTypst, ...content.alternatives]
          .map((value) => findPrivateUseGlyph(value))
          .find((found) => found !== undefined);
        if (privateUse !== undefined) {
          unprintable++;
          continue;
        }

        if (existingHashes.has(content.bodyHash)) {
          skipped++;
          continue;
        }

        pending.push({
          tenantId: null,
          type: "structured",
          topicId,
          difficulty: entry.difficulty as Difficulty,
          gradeLevel: entry.gradeLevel,
          status: "approved",
          bodyTypst: content.bodyTypst,
          bodyHash: content.bodyHash,
          alternatives: content.alternatives,
          correctAnswer: entry.correctAnswer,
          // Provenance was being parsed and then dropped. Without it the bank
          // cannot answer "which questions came from this source", which is
          // exactly what a licensing change asks.
          sourceUrl: entry.sourceUrl,
          sourceName: entry.sourceName,
          aiGenerated: false,
          createdBy,
        });
        // Added here, not after the write: two entries with the same statement
        // inside one batch would otherwise both pass the check and collide on
        // questions_tenant_id_body_hash_idx.
        existingHashes.add(content.bodyHash);
        if (pending.length >= BATCH_SIZE) {
          await flush();
        }
      } catch (error) {
        failed++;
        console.error(
          `[seed-collected-questions] FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  await flush();

  console.log(
    `[seed-collected-questions] ${ok} seeded, ${skipped} already existed, ${unprintable} unprintable, ${failed} failed (${fileCount} files).`,
  );
}
