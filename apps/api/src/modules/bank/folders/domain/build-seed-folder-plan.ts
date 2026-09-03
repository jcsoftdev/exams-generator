import { MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";

export interface SeedCourseRow {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
}

export interface SeedTopicRow {
  readonly id: string;
  readonly courseId: string;
  readonly name: string;
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

      /**
       * One folder per topic, named exactly like the topic. There used to be a
       * grade suffix here (`folderNameForTopic`) and a sibling-name deduper,
       * both for the same problem: `topics` was one row per grade, so two rows
       * of one course routinely shared a name. `topics_course_id_name_idx`
       * makes that impossible now (design doc 2026-09-03), and the clamp below
       * is the only name transformation left — verified never to truncate: the
       * longest catalog topic name is 66 characters.
       */
      const courseTopics = topics.filter((topic) => topic.courseId === course.id);
      for (const [topicPosition, topic] of courseTopics.entries()) {
        plan.push({
          key: `topic:${topic.id}`,
          parentKey: courseKey,
          name: clampFolderName(topic.name),
          topicId: topic.id,
          position: topicPosition,
        });
      }
    }
  }

  return plan;
}
