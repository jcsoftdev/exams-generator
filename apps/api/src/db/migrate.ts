import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

const MIGRATIONS_FOLDER = join(__dirname, "..", "..", "drizzle");

/** Applies every committed migration in `drizzle/` that hasn't run yet. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/* istanbul ignore next -- CLI entrypoint */
if (require.main === module) {
  runMigrations()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Migrations applied.");
      return pool.end();
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Migration failed:", error);
      return pool.end().finally(() => process.exit(1));
    });
}
