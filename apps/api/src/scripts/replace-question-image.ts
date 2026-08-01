import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { users } from "../db/schema";
import { TokenService } from "../modules/auth/token.service";
import { Role } from "@exams-generator/shared";

const BANK_SAMPLE_ADMIN_EMAIL = "bank-sample-seeder@exams-generator.internal";
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3012";

/**
 * Swaps the backing image of already-created questions via
 * `POST /bank/questions/:id/image` (field name `file`), for cases where the
 * question exists but its image needs replacing (e.g. a tighter re-crop).
 *
 * Data file shape: `{ entries: [{ questionId, imagePath }] }`. `imagePath`
 * is resolved relative to the data file's own directory.
 */
interface ReplaceEntry {
  readonly questionId: string;
  readonly imagePath: string;
}

interface ReplaceData {
  readonly entries: readonly ReplaceEntry[];
}

async function main(): Promise<void> {
  const dataFileArg = process.argv[2];
  if (!dataFileArg) {
    throw new Error("Usage: replace-question-image.ts <path-to-replace-json>");
  }
  const dataPath = resolve(process.cwd(), dataFileArg);
  const dataDir = resolve(dataPath, "..");
  const data = JSON.parse(readFileSync(dataPath, "utf8")) as ReplaceData;

  const [adminRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, BANK_SAMPLE_ADMIN_EMAIL));
  if (!adminRow) {
    throw new Error(`Platform-staff seed user '${BANK_SAMPLE_ADMIN_EMAIL}' not found — run 'pnpm --filter api db:seed' first.`);
  }
  const token = new TokenService().sign({ sub: adminRow.id, tenantId: null, role: Role.PlatformAdmin });

  let failures = 0;

  for (const entry of data.entries) {
    try {
      const imageBytes = readFileSync(resolve(dataDir, entry.imagePath));
      const form = new FormData();
      form.set("file", new Blob([imageBytes], { type: "image/png" }), "complement.png");

      const response = await fetch(`${API_BASE_URL}/bank/questions/${entry.questionId}/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      console.log(`OK   ${entry.questionId} <- ${entry.imagePath}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${entry.questionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${data.entries.length - failures}/${data.entries.length} images replaced successfully.`);
  await pool.end();
  process.exitCode = failures > 0 ? 1 : 0;
}

/* istanbul ignore next -- CLI entrypoint, exercised manually, not under unit test */
main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
