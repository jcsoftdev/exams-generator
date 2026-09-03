import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, topics, users } from "../db/schema";
import { TokenService } from "../modules/auth/token.service";
import { Role } from "@exams-generator/shared";

/** Must match `BANK_SAMPLE_ADMIN.email` in `db/seed.ts`. */
const BANK_SAMPLE_ADMIN_EMAIL = "bank-sample-seeder@exams-generator.internal";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3012";

/**
 * Seeds real, web-sourced (not AI-generated) `type: 'structured'` questions
 * into the CENTRAL bank (tenant_id NULL) via the real `bank` module HTTP
 * endpoint — `POST /bank/questions/structured` — exactly like a real client
 * would, so schema validation runs for real (unlike a direct DB insert).
 *
 * Generic over any `preuni-<course>-pilot.json` data file (path passed as
 * argv[2]) — one course per run. Topic names in the data file MUST match the
 * CANONICAL topic names in `db/data/canonical-taxonomy.json` (what
 * `reconcileLegacyTopics` leaves in the live `topics` table for
 * preuniversitario courses) — NOT the raw `PREUNI_SYLLABUS` labels, which
 * get folded/renamed during reconciliation (e.g. "Fracciones" ->
 * "Números Racionales").
 *
 * Prerequisites: `pnpm --filter api db:seed` must have run (creates the
 * course/topics/`BANK_SAMPLE_ADMIN` user) and the API must be reachable at
 * `API_BASE_URL`.
 *
 * Re-runnable: `POST /bank/questions/structured` rejects a `bodyTypst` that
 * already exists in the same bank with 409 (see `hashBodyTypst`), and this
 * script treats that as a skip, not a failure — safe to re-run after a
 * partial run (rate-limit, crash, etc.) without creating duplicates.
 */

interface PilotQuestion {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly difficulty: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
}

interface PilotTopic {
  readonly name: string;
  readonly questions: readonly PilotQuestion[];
}

interface PilotData {
  readonly courseName: string;
  readonly gradeLevel: string;
  readonly topics: readonly PilotTopic[];
}

interface SeedResult {
  readonly label: string;
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly error?: string;
}

async function main(): Promise<void> {
  const dataFileArg = process.argv[2];
  if (!dataFileArg) {
    throw new Error("Usage: seed-preuni-course.ts <path-to-pilot-json>");
  }
  const dataPath = resolve(process.cwd(), dataFileArg);
  const data = JSON.parse(readFileSync(dataPath, "utf8")) as PilotData;

  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, BANK_SAMPLE_ADMIN_EMAIL));

  if (!adminRow) {
    throw new Error(
      `Platform-staff seed user '${BANK_SAMPLE_ADMIN_EMAIL}' not found — run 'pnpm --filter api db:seed' first.`,
    );
  }

  const token = new TokenService().sign({
    sub: adminRow.id,
    tenantId: null,
    role: Role.PlatformAdmin,
  });

  // A course name can exist once per stage (escuela/colegio/preuniversitario);
  // topics for primaria_* live under the 'escuela' row and secundaria_* under
  // 'colegio', so the topic lookup must span every same-named course row.
  const courseRows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.name, data.courseName));

  if (courseRows.length === 0) {
    throw new Error(`Course '${data.courseName}' not found — run 'pnpm --filter api db:seed' first.`);
  }
  const courseIds = courseRows.map((row) => row.id);

  const results: SeedResult[] = [];

  for (const topic of data.topics) {
    const [topicRow] = await db
      .select({ id: topics.id, courseId: topics.courseId })
      .from(topics)
      .where(and(inArray(topics.courseId, courseIds), eq(topics.name, topic.name)));

    if (!topicRow) {
      for (const question of topic.questions) {
        const label = `${topic.name} — ${question.sourceName}`;
        results.push({
          label,
          ok: false,
          error: `Topic '${topic.name}' not found in course '${data.courseName}'`,
        });
        console.error(`FAIL ${label}: topic not found`);
      }
      continue;
    }

    for (const question of topic.questions) {
      const label = `${topic.name} — ${question.sourceName}`;
      try {
        const response = await fetch(`${API_BASE_URL}/bank/questions/structured`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            courseId: topicRow.courseId,
            topicId: topicRow.id,
            difficulty: question.difficulty,
            gradeLevel: data.gradeLevel,
            bodyTypst: question.bodyTypst,
            alternatives: question.alternatives,
            correctAnswer: question.correctAnswer,
          }),
        });

        if (response.status === 409) {
          results.push({ label, ok: true, skipped: true });
          console.log(`SKIP ${label} (already exists)`);
          continue;
        }

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`HTTP ${response.status}: ${body}`);
        }

        results.push({ label, ok: true });
        console.log(`OK   ${label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ label, ok: false, error: message });
        console.error(`FAIL ${label}: ${message}`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  console.log(
    `\n${data.courseName}: ${results.length - failed.length}/${results.length} questions seeded successfully` +
      (skipped.length > 0 ? ` (${skipped.length} already existed, skipped)` : "") +
      `.`,
  );
  if (failed.length > 0) {
    console.error(`${failed.length} failure(s):`, failed);
  }

  await pool.end();
  process.exitCode = failed.length > 0 ? 1 : 0;
}

/* istanbul ignore next -- CLI entrypoint, exercised manually, not under unit test */
main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
