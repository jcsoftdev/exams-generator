import { BankQuestion } from '../bank.models';

/** A single question leaf grouped under its topic. */
export interface QuestionTreeTopicNode {
  readonly topicId: string;
  readonly name: string;
  readonly questions: readonly BankQuestion[];
}

/** A course branch grouping its topics; hidden entirely when it has no questions. */
export interface QuestionTreeCourseNode {
  readonly courseId: string;
  readonly name: string;
  readonly questionCount: number;
  readonly topics: readonly QuestionTreeTopicNode[];
}

const FALLBACK_COURSE_NAME = 'Curso sin nombre';
const FALLBACK_TOPIC_NAME = 'Tema sin nombre';

/**
 * Pure grouping/sorting transform for the bank-list tree (Curso -> Tema ->
 * preguntas). Given the flat `GET /bank/questions` array plus id->name maps
 * resolved from `TaxonomyService`, groups questions by courseId then
 * topicId, resolves human-readable names (never raw UUIDs — falls back to a
 * friendly label when a name can't be resolved), and sorts branches
 * alphabetically by name so the tree renders in a stable, scannable order.
 * Empty branches never appear because nodes are derived only from the
 * questions actually present.
 */
export function buildQuestionTree(
  questions: readonly BankQuestion[],
  courseNames: ReadonlyMap<string, string>,
  topicNames: ReadonlyMap<string, string>,
): QuestionTreeCourseNode[] {
  const byCourse = new Map<string, Map<string, BankQuestion[]>>();

  for (const question of questions) {
    let byTopic = byCourse.get(question.courseId);
    if (!byTopic) {
      byTopic = new Map<string, BankQuestion[]>();
      byCourse.set(question.courseId, byTopic);
    }
    let bucket = byTopic.get(question.topicId);
    if (!bucket) {
      bucket = [];
      byTopic.set(question.topicId, bucket);
    }
    bucket.push(question);
  }

  const courses: QuestionTreeCourseNode[] = [];
  for (const [courseId, byTopic] of byCourse) {
    const topics: QuestionTreeTopicNode[] = [];
    let questionCount = 0;
    for (const [topicId, topicQuestions] of byTopic) {
      questionCount += topicQuestions.length;
      topics.push({
        topicId,
        name: topicNames.get(topicId) ?? FALLBACK_TOPIC_NAME,
        questions: topicQuestions,
      });
    }
    topics.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    courses.push({
      courseId,
      name: courseNames.get(courseId) ?? FALLBACK_COURSE_NAME,
      questionCount,
      topics,
    });
  }
  courses.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return courses;
}


function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Filters an already-built tree by a free-text query, matched
 * case-insensitively (substring) against the question clave
 * (`correctAnswer`), course name, or topic name.
 *
 * "Matching branches stay, non-matching hide" (search UX requirement):
 * when a course's own NAME matches, the whole course branch survives with
 * ALL its topics/questions untouched. Otherwise only the topics that match
 * (by topic name, or by containing at least one leaf question whose clave
 * matches) survive, and `questionCount` is recomputed from the surviving
 * topics. A blank/whitespace-only query returns the tree unchanged.
 */
export function filterQuestionTree(
  tree: readonly QuestionTreeCourseNode[],
  query: string,
): QuestionTreeCourseNode[] {
  const needle = normalize(query);
  if (!needle) {
    return [...tree];
  }

  const result: QuestionTreeCourseNode[] = [];
  for (const course of tree) {
    const courseNameMatches = normalize(course.name).includes(needle);
    const topics = courseNameMatches
      ? course.topics
      : course.topics.filter(
          (topic) =>
            normalize(topic.name).includes(needle) ||
            topic.questions.some((question) => normalize(question.correctAnswer).includes(needle)),
        );

    if (topics.length === 0) {
      continue;
    }

    result.push({
      ...course,
      topics,
      questionCount: topics.reduce((sum, topic) => sum + topic.questions.length, 0),
    });
  }

  return result;
}
