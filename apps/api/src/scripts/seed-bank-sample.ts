import "reflect-metadata";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Role } from "@exams-generator/shared";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, topics, users } from "../db/schema";
import { TokenService } from "../modules/auth/token.service";

/** Must match `BANK_SAMPLE_ADMIN.email` in `db/seed.ts`. */
const BANK_SAMPLE_ADMIN_EMAIL = "bank-sample-seeder@exams-generator.internal";

/**
 * Seeds the 71 real image-type sample questions (grade level "pre") into the
 * CENTRAL bank (tenant_id NULL) via the real `bank` module HTTP endpoint —
 * `POST /bank/questions/image` — exactly like a real client would, so the
 * upload -> MinIO -> assets/questions flow is exercised end to end.
 *
 * Prerequisites (both idempotent, run automatically as part of `db:seed`):
 * 1. `pnpm --filter api db:seed` — creates the "Biología" and "Comunicación"
 *    courses + their topics (see `BANK_SAMPLE_COURSES` in `db/seed.ts`).
 * 2. The API must be reachable at `API_BASE_URL` (defaults to the
 *    docker-compose `api` service on `http://localhost:3012`).
 *
 * Re-runnable: `POST /bank/questions/image` has no dedupe key, so running
 * this script twice creates duplicate questions. It is NOT idempotent by
 * design (unlike `db/seed.ts`) — only run it once per environment, or clean
 * up `questions`/`assets` first.
 */

interface ClassificationEntry {
  readonly file: string;
  readonly question_number: number;
  readonly correct_answer: string;
  readonly topic: string;
  readonly difficulty: string;
}

interface Classification {
  readonly grade_level: string;
  readonly biologia: readonly ClassificationEntry[];
  readonly comunicacion: readonly ClassificationEntry[];
}

interface SectionConfig {
  readonly key: "biologia" | "comunicacion";
  readonly courseName: string;
  readonly folder: string;
}

const BANK_QUESTIONS_DIR = resolve(__dirname, "../../../../bank-questions");
const CLASSIFICATION_PATH = resolve(BANK_QUESTIONS_DIR, "classification.json");
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3012";

const SECTIONS: readonly SectionConfig[] = [
  { key: "biologia", courseName: "Biología", folder: "biologia" },
  { key: "comunicacion", courseName: "Comunicación", folder: "COMUNICACION" },
];

interface SeedResult {
  readonly file: string;
  readonly ok: boolean;
  readonly error?: string;
}

async function main(): Promise<void> {
  if (!existsSync(CLASSIFICATION_PATH)) {
    throw new Error(`Classification file not found at ${CLASSIFICATION_PATH}`);
  }
  const classification = JSON.parse(readFileSync(CLASSIFICATION_PATH, "utf8")) as Classification;

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

  const results: SeedResult[] = [];

  for (const section of SECTIONS) {
    const [courseRow] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.name, section.courseName));

    if (!courseRow) {
      throw new Error(`Course '${section.courseName}' not found — run 'pnpm --filter api db:seed' first.`);
    }

    for (const entry of classification[section.key]) {
      const label = `${section.folder}/${entry.file}`;
      try {
        const [topicRow] = await db
          .select({ id: topics.id })
          .from(topics)
          .where(and(eq(topics.courseId, courseRow.id), eq(topics.name, entry.topic)));

        if (!topicRow) {
          throw new Error(`Topic '${entry.topic}' not found for course '${section.courseName}'`);
        }

        const imagePath = resolve(BANK_QUESTIONS_DIR, section.folder, entry.file);
        const imageBuffer = readFileSync(imagePath);

        const form = new FormData();
        form.set("courseId", courseRow.id);
        form.set("topicId", topicRow.id);
        form.set("difficulty", entry.difficulty);
        form.set("gradeLevel", classification.grade_level);
        form.set("correctAnswer", entry.correct_answer);
        form.set("image", new Blob([imageBuffer], { type: "image/png" }), entry.file);

        const response = await fetch(`${API_BASE_URL}/bank/questions/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`HTTP ${response.status}: ${body}`);
        }

        results.push({ file: label, ok: true });
        // eslint-disable-next-line no-console
        console.log(`OK   ${label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ file: label, ok: false, error: message });
        // eslint-disable-next-line no-console
        console.error(`FAIL ${label}: ${message}`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\n${results.length - failed.length}/${results.length} questions seeded successfully.`);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`${failed.length} failure(s):`, failed);
  }

  await pool.end();
  process.exitCode = failed.length > 0 ? 1 : 0;
}

/* istanbul ignore next -- CLI entrypoint, exercised manually, not under unit test */
main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
