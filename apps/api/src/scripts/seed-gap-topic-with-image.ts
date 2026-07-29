import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, topics, users } from "../db/schema";
import { TokenService } from "../modules/auth/token.service";
import { Role } from "@exams-generator/shared";

const BANK_SAMPLE_ADMIN_EMAIL = "bank-sample-seeder@exams-generator.internal";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3012";

/**
 * Seeds a handful of one-off `type: 'structured'` questions that each carry
 * a complement image (a chart/diagram that couldn't be authored in Typst) —
 * created via `POST /bank/questions/structured` then attached via
 * `POST /bank/questions/:id/image`, exactly like a real client using the
 * bank-new "Escribir pregunta" tab's optional image picker would.
 *
 * Data file shape: `{ entries: [{ courseName, topicName, gradeLevel,
 * bodyTypst, alternatives, correctAnswer, difficulty, imagePath, sourceUrl,
 * sourceName }] }`. `imagePath` is resolved relative to the data file's
 * own directory.
 */
interface GapEntry {
  readonly courseName: string;
  readonly topicName: string;
  readonly gradeLevel: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly difficulty: string;
  readonly imagePath: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
}

interface GapData {
  readonly entries: readonly GapEntry[];
}

async function main(): Promise<void> {
  const dataFileArg = process.argv[2];
  if (!dataFileArg) {
    throw new Error("Usage: seed-gap-topic-with-image.ts <path-to-gap-json>");
  }
  const dataPath = resolve(process.cwd(), dataFileArg);
  const dataDir = resolve(dataPath, "..");
  const data = JSON.parse(readFileSync(dataPath, "utf8")) as GapData;

  const [adminRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, BANK_SAMPLE_ADMIN_EMAIL));
  if (!adminRow) {
    throw new Error(`Platform-staff seed user '${BANK_SAMPLE_ADMIN_EMAIL}' not found — run 'pnpm --filter api db:seed' first.`);
  }
  const token = new TokenService().sign({ sub: adminRow.id, tenantId: null, role: Role.PlatformAdmin });

  let failures = 0;

  for (const entry of data.entries) {
    const label = `${entry.courseName} / ${entry.topicName} — ${entry.sourceName}`;
    try {
      const [courseRow] = await db.select({ id: courses.id }).from(courses).where(eq(courses.name, entry.courseName));
      if (!courseRow) {
        throw new Error(`Course '${entry.courseName}' not found`);
      }
      const [topicRow] = await db
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.courseId, courseRow.id), eq(topics.name, entry.topicName), eq(topics.gradeLevel, entry.gradeLevel)));
      if (!topicRow) {
        throw new Error(`Topic '${entry.topicName}' not found in course '${entry.courseName}'`);
      }

      const createResponse = await fetch(`${API_BASE_URL}/bank/questions/structured`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: courseRow.id,
          topicId: topicRow.id,
          difficulty: entry.difficulty,
          gradeLevel: entry.gradeLevel,
          bodyTypst: entry.bodyTypst,
          alternatives: entry.alternatives,
          correctAnswer: entry.correctAnswer,
        }),
      });
      if (!createResponse.ok) {
        throw new Error(`create HTTP ${createResponse.status}: ${await createResponse.text()}`);
      }
      const { id } = (await createResponse.json()) as { id: string };

      const imageBytes = readFileSync(resolve(dataDir, entry.imagePath));
      const form = new FormData();
      form.set("file", new Blob([imageBytes], { type: "image/png" }), "complement.png");

      const imageResponse = await fetch(`${API_BASE_URL}/bank/questions/${id}/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!imageResponse.ok) {
        throw new Error(`image-attach HTTP ${imageResponse.status}: ${await imageResponse.text()} (question ${id} was created without its image)`);
      }

      console.log(`OK   ${label} (question ${id})`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${data.entries.length - failures}/${data.entries.length} gap questions seeded successfully.`);
  await pool.end();
  process.exitCode = failures > 0 ? 1 : 0;
}

/* istanbul ignore next -- CLI entrypoint, exercised manually, not under unit test */
main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
