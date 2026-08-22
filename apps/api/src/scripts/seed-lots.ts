import "reflect-metadata";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { seedLotQuestions } from "../db/seed-lot-questions";
import { users } from "../db/schema";

/**
 * Runs ONLY the harvested-lot seeding (`db/data/lots/`), without the rest of the
 * boot seed. Same code path deploy boot takes — see `seed-lot-questions.ts` —
 * so running it locally is a real rehearsal of what production will do.
 *
 * Usage (from apps/api): ts-node -r dotenv/config src/scripts/seed-lots.ts
 */
const BANK_SAMPLE_ADMIN_EMAIL = "bank-sample-seeder@exams-generator.internal";

async function main(): Promise<void> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, BANK_SAMPLE_ADMIN_EMAIL));
  if (!admin) {
    throw new Error(
      `seed user '${BANK_SAMPLE_ADMIN_EMAIL}' not found — run 'pnpm --filter api db:seed' first`,
    );
  }

  await seedLotQuestions(admin.id);
  await pool.end();
}

void main();
