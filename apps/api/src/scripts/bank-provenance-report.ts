import "reflect-metadata";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";

/**
 * How much of the central bank can answer "where did this question come from".
 *
 * Provenance is not decorative here: `questions.source_url` is what turns
 * "remove every question from host X" into a query instead of a re-derivation
 * from the seed files, which is exactly what a licensing change asks for.
 */
async function main(): Promise<void> {
  const central = and(isNull(questions.tenantId));

  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(questions).where(central);
  const [images] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(central, eq(questions.type, "image")));
  const [named] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(central, isNotNull(questions.sourceName)));
  const [imagesNamed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(central, eq(questions.type, "image"), isNotNull(questions.sourceName)));

  console.log(`central bank rows      : ${total?.n ?? 0}`);
  console.log(`  of those, images     : ${images?.n ?? 0}`);
  console.log(`  with a source name   : ${named?.n ?? 0}`);
  console.log(`  images with a source : ${imagesNamed?.n ?? 0}`);

  await pool.end();
}

void main();
