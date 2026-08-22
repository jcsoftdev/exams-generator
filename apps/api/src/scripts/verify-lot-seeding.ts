import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, inArray, isNull } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";

/**
 * Reports, per harvested lot, how many of its questions actually reached the
 * central bank — matched on `source_name`, which the harvest fills with exam,
 * subject and question number.
 *
 * Exists because the seed scripts count a duplicate as SKIP rather than as a
 * write, so "0/27 seeded" reads identically whether the chunk was already in or
 * every insert failed. This answers the question the seeder's own output cannot.
 *
 * Usage: ts-node src/scripts/verify-lot-seeding.ts [<data-dir>]
 */
interface LotEntry {
  readonly sourceName: string;
}

async function main(): Promise<void> {
  const dataDir = resolve(process.cwd(), process.argv[2] ?? "src/db/data");
  const files = readdirSync(dataDir).filter((name) => name.startsWith("lot-") && name.endsWith(".json"));

  let totalExpected = 0;
  let totalMissing = 0;

  for (const name of files.sort()) {
    const entries = (JSON.parse(readFileSync(join(dataDir, name), "utf8")) as { entries: LotEntry[] })
      .entries;
    if (entries.length === 0) continue;

    const wanted = entries.map((entry) => entry.sourceName);
    const present = new Set<string>();
    // Chunked: `IN (...)` with a few thousand parameters trips the driver.
    for (let i = 0; i < wanted.length; i += 200) {
      const rows = await db
        .select({ sourceName: questions.sourceName })
        .from(questions)
        .where(and(isNull(questions.tenantId), inArray(questions.sourceName, wanted.slice(i, i + 200))));
      for (const row of rows) {
        if (row.sourceName) present.add(row.sourceName);
      }
    }

    const missing = wanted.filter((sourceName) => !present.has(sourceName));
    totalExpected += wanted.length;
    totalMissing += missing.length;
    const status = missing.length === 0 ? "OK  " : "GAP ";
    console.log(`${status} ${name.padEnd(46)} ${wanted.length - missing.length}/${wanted.length}`);
    for (const sourceName of missing.slice(0, 3)) {
      console.log(`       missing: ${sourceName}`);
    }
    if (missing.length > 3) {
      console.log(`       ...and ${missing.length - 3} more`);
    }
  }

  console.log(`\n${totalExpected - totalMissing}/${totalExpected} harvested questions are in the bank.`);
  await pool.end();
  process.exit(totalMissing === 0 ? 0 : 1);
}

void main();
