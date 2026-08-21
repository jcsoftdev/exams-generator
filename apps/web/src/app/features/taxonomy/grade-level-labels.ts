import { GradeLevel, Stage } from '@exams-generator/shared';

/**
 * Spanish labels for the grade-level and stage catalogs.
 *
 * The catalogs themselves are a contract and live in
 * `@exams-generator/shared`; these are UI copy, so they stay in the web — but
 * in ONE place. They used to be written out three times (bank, ai and exams
 * models), which is three chances for "4° secundaria" to become "4to
 * secundaria" on one screen only (audit 2026-08-20, M4).
 */
export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  primaria_1: '1° primaria',
  primaria_2: '2° primaria',
  primaria_3: '3° primaria',
  primaria_4: '4° primaria',
  primaria_5: '5° primaria',
  primaria_6: '6° primaria',
  secundaria_1: '1° secundaria',
  secundaria_2: '2° secundaria',
  secundaria_3: '3° secundaria',
  secundaria_4: '4° secundaria',
  secundaria_5: '5° secundaria',
  pre: 'Pre-admisión',
};

/**
 * Long form, for controls where the stage is the subject. The short form used
 * to disambiguate a duplicated course name lives in `course-label.ts`.
 */
export const STAGE_LABELS: Record<Stage, string> = {
  escuela: 'Escuela (Primaria)',
  colegio: 'Colegio (Secundaria)',
  preuniversitario: 'Preuniversitario',
};
