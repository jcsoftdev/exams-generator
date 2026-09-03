import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, topics, users } from "../db/schema";
import { TokenService } from "../modules/auth/token.service";
import { Role } from "@exams-generator/shared";

const BANK_SAMPLE_ADMIN_EMAIL = "bank-sample-seeder@exams-generator.internal";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3012";

/**
 * Seeds `type: 'image'` questions — the whole statement + alternatives are
 * baked into a single raster image (e.g. a cropped scanned exam page), and
 * only the answer key (a letter, matching the printed alternatives) is
 * stored separately. Created via `POST /bank/questions/image` exactly like
 * a real client using the bank-new "Foto de pregunta" tab would.
 *
 * Data file shape: `{ entries: [{ courseName, topicName, gradeLevel,
 * difficulty, correctAnswer, imagePath, sourceUrl, sourceName }] }`.
 * `imagePath` is resolved relative to the data file's own directory.
 * `correctAnswer` is a lowercase letter (a-e) matching the image's own
 * lettered alternatives — NOT a 0-based index (that convention is only for
 * `type: 'structured'`).
 */
interface ImageEntry {
  readonly courseName: string;
  readonly topicName: string;
  readonly gradeLevel: string;
  readonly difficulty: string;
  readonly correctAnswer: string;
  readonly imagePath: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
}

interface ImageData {
  readonly entries: readonly ImageEntry[];
}

async function main(): Promise<void> {
  const dataFileArg = process.argv[2];
  if (!dataFileArg) {
    throw new Error("Usage: seed-image-question.ts <path-to-image-entries-json>");
  }
  const dataPath = resolve(process.cwd(), dataFileArg);
  const dataDir = resolve(dataPath, "..");
  const data = JSON.parse(readFileSync(dataPath, "utf8")) as ImageData;

  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, BANK_SAMPLE_ADMIN_EMAIL));
  if (!adminRow) {
    throw new Error(
      `Platform-staff seed user '${BANK_SAMPLE_ADMIN_EMAIL}' not found — run 'pnpm --filter api db:seed' first.`,
    );
  }
  const token = new TokenService().sign({ sub: adminRow.id, tenantId: null, role: Role.PlatformAdmin });

  let failures = 0;
  // A 409 means the question is already in this bank (matched on its provenance
  // string) — a re-run of a partially finished seeding, not a failure.
  let skipped = 0;

  for (const entry of data.entries) {
    const label = `${entry.courseName} / ${entry.topicName} — ${entry.sourceName}`;
    try {
      // A course name can exist once per stage (escuela/colegio/preuniversitario);
      // topics for primaria_* live under 'escuela', secundaria_*/pre under
      // 'colegio'/'preuniversitario' — the topic lookup must span every
      // same-named course row (same fix as seed-preuni-course.ts).
      const courseRows = await db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.name, entry.courseName));
      if (courseRows.length === 0) {
        throw new Error(`Course '${entry.courseName}' not found`);
      }
      const courseIds = courseRows.map((row) => row.id);
      const [topicRow] = await db
        .select({ id: topics.id, courseId: topics.courseId })
        .from(topics)
        .where(and(inArray(topics.courseId, courseIds), eq(topics.name, entry.topicName)));
      if (!topicRow) {
        throw new Error(`Topic '${entry.topicName}' not found in course '${entry.courseName}'`);
      }

      const imageBytes = readFileSync(resolve(dataDir, entry.imagePath));
      const form = new FormData();
      form.set("courseId", topicRow.courseId);
      form.set("topicId", topicRow.id);
      form.set("difficulty", entry.difficulty);
      form.set("gradeLevel", entry.gradeLevel);
      form.set("correctAnswer", entry.correctAnswer);
      // An image question has no statement, so its provenance string is the ONLY
      // handle the bank has on where it came from — and the only key a re-seed
      // can dedupe it by.
      form.set("sourceUrl", entry.sourceUrl);
      form.set("sourceName", entry.sourceName);
      form.set("image", new Blob([imageBytes], { type: "image/png" }), "question.png");

      const response = await fetch(`${API_BASE_URL}/bank/questions/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (response.status === 409) {
        skipped++;
        console.log(`SKIP ${label} (already exists)`);
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const { id } = (await response.json()) as { id: string };
      console.log(`OK   ${label} (question ${id})`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const seeded = data.entries.length - failures - skipped;
  console.log(
    `\n${seeded}/${data.entries.length} image questions seeded successfully` +
      (skipped > 0 ? ` (${skipped} already present)` : "") +
      ".",
  );
  await pool.end();
  process.exitCode = failures > 0 ? 1 : 0;
}

/* istanbul ignore next -- CLI entrypoint, exercised manually, not under unit test */
main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
