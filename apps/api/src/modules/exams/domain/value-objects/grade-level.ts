/**
 * The grade-level catalog now lives in `@exams-generator/shared` — it is a
 * contract (DB column, query param, request body, UI filter), and it had been
 * declared four times across the API and the web before that (audit
 * 2026-08-20, M4). This file stays as the exams domain's door to it so the
 * dozens of imports across the API keep working and the domain keeps reading
 * like a domain.
 *
 * `STAGE_LABELS` used to live here too and is gone: "Colegio (Secundaria)" is
 * Spanish UI copy, and nothing on the server ever read it.
 */
export { GRADE_LEVELS, STAGES, isGradeLevel, isStage, stageForGrade } from "@exams-generator/shared";
export type { GradeLevel, Stage } from "@exams-generator/shared";
