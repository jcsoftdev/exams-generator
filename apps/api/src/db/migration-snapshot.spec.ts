import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Verifies the committed `drizzle/*.sql` migration(s) match what
 * `drizzle-kit generate` would produce from the CURRENT `src/db/schema/*.ts`
 * files right now — i.e. no schema drift slipped in without regenerating +
 * committing the migration (task 2.4/2.5).
 *
 * Strategy: regenerate into a throwaway temp directory (a fresh baseline,
 * no prior journal) and compare the resulting SQL statements against the
 * committed `drizzle/` folder. We compare SQL file CONTENTS, not filenames
 * — `drizzle-kit generate` picks a random adjective-noun tag suffix per
 * run, so filenames are never stable across regenerations even with zero
 * schema changes.
 */
describe("migration snapshot (schema drift check)", () => {
  const apiRoot = resolve(__dirname, "../..");
  const committedMigrationsDir = join(apiRoot, "drizzle");

  function readSqlFileContents(dir: string): string[] {
    return readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(join(dir, file), "utf-8"));
  }

  it("regenerating the migration from the current schema produces byte-identical SQL to what's committed", () => {
    const tmpOut = mkdtempSync(join(tmpdir(), "drizzle-snapshot-"));

    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "drizzle-kit",
          "generate",
          "--schema=./src/db/schema/index.ts",
          "--dialect=postgresql",
          `--out=${tmpOut}`,
        ],
        { cwd: apiRoot, stdio: "pipe" },
      );

      const regenerated = readSqlFileContents(tmpOut);
      const committed = readSqlFileContents(committedMigrationsDir);

      expect(regenerated).toEqual(committed);
    } finally {
      rmSync(tmpOut, { recursive: true, force: true });
    }
  });
});
