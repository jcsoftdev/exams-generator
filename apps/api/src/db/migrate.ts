import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

const MIGRATIONS_FOLDER = join(__dirname, "..", "..", "drizzle");

/**
 * Arbitrary but fixed key for the session-level advisory lock below. Any
 * constant works as long as every caller uses the SAME one — that is the
 * whole point.
 */
const MIGRATION_LOCK_KEY = 913_042_026;

/**
 * Applies every committed migration in `drizzle/` that hasn't run yet.
 *
 * Serialized with a Postgres advisory lock because the jest `non-e2e`
 * project runs in parallel and several specs call this in `beforeAll`. On a
 * database that is ALREADY migrated that race is invisible — every worker
 * reads the journal, finds nothing to do, and returns. On an EMPTY database
 * they all try to create the same tables at the same time and Postgres
 * rejects the losers with `duplicate key value violates unique constraint
 * "pg_class_relname_nsp_index"` — its internal catalog index, not one of
 * ours. That is why this only ever broke in CI (fresh container each run)
 * and never on a developer machine, and it would equally break the first
 * run after a `db:reset`.
 *
 * The lock is taken on a dedicated connection: `pg_advisory_lock` is
 * session-scoped, so releasing it has to happen on the same connection that
 * took it, not on whichever pooled one `migrate()` happens to grab.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    // Never let a failed unlock mask the migration error we are propagating;
    // the lock dies with the session anyway when the client is released.
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/* istanbul ignore next -- CLI entrypoint */
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
      return pool.end();
    })
    .catch((error: unknown) => {
      console.error("Migration failed:", error);
      return pool.end().finally(() => process.exit(1));
    });
}
