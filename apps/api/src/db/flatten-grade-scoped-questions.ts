/**
 * One question as `seedCollectedQuestions` consumes it: course, topic and
 * grade denormalized onto every row.
 */
export interface CollectedEntry {
  readonly courseName: string;
  readonly topicName: string;
  readonly gradeLevel: string;
  readonly difficulty: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
}

interface GradeScopedTopic {
  readonly name?: unknown;
  readonly questions?: unknown;
}

/**
 * Normalizes the `escolar-*.json` school-question files into the flat shape
 * the collected seeder already reads.
 *
 * The two files differ only in where the taxonomy lives: `collected/*.json`
 * repeats `courseName`/`topicName`/`gradeLevel` on every entry, while the
 * school files hoist course+grade to the file and topic to a nesting level
 * (`{courseName, gradeLevel, topics: [{name, questions: []}]}`). Per-question
 * fields are already identical — `correctAnswer` is a 0-based index in both,
 * `difficulty` uses the same three values.
 *
 * That mismatch is the entire reason 846 curated questions covering
 * primaria_1 through secundaria_5 sat unused in the repository:
 * `seedCollectedQuestions` globs `data/collected/` only, and would not have
 * understood these files even if it had found them. Flattening here means the
 * escaping, unprintable-glyph refusal, dedup and batching all apply to school
 * questions for free, instead of a second seeder growing its own copy.
 */
export function flattenGradeScopedQuestions(file: unknown): CollectedEntry[] {
  // `file` is whatever `JSON.parse` returned, so every level is narrowed
  // before use — a malformed file yields no entries instead of rows the
  // seeder would have to reject one by one.
  if (typeof file !== "object" || file === null) {
    return [];
  }
  const { courseName, gradeLevel, topics } = file as Record<string, unknown>;
  if (typeof courseName !== "string" || typeof gradeLevel !== "string" || !Array.isArray(topics)) {
    return [];
  }

  const entries: CollectedEntry[] = [];
  for (const topic of topics as readonly GradeScopedTopic[]) {
    if (typeof topic?.name !== "string" || !Array.isArray(topic.questions)) {
      continue;
    }
    for (const question of topic.questions as readonly Record<string, unknown>[]) {
      entries.push({
        ...(question as unknown as Omit<CollectedEntry, "courseName" | "topicName" | "gradeLevel">),
        courseName,
        topicName: topic.name,
        gradeLevel,
      });
    }
  }
  return entries;
}
