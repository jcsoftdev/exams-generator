import { MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";
import { folderNameForTopic } from "./folder-name";

export interface SeedCourseRow {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
}

export interface SeedTopicRow {
  readonly id: string;
  readonly courseId: string;
  readonly name: string;
  readonly gradeLevel: string | null;
}

/**
 * One node of the seed plan. `key`/`parentKey` are LOCAL identifiers, not
 * database ids: the plan is built before a single row is inserted, so a child
 * cannot reference its parent's uuid yet. The repository walks the plan in
 * order, inserts each node, and keeps a `key -> id` map to resolve `parentKey`
 * — which is why `buildSeedFolderPlan` guarantees parents come first.
 */
export interface SeedFolderPlanNode {
  readonly key: string;
  readonly parentKey: string | null;
  readonly name: string;
  readonly topicId: string | null;
  readonly position: number;
}

/**
 * Spanish labels for the stage roots, exactly as the spec writes them. A stage
 * with no courses gets no root at all — an empty "Escuela" branch would be a
 * dead node the teacher has to collapse forever.
 */
const STAGE_ROOT_LABELS: Readonly<Record<string, string>> = {
  escuela: "Escuela",
  colegio: "Colegio",
  preuniversitario: "Preuniversitario",
};

/**
 * School-progression order, NOT alphabetical. The spec's ASCII diagram lists
 * the roots Colegio / Preuniversitario / Escuela, which is neither — it is an
 * illustration, not an ordering rule (see the plan's "Ambigüedades" §3).
 */
const STAGE_ORDER = ["escuela", "colegio", "preuniversitario"] as const;

/**
 * Clamps a catalog-derived name to `MAX_FOLDER_NAME_LENGTH` and re-trims —
 * `question_folders.name` has no DB-level length constraint, but the seeded
 * name has to satisfy the SAME `validateFolderName` bound a teacher's manual
 * rename does, or a course/topic name the catalog grows past 80 characters
 * would insert a row `folder_name_invalid` would reject if resubmitted.
 */
function clampFolderName(name: string): string {
  return name.length > MAX_FOLDER_NAME_LENGTH ? name.slice(0, MAX_FOLDER_NAME_LENGTH).trim() : name;
}

/**
 * Disambiguates sibling names that collide after `clampFolderName`/
 * `folderNameForTopic` have already run. The one real-world case: two topics
 * in the SAME course sharing a name with a NULL `gradeLevel` — the taxonomy's
 * own unique index (`topics_course_id_name_grade_idx`) treats every NULL grade
 * as distinct, so the database happily stores both rows, but
 * `folderNameForTopic` only adds the disambiguating grade suffix when
 * `gradeLevel` is set. Left alone, the second insert would collide on
 * `question_folders_sibling_name_idx` (`tenant_id, parent_id, name`) and the
 * whole seed transaction would abort with a constraint violation instead of a
 * folder appearing.
 *
 * First occurrence of a name keeps it; the second gets " (2)", the third
 * " (3)", etc. — trimmed further if the suffix would push the total past
 * `MAX_FOLDER_NAME_LENGTH`.
 */
function dedupeSiblingNames(names: readonly string[]): string[] {
  const seenCount = new Map<string, number>();
  return names.map((name) => {
    const occurrence = (seenCount.get(name) ?? 0) + 1;
    seenCount.set(name, occurrence);
    if (occurrence === 1) {
      return name;
    }
    const suffix = ` (${occurrence})`;
    const base =
      name.length + suffix.length > MAX_FOLDER_NAME_LENGTH
        ? name.slice(0, MAX_FOLDER_NAME_LENGTH - suffix.length)
        : name;
    return `${base}${suffix}`;
  });
}

/**
 * The default folder set a tenant receives on its first `GET /bank/folders`:
 * a root per stage that has courses, a folder per course under it (alphabetical),
 * and a folder per topic under each course, carrying `topicId` so central-bank
 * questions of that topic surface inside it. `subtopics` are deliberately not
 * seeded — the web never used them and curso -> tema already covers the
 * teacher's example.
 */
export function buildSeedFolderPlan(
  courses: readonly SeedCourseRow[],
  topics: readonly SeedTopicRow[],
): SeedFolderPlanNode[] {
  const plan: SeedFolderPlanNode[] = [];
  // A stage the catalog grew that this list does not know about still gets a
  // root, appended after the known ones, labelled by its raw code.
  const stages = [
    ...STAGE_ORDER.filter((stage) => courses.some((course) => course.stage === stage)),
    ...[...new Set(courses.map((course) => course.stage))]
      .filter((stage) => !(STAGE_ORDER as readonly string[]).includes(stage))
      .sort((a, b) => a.localeCompare(b, "es")),
  ];

  let rootPosition = 0;
  for (const stage of stages) {
    const rootKey = `stage:${stage}`;
    plan.push({
      key: rootKey,
      parentKey: null,
      name: STAGE_ROOT_LABELS[stage] ?? stage,
      topicId: null,
      position: rootPosition,
    });
    rootPosition += 1;

    const stageCourses = courses
      .filter((course) => course.stage === stage)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    for (const [coursePosition, course] of stageCourses.entries()) {
      const courseKey = `course:${course.id}`;
      plan.push({
        key: courseKey,
        parentKey: rootKey,
        name: clampFolderName(course.name),
        topicId: null,
        position: coursePosition,
      });

      const courseTopics = topics.filter((topic) => topic.courseId === course.id);
      const topicNames = dedupeSiblingNames(
        courseTopics.map((topic) => clampFolderName(folderNameForTopic(topic, courseTopics))),
      );
      for (const [topicPosition, topic] of courseTopics.entries()) {
        plan.push({
          key: `topic:${topic.id}`,
          parentKey: courseKey,
          name: topicNames[topicPosition]!,
          topicId: topic.id,
          position: topicPosition,
        });
      }
    }
  }

  return plan;
}
