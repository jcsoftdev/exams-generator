import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

/**
 * Verifies the committed `drizzle/*.sql` migration(s) match what
 * `drizzle-kit generate` would produce from the CURRENT `src/db/schema/*.ts`
 * files right now — i.e. no schema drift slipped in without regenerating +
 * committing the migration (task 2.4/2.5).
 *
 * Strategy: seed a throwaway temp directory with a COPY of the committed
 * `drizzle/` folder (its `meta/*_snapshot.json` + `_journal.json`), then
 * regenerate on top of it — mirroring exactly what `db:generate` does
 * locally (incremental diff against the last committed snapshot), not a
 * from-scratch baseline. If the current schema has drifted from the last
 * committed migration, `drizzle-kit generate` writes an EXTRA `.sql` file
 * into the temp copy, which is caught by the file-count/content comparison
 * below. If there's no drift, the temp copy is untouched and trivially
 * equals the committed folder. This scales to any number of committed
 * migrations (S9 is the first of several — see tasks 2, 5, 6, 8) — a
 * from-scratch regenerate would only ever match a single-migration history,
 * since it always coalesces the whole schema into one baseline file.
 * We still compare SQL file CONTENTS, not filenames — `drizzle-kit generate`
 * picks a random adjective-noun tag suffix per run, so filenames are never
 * stable across regenerations even with zero schema changes.
 *
 * IMPORTANT: `--out` is passed as a path RELATIVE to `apiRoot`, not the
 * temp dir's absolute path. drizzle-kit 0.24.2 has a path-join bug when
 * `--out` is absolute AND a `meta/*_snapshot.json` already exists there: it
 * fails to locate the existing snapshot (ENOENT), swallows the error
 * internally, and silently exits 0 having written NOTHING — a false-negative
 * that would make this check always pass regardless of real drift. A
 * relative `--out` avoids that code path entirely (verified manually: an
 * injected extra column is correctly caught as a new migration file with a
 * relative path, and silently NO-OP'd — false negative — with an absolute
 * one).
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
      cpSync(committedMigrationsDir, tmpOut, { recursive: true });
      const relativeOut = relative(apiRoot, tmpOut);

      execFileSync(
        "pnpm",
        [
          "exec",
          "drizzle-kit",
          "generate",
          "--schema=./src/db/schema/index.ts",
          "--dialect=postgresql",
          `--out=${relativeOut}`,
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
