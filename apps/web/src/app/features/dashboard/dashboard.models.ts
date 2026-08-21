/**
 * `GET /dashboard/stats` response shape (design doc §2) comes from
 * `@exams-generator/shared`, which the API compiles against too — re-exported
 * here so this feature keeps its own local imports. It used to be declared a
 * second time here as `DashboardStats`/`DashboardRecentExam`, with its own
 * `BankQuestionStatus`/`DashboardExamStatus` copies of `QuestionStatus`/
 * `ExamStatus` (same audit as `exams.models.ts`, 2026-08-21, M4b).
 */
export type { DashboardStats, DashboardRecentExam } from '@exams-generator/shared';
