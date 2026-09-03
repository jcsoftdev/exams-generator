import { Stage } from '@exams-generator/shared';

/**
 * The grade labels are a CONTRACT now, not just web copy: the API's folder
 * seeder generates folder names with the same suffix (`folderNameForTopic`).
 * Re-exported from `@exams-generator/shared` so this file stays the single
 * import site the bank/ai/exams models already use.
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
