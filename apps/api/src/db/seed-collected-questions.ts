import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Difficulty } from "@exams-generator/shared";
import { and, isNotNull, isNull } from "drizzle-orm";
import { hashBodyTypst } from "../modules/bank/domain/hash-body-typst";
import { validateStructuredContent } from "../modules/bank/domain/validate-structured-content";
import { isGradeLevel } from "../modules/exams/domain/value-objects/grade-level";
import { db } from "./client";
import { courses, questions, topics } from "./schema";

const COLLECTED_DIR = join(__dirname, "data", "collected");
const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

interface CollectedEntry {
  readonly courseName: string;
  readonly topicName: string;
  readonly gradeLevel: string;
  readonly difficulty: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
}

interface CollectedData {
  readonly entries: readonly CollectedEntry[];
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
  let files: string[];
  try {
    files = readdirSync(COLLECTED_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  if (files.length === 0) {
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

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(COLLECTED_DIR, file), "utf8")) as CollectedData;

    for (const entry of data.entries) {
      const label = `${file}: ${entry.courseName} / ${entry.topicName} — ${entry.sourceName}`;
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
        const topicId = courseIds.map((courseId) => topicIdByKey.get(`${courseId}|${entry.topicName}|${entry.gradeLevel}`)).find(Boolean);
        if (!topicId) {
          throw new Error(`topic not found: ${entry.topicName} (${entry.gradeLevel}) in ${entry.courseName}`);
        }

        const bodyHash = hashBodyTypst(entry.bodyTypst);
        if (existingHashes.has(bodyHash)) {
          skipped++;
          continue;
        }

        await db.insert(questions).values({
          tenantId: null,
          type: "structured",
          topicId,
          difficulty: entry.difficulty as Difficulty,
          gradeLevel: entry.gradeLevel,
          status: "approved",
          bodyTypst: entry.bodyTypst,
          bodyHash,
          alternatives: entry.alternatives,
          correctAnswer: entry.correctAnswer,
          aiGenerated: false,
          createdBy,
        });
        existingHashes.add(bodyHash);
        ok++;
      } catch (error) {
        failed++;
        console.error(`[seed-collected-questions] FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`[seed-collected-questions] ${ok} seeded, ${skipped} already existed, ${failed} failed (${files.length} files).`);
}
