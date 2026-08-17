import { pool } from "./client";
import { seedCatalogs } from "./seed";

/**
 * CLI entrypoint for the catalog-only seed (`pnpm db:seed:catalogs`).
 *
 * Exists for test environments — CI, or any freshly created local database.
 * `seed()` is the deploy/dev seeder and also ingests the collected question
 * bank; the suites only need the FK-target catalogs, so this is the cheap half.
 * See `seedCatalogs()` for why a migrated-but-unseeded DB fails every question
 * insert.
 */
/* istanbul ignore next -- CLI entrypoint, exercised in CI, not under unit test */
if (require.main === module) {
  seedCatalogs()
    .then(() => {
      console.log("Catalog seed complete.");
      return pool.end();
    })
    .catch((error: unknown) => {
      console.error("Catalog seed failed:", error);
      return pool.end().finally(() => process.exit(1));
    });
}
