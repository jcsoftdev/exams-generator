/**
 * GradeLevel — the fixed seeded catalog (never user-editable): 1ro-6to
 * primaria, 1ro-5to secundaria, and pre (pre-admisión).
 *
 * Lives here because it is a CONTRACT, not one module's vocabulary: it is a
 * database column, a query parameter, a request body field and a filter in the
 * UI. It used to be declared four times — the API's exams domain plus the web's
 * bank, ai and exams models — and both originals carried a comment promising to
 * promote it "if/when the bank module needs the same catalog". It did, three
 * copies ago (audit 2026-08-20, M4).
 *
 * IMPORTANT: GradeLevel and Difficulty are INDEPENDENT axes. A question's grade
 * level never constrains, nor is constrained by, its difficulty — "hard" exists
 * at every grade, "1ro primaria" accepts every difficulty. Do not introduce
 * cross-validation between the two.
 *
 * Labels are deliberately NOT here. "1° primaria" is Spanish UI copy that only
 * the web renders; the API had a `STAGE_LABELS` map that nothing on the server
 * ever read.
 */
export const GRADE_LEVELS = [
  "primaria_1",
  "primaria_2",
  "primaria_3",
  "primaria_4",
  "primaria_5",
  "primaria_6",
  "secundaria_1",
  "secundaria_2",
  "secundaria_3",
  "secundaria_4",
  "secundaria_5",
  "pre",
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export function isGradeLevel(value: string): value is GradeLevel {
  return (GRADE_LEVELS as readonly string[]).includes(value);
}

/**
 * Educational stage — the coarse grouping of grade levels the course catalog is
 * divided by (a course belongs to exactly one stage):
 *   escuela          → primaria_1..6   (áreas CNEB, temas iniciales)
 *   colegio          → secundaria_1..5 (áreas CNEB, temas completos)
 *   preuniversitario → pre             (desglose académico de admisión)
 */
export const STAGES = ["escuela", "colegio", "preuniversitario"] as const;

export type Stage = (typeof STAGES)[number];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

/** Maps a grade level to its educational stage — the axis the course catalog is divided by. */
export function stageForGrade(grade: GradeLevel): Stage {
  if (grade === "pre") {
    return "preuniversitario";
  }
  return grade.startsWith("secundaria_") ? "colegio" : "escuela";
}
