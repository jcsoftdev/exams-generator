import { Stage } from '@exams-generator/shared';

/**
 * The grade labels are pure WEB copy again: the API's folder seeder used to
 * generate folder names with a ` · <grade>` suffix (`folderNameForTopic`), and
 * that is gone — a topic is one row per concept now, so two folders of one
 * course can no longer share a name and nothing on the server renders a grade
 * (design doc 2026-09-03). The map still LIVES in `@exams-generator/shared`
 * rather than here so this file stays the single import site the bank/ai/exams
 * models already use; moving it back would be churn for no reader.
 */
export { GRADE_LEVEL_LABELS } from '@exams-generator/shared';

/**
 * Long form, for controls where the stage is the subject. The short form used
 * to disambiguate a duplicated course name lives in `course-label.ts`.
 */
export const STAGE_LABELS: Record<Stage, string> = {
  escuela: 'Escuela (Primaria)',
  colegio: 'Colegio (Secundaria)',
  preuniversitario: 'Preuniversitario',
};
