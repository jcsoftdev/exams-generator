/** A lot entry, reduced to what deciding a re-filing needs. */
export interface RefileLotEntry {
  readonly sourceName: string;
  readonly courseName: string;
  readonly topicName: string;
}

/** A central-bank row that came from one of those entries. */
export interface RefileSeededQuestion {
  readonly id: string;
  readonly sourceName: string;
  readonly topicId: string;
}

export interface PlanLotQuestionRefileInput {
  readonly entries: readonly RefileLotEntry[];
  readonly seeded: readonly RefileSeededQuestion[];
  /** `"<course>|<topic>"` -> topic id, as the taxonomy resolves the pair. */
  readonly topicIds: ReadonlyMap<string, string>;
}

export interface LotQuestionRefilePlan {
  readonly moves: readonly { questionId: string; topicId: string }[];
  /** `"<course> > <topic>"` pairs the taxonomy does not have, each once. */
  readonly unresolved: readonly string[];
}

/**
 * Decides which seeded questions are filed somewhere their lot no longer says.
 *
 * A harvested question's course and topic are a guess until somebody reads it:
 * for a question baked into a screenshot the harvest knew only the exam's
 * section heading, so the topic under it was arbitrary — Álgebra > Polinomios
 * held a market word problem, an expected-value question and an inscribed
 * circle. Correcting one is an edit to its lot entry, but `seedLotQuestions`
 * only ever INSERTS: the row already in the bank keeps the old topic, and the
 * correction needs somebody to remember to run a script on the server.
 *
 * With this, the lot file is the filing's source of truth and every boot
 * reconciles the bank to it, so a re-filing ships as a data change and nothing
 * else.
 *
 * `source_name` is the join key for the same reason the retirement pass uses
 * it: the harvest fills it with exam, subject and question number, and it
 * survives the promotion from image to text unchanged.
 */
export function planLotQuestionRefile(input: PlanLotQuestionRefileInput): LotQuestionRefilePlan {
  const seededBySourceName = new Map(input.seeded.map((row) => [row.sourceName, row]));
  const moves: { questionId: string; topicId: string }[] = [];
  const unresolved = new Set<string>();

  for (const entry of input.entries) {
    const seeded = seededBySourceName.get(entry.sourceName);
    // Not in the bank yet: the seeder will file it correctly on the way in.
    if (!seeded) continue;

    const topicId = input.topicIds.get(`${entry.courseName}|${entry.topicName}`);
    if (!topicId) {
      // Guessing the nearest topic would file the question somewhere nobody
      // chose. Reported instead, so a typo in a lot surfaces on the next boot.
      unresolved.add(`${entry.courseName} > ${entry.topicName}`);
      continue;
    }
    if (topicId === seeded.topicId) continue;

    moves.push({ questionId: seeded.id, topicId });
  }

  return { moves, unresolved: [...unresolved] };
}
