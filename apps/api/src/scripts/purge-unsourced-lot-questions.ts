import "reflect-metadata";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { assets, questions } from "../db/schema";

/**
 * Deletes central-bank questions that were seeded WITHOUT provenance since a
 * cutoff, so they can be re-seeded through the path that records it.
 *
 * Needed once: the harvested lots were first seeded over HTTP, and the bank's
 * create endpoints silently dropped `sourceUrl`/`sourceName` (fixed in the same
 * change that added this script). A question nobody can trace to a source is
 * worse than no question when the bank mixes licensing channels.
 *
 * Scoped deliberately narrow — `tenant_id IS NULL`, `source_name IS NULL`, and
 * created at or after `--since` — so it cannot touch tenant banks or the
 * older seeded corpus.
 *
 * Usage: ts-node src/scripts/purge-unsourced-lot-questions.ts --since 2026-08-20 [--apply]
 */
async function main(): Promise<void> {
  const sinceArg = argValue("--since");
  if (!sinceArg) {
    throw new Error("--since <YYYY-MM-DD> is required");
  }
  const since = new Date(`${sinceArg}T00:00:00Z`);
  if (Number.isNaN(since.getTime())) {
    throw new Error(`--since is not a date: ${sinceArg}`);
  }
  const apply = process.argv.includes("--apply");

  const scope = and(
    isNull(questions.tenantId),
    isNull(questions.sourceName),
    gte(questions.createdAt, since),
  );

  const doomed = await db
    .select({ id: questions.id, type: questions.type, imageAssetId: questions.imageAssetId })
    .from(questions)
    .where(scope);

  const images = doomed.filter((row) => row.imageAssetId !== null);
  console.log(
    `${doomed.length} unsourced central questions created since ${sinceArg} ` +
      `(${images.length} of them carry an image asset)`,
  );
  if (!apply) {
    console.log("dry run — pass --apply to delete");
    await pool.end();
    return;
  }

  let deleted = 0;
  for (const row of doomed) {
    await db.delete(questions).where(eq(questions.id, row.id));
    // The asset row goes too; the object in storage is left alone on purpose,
    // since an orphan object costs storage while a deleted-too-eagerly one
    // could break a question that shares it.
    if (row.imageAssetId) {
      await db.delete(assets).where(eq(assets.id, row.imageAssetId));
    }
    deleted++;
  }
  console.log(`deleted ${deleted} questions`);

  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questions)
    .where(scope);
  console.log(`${remaining?.n ?? 0} unsourced rows remain in that window`);

  await pool.end();
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

void main();
