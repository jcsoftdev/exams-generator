import "reflect-metadata";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, questions, topics } from "../db/schema";
import { hashBodyTypst } from "../modules/bank/domain/hash-body-typst";

/**
 * Repairs the five central-bank questions whose statement was not in Spanish,
 * instead of leaving them archived.
 *
 * Archiving them was the wrong call: the bank should HAVE these questions in a
 * usable state, not merely stop showing them. But "translate everything" is
 * wrong too, and the five split cleanly in two:
 *
 * - Four are English-language exercises — a prepositions cloze, a vocabulary
 *   cloze, and two reading-comprehension items over an English passage. Their
 *   subject IS English, so translating the statement would destroy the
 *   question: "Complete the text with prepositions" has no Spanish version whose
 *   answer is still `on - in - at`. They were simply filed under the wrong
 *   course by the blog they came from. They move to Inglés, where an English
 *   statement is what the course is about.
 * - One is a real cronometría problem that its publisher had translated into
 *   English. That one gets translated back into Spanish and stays where it is.
 *
 * One of the four also carries the answer key leaked into its last alternative
 * ("applauded. Key : ... Rpta . A"), which hands the student the answer. The
 * leaked tail is trimmed; the alternative itself is left as published.
 *
 * Idempotent: re-running finds the rows already fixed and changes nothing.
 */
const ENGLISH_EXERCISES = [
  "f82b0363-18ba-4245-bb9d-728e03cca810", // prepositions of time and place
  "23529ad0-c0a9-4526-9e7a-27adb4ca7dc9", // vocabulary cloze
  "dd6caa52-8a96-4141-b037-b01b0df0d752", // reading comprehension: EPITOMIZED
  "b82b1899-51f1-4988-9bc0-79b13e587fad", // reading comprehension: the Greek gods
];

const LEAKED_KEY_ID = "b82b1899-51f1-4988-9bc0-79b13e587fad";
const CRONOMETRIA_ID = "6b5aca97-a237-42e7-9359-b56b5149216a";

/** The cronometría problem, back in the language the exam was sat in. */
const CRONOMETRIA_ES = {
  bodyTypst:
    "El reloj de Jorgito se adelanta 3 minutos cada hora. Si empieza marcando la hora correcta a las 8 a. m., " +
    "cuando su reloj marque las 6:30 p. m., ¿qué hora será en realidad dos horas después de ese momento?",
  alternatives: ["10 p. m.", "9 p. m.", "8 p. m.", "7 p. m."],
};

async function englishTopicId(): Promise<string> {
  const englishCourses = await db.select({ id: courses.id }).from(courses).where(eq(courses.name, "Inglés"));
  if (englishCourses.length === 0) {
    throw new Error("course 'Inglés' not found");
  }
  const [topic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        inArray(
          topics.courseId,
          englishCourses.map((row) => row.id),
        ),
        eq(topics.name, "Aptitud comunicativa (inglés)"),
      ),
    );
  if (!topic) {
    throw new Error("topic 'Aptitud comunicativa (inglés)' not found under 'Inglés'");
  }
  return topic.id;
}

async function main(): Promise<void> {
  const topicId = await englishTopicId();

  const moved = await db
    .update(questions)
    .set({ topicId, subtopicId: null, status: "approved" })
    .where(and(isNull(questions.tenantId), inArray(questions.id, ENGLISH_EXERCISES)))
    .returning({ id: questions.id });
  console.log(`[fix-non-spanish] moved ${moved.length} English exercises to Inglés / Aptitud comunicativa`);

  const [leaked] = await db
    .select({ alternatives: questions.alternatives })
    .from(questions)
    .where(eq(questions.id, LEAKED_KEY_ID));
  if (leaked) {
    const alternatives = (leaked.alternatives ?? []) as string[];
    const cleaned = alternatives.map((alternative) =>
      alternative
        .replace(/\s*Key\s*:.*$/is, "")
        .replace(/\s*Rpta\s*\..*$/is, "")
        .trim(),
    );
    if (cleaned.join("|") !== alternatives.join("|")) {
      await db.update(questions).set({ alternatives: cleaned }).where(eq(questions.id, LEAKED_KEY_ID));
      console.log("[fix-non-spanish] trimmed the answer key leaked into an alternative");
    }
  }

  // body_hash has to travel with the statement: it backs the unique index, so a
  // stale hash would let the Spanish version be inserted again as a "new"
  // question the next time this source is seeded.
  const translated = await db
    .update(questions)
    .set({
      ...CRONOMETRIA_ES,
      bodyHash: hashBodyTypst(CRONOMETRIA_ES.bodyTypst),
      status: "approved",
    })
    .where(and(isNull(questions.tenantId), eq(questions.id, CRONOMETRIA_ID)))
    .returning({ id: questions.id });
  console.log(`[fix-non-spanish] translated ${translated.length} question into Spanish`);

  await pool.end();
}

void main();
