import { Difficulty } from '@exams-generator/shared';

/** Bank question lifecycle status (mirrors the API's `QUESTION_STATUSES` — `apps/api/src/db/schema/enums.ts`). */
export type BankQuestionStatus = 'draft' | 'approved' | 'archived';

/** Exam lifecycle status (mirrors the API's `EXAM_STATUSES` — `apps/api/src/db/schema/enums.ts`). */
export type DashboardExamStatus = 'draft' | 'ready';

export interface DashboardRecentExam {
  readonly id: string;
  readonly title: string;
  readonly status: DashboardExamStatus;
  readonly createdAt: string;
}

/** `GET /dashboard/stats` response shape (design doc §2) — mirrors the API's `DashboardStats`. */
export interface DashboardStats {
  readonly bank: {
    readonly total: number;
    readonly byDifficulty: Record<Difficulty, number>;
    readonly byStatus: Record<BankQuestionStatus, number>;
  };
  readonly exams: {
    readonly total: number;
    readonly byStatus: Record<DashboardExamStatus, number>;
    readonly recent: readonly DashboardRecentExam[];
  };
  readonly aiDrafts: { readonly pending: number };
}
