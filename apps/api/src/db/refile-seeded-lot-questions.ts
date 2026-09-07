import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "./client";
import { planLotQuestionRefile } from "./plan-lot-question-refile";
import { LotEntry } from "./plan-lot-seed";
import { courses, questions, topics } from "./schema";

const LOTS_DIR = join(__dirname, "data", "lots");

/**
 * Reconciles each seeded lot question's topic with what its lot entry says.
 *
 * A harvested question's filing is a guess until somebody reads it: for a
 * question baked into a screenshot the harvest knew only the exam's section
 * heading, so the topic under it was arbitrary. Correcting one is an edit to
 * its lot entry — but `seedLotQuestions` only ever INSERTS, so without this the
 * row already in the bank keeps the wrong topic and the fix needs a hand-run
 * script on the server.
 *
 * Runs on every boot beside the other backfills, and is idempotent: once the
 * bank agrees with the lots there is nothing to move, and the pass costs two
 * selects. That makes the lot file the source of truth for where a question
 * lives, and a re-filing a data change that ships with a plain deploy.
 */
export async function refileSeededLotQuestions(): Promise<{
  moved: number;
  unresolved: readonly string[];
}> {
  let names: string[];
  try {
    names = readdirSync(LOTS_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return { moved: 0, unresolved: [] }; // no lots shipped in this build
  }

  const entries = names.sort().flatMap((name) => {
    const data = JSON.parse(readFileSync(join(LOTS_DIR, name), "utf8")) as {
      entries?: LotEntry[];
    };
    return (data.entries ?? [])
      .filter((entry) => entry.sourceName && entry.courseName && entry.topicName)
      .map((entry) => ({
        sourceName: entry.sourceName,
        courseName: entry.courseName,
        topicName: entry.topicName,
      }));
  });
  if (entries.length === 0) {
    return { moved: 0, unresolved: [] };
  }

  const [seeded, taxonomy] = await Promise.all([
    db
      .select({ id: questions.id, sourceName: questions.sourceName, topicId: questions.topicId })
      .from(questions)
      .where(and(isNull(questions.tenantId), isNotNull(questions.sourceName))),
    db
      .select({ topicId: topics.id, topicName: topics.name, courseName: courses.name })
      .from(topics)
      .innerJoin(courses, eq(courses.id, topics.courseId)),
  ]);

  const plan = planLotQuestionRefile({
    entries,
    seeded: seeded.flatMap((row) =>
      row.sourceName && row.topicId
        ? [{ id: row.id, sourceName: row.sourceName, topicId: row.topicId }]
        : [],
    ),
    topicIds: new Map(taxonomy.map((row) => [`${row.courseName}|${row.topicName}`, row.topicId])),
  });

  if (plan.moves.length > 0) {
    await db.transaction(async (tx) => {
      for (const { questionId, topicId } of plan.moves) {
        await tx.update(questions).set({ topicId }).where(eq(questions.id, questionId));
      }
    });
  }

  return { moved: plan.moves.length, unresolved: plan.unresolved };
}
