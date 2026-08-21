import { Difficulty } from "../enums/difficulty.enum";
import { ExamStatus } from "./exam.dto";
import { QuestionStatus } from "./bank-question.dto";

/**
 * One row of `GET /dashboard/stats`'s `exams.recent` array.
 *
 * Declared here rather than twice — it was inlined as an anonymous object
 * type on the API's `DashboardStats["exams"]["recent"]` and `DashboardRecentExam`
 * on the web's `dashboard.models.ts`, with nothing tying a field renamed on
 * the wire to a compile failure on the client (audit 2026-08-21, M4b).
 */
export interface DashboardRecentExam {
  readonly id: string;
  readonly title: string;
  readonly status: ExamStatus;
  readonly createdAt: string;
}

/**
 * `GET /dashboard/stats` response — mostly aggregates over the bank and
 * exams tables, plus the 5 most recent exams for the requester's tenant.
 *
 * Declared here rather than twice — it was `DashboardStats` in the API's
 * `dashboard-stats.service.ts` and `DashboardStats` again in the web's
 * `dashboard.models.ts` (audit 2026-08-21, M4b). Reuses `Difficulty`,
 * `QuestionStatus` and `ExamStatus` from their own DTOs rather than
 * redeclaring narrower per-dashboard copies — the web used to declare its
 * own `BankQuestionStatus`/`DashboardExamStatus` unions with exactly the
 * same literal values as those two.
 *
 * `bank.byStatus` is fetched by the client but never rendered — the
 * dashboard screen only shows `bank.total` and a chart keyed by
 * `bank.byDifficulty`. It stays on the wire because the API derives
 * `aiDrafts.pending` from the same grouped query (its `draft` bucket, see
 * `dashboard-stats.service.ts`) — removing the field would mean either a
 * second bank query just for that one number, or leaking the intermediate
 * shape some other way. Flagged here (not fixed) per the M4b audit's
 * instruction to report, not paper over, numbers with no UI consumer.
 */
export interface DashboardStats {
  readonly bank: {
    readonly total: number;
    readonly byDifficulty: Record<Difficulty, number>;
    readonly byStatus: Record<QuestionStatus, number>;
  };
  readonly exams: {
    readonly total: number;
    readonly byStatus: Record<ExamStatus, number>;
    readonly recent: readonly DashboardRecentExam[];
  };
  readonly aiDrafts: { readonly pending: number };
}
