import { MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";
import { buildSeedFolderPlan, SeedCourseRow, SeedTopicRow } from "./build-seed-folder-plan";

const COURSES: SeedCourseRow[] = [
  { id: "c-mat-col", name: "Matemática", stage: "colegio" },
  { id: "c-com-col", name: "Comunicación", stage: "colegio" },
  { id: "c-tri-pre", name: "Trigonometría", stage: "preuniversitario" },
];

const TOPICS: SeedTopicRow[] = [
  { id: "t-1", courseId: "c-mat-col", name: "Trigonometría" },
  { id: "t-2", courseId: "c-mat-col", name: "Fracciones" },
  { id: "t-3", courseId: "c-com-col", name: "Comprensión lectora" },
  { id: "t-4", courseId: "c-tri-pre", name: "Longitud de arco" },
];

describe("buildSeedFolderPlan", () => {
  it("creates one root per stage that actually has courses, in school-progression order", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const roots = plan.filter((node) => node.parentKey === null);

    // No `escuela` course in the fixture -> no "Escuela" root at all.
    expect(roots.map((r) => [r.name, r.position])).toEqual([
      ["Colegio", 0],
      ["Preuniversitario", 1],
    ]);
  });

  it("puts one folder per course under its stage root, alphabetically", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const colegioKey = plan.find((node) => node.name === "Colegio")!.key;
    const courses = plan.filter((node) => node.parentKey === colegioKey);

    expect(courses.map((c) => [c.name, c.position])).toEqual([
      ["Comunicación", 0],
      ["Matemática", 1],
    ]);
    expect(courses.every((c) => c.topicId === null)).toBe(true);
  });

  it("puts one folder per topic under its course, named exactly like the topic", () => {
    const plan = buildSeedFolderPlan(
      [{ id: "c1", name: "Matemática", stage: "colegio" }],
      [
        { id: "t1", courseId: "c1", name: "Trigonometría" },
        { id: "t2", courseId: "c1", name: "Fracciones" },
      ],
    );

    const topicNodes = plan.filter((node) => node.topicId !== null);
    expect(topicNodes.map((node) => [node.name, node.topicId, node.position])).toEqual([
      ["Trigonometría", "t1", 0],
      ["Fracciones", "t2", 1],
    ]);
  });

  it("gives every node a unique key, so the repository can wire parents before ids exist", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    expect(new Set(plan.map((node) => node.key)).size).toBe(plan.length);
  });

  it("emits parents before children — the repository inserts in plan order", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const seen = new Set<string>();
    for (const node of plan) {
      if (node.parentKey !== null) {
        expect(seen.has(node.parentKey)).toBe(true);
      }
      seen.add(node.key);
    }
  });

  it("returns an empty plan when there are no courses", () => {
    expect(buildSeedFolderPlan([], [])).toEqual([]);
  });

  it("truncates a course name longer than MAX_FOLDER_NAME_LENGTH", () => {
    const longName = "Curso ".repeat(20); // 120 chars
    const courses: SeedCourseRow[] = [{ id: "c-1", name: longName, stage: "colegio" }];

    const plan = buildSeedFolderPlan(courses, []);
    const courseNode = plan.find((node) => node.parentKey !== null)!;

    expect(courseNode.name.length).toBeLessThanOrEqual(MAX_FOLDER_NAME_LENGTH);
    expect(courseNode.name).toBe(longName.slice(0, MAX_FOLDER_NAME_LENGTH).trim());
  });
});
