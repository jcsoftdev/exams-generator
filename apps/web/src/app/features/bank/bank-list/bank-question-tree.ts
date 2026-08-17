import { BankQuestion, BankTopicCount } from '../bank.models';

/**
 * A topic branch. `questionCount` comes from the server summary and is
 * always the FULL number of questions the topic holds under the active
 * filters; `questions` holds only the page fetched so far (empty until the
 * topic is expanded for the first time). The two are deliberately separate —
 * `questionCount > questions.length` is the normal, expected state and is
 * what makes "Ver más" discoverable.
 */
export interface QuestionTreeTopicNode {
  readonly topicId: string;
  readonly name: string;
  readonly questionCount: number;
  readonly questions: readonly BankQuestion[];
  /** `true` once this topic's first page came back — distinguishes "not fetched yet" from "fetched, genuinely empty". */
  readonly loaded: boolean;
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
 * Pure transform that builds the bank-list tree (Curso -> Tema -> preguntas)
 * from the SERVER-SIDE per-topic summary (`GET /bank/questions/summary`)
 * plus whatever topic pages have been lazily fetched so far.
 *
 * This used to take the flat `GET /bank/questions` array and group it
 * client-side. That worked while the bank was ~71 rows; the seeded central
 * bank is now 64k, and grouping it in the browser meant downloading the
 * whole thing on every `/app/bank` load. The skeleton (courses, topics,
 * counts) is cheap and complete; the leaves arrive per branch, on demand.
 *
 * Names are resolved from the `TaxonomyService` id->name maps (never raw
 * UUIDs — falls back to a friendly label), branches sort alphabetically by
 * resolved name, and zero-total buckets are dropped so an empty branch never
 * renders.
 */
export function buildQuestionTree(
  counts: readonly BankTopicCount[],
  loadedQuestions: ReadonlyMap<string, readonly BankQuestion[]>,
  courseNames: ReadonlyMap<string, string>,
  topicNames: ReadonlyMap<string, string>,
): QuestionTreeCourseNode[] {
  const byCourse = new Map<string, QuestionTreeTopicNode[]>();

  for (const bucket of counts) {
    if (bucket.total <= 0) {
      continue;
    }
    let topics = byCourse.get(bucket.courseId);
    if (!topics) {
      topics = [];
      byCourse.set(bucket.courseId, topics);
    }
    const loaded = loadedQuestions.get(bucket.topicId);
    topics.push({
      topicId: bucket.topicId,
      name: topicNames.get(bucket.topicId) ?? FALLBACK_TOPIC_NAME,
      questionCount: bucket.total,
      questions: loaded ?? [],
      loaded: loaded !== undefined,
    });
  }

  const courses: QuestionTreeCourseNode[] = [];
  for (const [courseId, topics] of byCourse) {
    topics.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    courses.push({
      courseId,
      name: courseNames.get(courseId) ?? FALLBACK_COURSE_NAME,
      questionCount: topics.reduce((sum, topic) => sum + topic.questionCount, 0),
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
 * case-insensitively (substring) against the COURSE NAME or the TOPIC NAME.
 *
 * Scope note (deliberate, not an oversight): this used to also match a leaf
 * question's clave (`correctAnswer`). With lazy per-branch loading the leaves
 * of a collapsed topic simply are not in memory, so a clave match would only
 * ever hit the handful of topics the user happened to have opened — a search
 * that silently answers "the part I already downloaded" is worse than one
 * with an honest, stated scope. Matching a clave (a/b/c/d) was also close to
 * useless as a search key. If per-question search comes back, it has to be a
 * server-side query, not this transform.
 *
 * "Matching branches stay, non-matching hide": when a course's own NAME
 * matches, the whole course branch survives with ALL its topics. Otherwise
 * only the topics whose name matches survive, and `questionCount` is
 * recomputed from the surviving topics' SUMMARY totals (never from the
 * loaded leaves, which are a partial page). A blank/whitespace-only query
 * returns the tree unchanged.
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
      : course.topics.filter((topic) => normalize(topic.name).includes(needle));

    if (topics.length === 0) {
      continue;
    }

    result.push({
      ...course,
      topics,
      questionCount: topics.reduce((sum, topic) => sum + topic.questionCount, 0),
    });
  }

  return result;
}
