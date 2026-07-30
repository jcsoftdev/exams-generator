import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { hashBodyTypst } from "../modules/bank/domain/hash-body-typst";
import { db, pool } from "./client";
import { runMigrations } from "./migrate";
import { courses, questions, topics, users } from "./schema";

/**
 * `0016_body_hash_backfill.sql` computes body_hash via Postgres'
 * `regexp_replace(..., '^\s+|\s+$', '', 'g')` instead of bare `trim()`
 * specifically so it matches Node's `String.prototype.trim()` (which strips
 * the full \s class — tabs/newlines included — not just literal spaces).
 * This re-runs that exact UPDATE (idempotent: scoped to `body_hash IS NULL`)
 * against a row inserted straight through Drizzle without a hash, to prove
 * the two never diverge for whitespace-padded content.
 */
describe("0016_body_hash_backfill.sql", () => {
  let courseId: string;
  let topicId: string;
  let userId: string;
  const createdQuestionIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();
    const [course] = await db
      .insert(courses)
      .values({ name: `Backfill Test Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Backfill Test Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [user] = await db
      .insert(users)
      .values({ email: `backfill-${suffix}@test.local`, passwordHash: "x", role: Role.PlatformAdmin })
      .returning({ id: users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(topics).where(eq(topics.id, topicId));
    await db.delete(courses).where(eq(courses.id, courseId));
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  it("computes the same hash as hashBodyTypst() for a whitespace-padded statement", async () => {
    const paddedBody = "\n\t  ¿Cuánto es 2 + 2?  \n";

    const [row] = await db
      .insert(questions)
      .values({
        tenantId: null,
        type: "structured",
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        status: "approved",
        bodyTypst: paddedBody,
        alternatives: ["3", "4", "5"],
        correctAnswer: "1",
        createdBy: userId,
        // bodyHash intentionally omitted — simulates a pre-0015 row.
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(row!.id);

    // `\\s` (not `\s`): inside a JS template literal, an unrecognized escape
    // like `\s` cooks down to a bare `s`, silently stripping the backslash
    // before this ever reaches Postgres — the actual .sql migration file
    // isn't parsed as a JS string, so it doesn't have this problem.
    await db.execute(sql`
      UPDATE questions
      SET body_hash = encode(digest(regexp_replace(body_typst, '^\\s+|\\s+$', '', 'g'), 'sha256'), 'hex')
      WHERE body_typst IS NOT NULL AND body_hash IS NULL
    `);

    const [after] = await db.select().from(questions).where(eq(questions.id, row!.id));
    expect(after?.bodyHash).toBe(hashBodyTypst(paddedBody));
  });
});
