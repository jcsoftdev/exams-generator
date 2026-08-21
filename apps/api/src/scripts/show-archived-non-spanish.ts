import "reflect-metadata";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, questions, topics } from "../db/schema";
import { readsAsSpanish } from "../modules/bank/domain/reads-as-spanish";

/** Prints, in full, the archived central questions whose statement is not Spanish. */
async function main(): Promise<void> {
  const rows = await db
    .select({
      id: questions.id,
      course: courses.name,
      topic: topics.name,
      gradeLevel: questions.gradeLevel,
      difficulty: questions.difficulty,
      bodyTypst: questions.bodyTypst,
      alternatives: questions.alternatives,
      correctAnswer: questions.correctAnswer,
      sourceName: questions.sourceName,
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .innerJoin(courses, eq(topics.courseId, courses.id))
    .where(and(isNull(questions.tenantId), eq(questions.status, "archived")));

  const foreign = rows.filter(
    (row) => (row.bodyTypst ?? "").length > 0 && !readsAsSpanish(row.bodyTypst ?? ""),
  );

  for (const row of foreign) {
    console.log(JSON.stringify(row, null, 1));
  }
  console.log(`\n${foreign.length} archived questions are not in Spanish`);
  await pool.end();
}

void main();
