/**
 * GradeLevel — fixed seeded catalog (never user-editable): 1ro-6to primaria,
 * 1ro-5to secundaria, and pre (pre-admisión).
 *
 * IMPORTANT: GradeLevel and Difficulty (see `@exams-generator/shared`) are
 * INDEPENDENT axes. A question or exam's grade level never constrains, nor
 * is constrained by, its difficulty — "hard" exists at every grade level,
 * "1ro primaria" accepts every difficulty. Do NOT introduce cross-validation
 * between the two; see the independence test in `grade-level.spec.ts`.
 *
 * Kept local to the exams domain (not `packages/shared`) for now: only the
 * exams module consumes it in this PR's scope. Promote it to
 * `packages/shared` if/when the bank module (questions) needs the same
 * catalog, mirroring how `Difficulty` already lives there.
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
 * Educational stage — the coarse grouping of grade levels that the course
 * catalog is divided by (courses belong to exactly one stage):
 *   escuela         → primaria_1..6   (áreas CNEB, temas iniciales)
 *   colegio         → secundaria_1..5 (áreas CNEB, temas completos)
 *   preuniversitario→ pre             (desglose académico de admisión)
 */
export const STAGES = ["escuela", "colegio", "preuniversitario"] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  escuela: "Escuela (Primaria)",
  colegio: "Colegio (Secundaria)",
  preuniversitario: "Preuniversitario",
};

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
