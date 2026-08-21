import { Injectable } from "@nestjs/common";
import { Difficulty, DashboardStats as SharedDashboardStats } from "@exams-generator/shared";
import { EXAM_STATUSES, ExamStatus, QUESTION_STATUSES, QuestionStatus } from "../../db/schema/enums";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { ExamsRepository } from "../exams/exams.repository";

const RECENT_EXAMS_LIMIT = 5;

/**
 * Aliased from `@exams-generator/shared` rather than redeclared: it used to
 * be declared again here and a third time on the web (`dashboard.models.ts`),
 * with nothing tying a field renamed on the wire to a compile failure on the
 * client (audit 2026-08-21, M4b). `ExamStatus`/`QuestionStatus` above stay
 * imported from the DB schema's own enums — they drive `zeroedByExamStatus`/
 * `zeroedByQuestionStatus`'s iteration — and are pinned against the shared
 * DTO's identical unions by `exam-contract.spec.ts` and
 * `bank-question-contract.spec.ts` respectively, same as every other module
 * that returns a shared DTO.
 */
export type DashboardStats = SharedDashboardStats;

function zeroedByDifficulty(): Record<Difficulty, number> {
  return { [Difficulty.Easy]: 0, [Difficulty.Medium]: 0, [Difficulty.Hard]: 0 };
}

function zeroedByQuestionStatus(): Record<QuestionStatus, number> {
  const result = {} as Record<QuestionStatus, number>;
  for (const status of QUESTION_STATUSES) result[status] = 0;
  return result;
}

function zeroedByExamStatus(): Record<ExamStatus, number> {
  const result = {} as Record<ExamStatus, number>;
  for (const status of EXAM_STATUSES) result[status] = 0;
  return result;
}

/**
 * Assembles `GET /dashboard/stats` (design doc §2). `aiDrafts.pending` is
 * derived from the SAME grouped bank query as `byStatus` (sum of the
 * `draft` bucket) — no separate repository call, per design doc §2.
 *
 * Platform staff (`user.tenantId === null`) have no owning tenant, and
 * `exams.tenant_id` is NOT NULL (an exam always belongs to a school —
 * `exams.schema.ts`). Unlike `exams.service.ts`'s private `requireTenant()`,
 * which throws `ForbiddenException` for staff, this dashboard is reachable
 * by every role (it's the first `PRINCIPAL_GROUP` nav item, not gated like
 * `settings`) — so staff simply see zeroed exam stats instead of a 403.
 */
@Injectable()
export class DashboardStatsService {
  constructor(
    private readonly bankRepository: BankRepository,
    private readonly examsRepository: ExamsRepository,
  ) {}

  async getStats(user: AuthTokenPayload): Promise<DashboardStats> {
    const bankGroups = await this.bankRepository.countByDifficultyAndStatus(user.tenantId);

    const byDifficulty = zeroedByDifficulty();
    const byStatus = zeroedByQuestionStatus();
    for (const group of bankGroups) {
      byDifficulty[group.difficulty] += group.total;
      byStatus[group.status] += group.total;
    }
    const bankTotal = bankGroups.reduce((sum, g) => sum + g.total, 0);

    const exams = user.tenantId
      ? await this.buildExamStats(user.tenantId)
      : { total: 0, byStatus: zeroedByExamStatus(), recent: [] };

    return {
      bank: { total: bankTotal, byDifficulty, byStatus },
      exams,
      aiDrafts: { pending: byStatus.draft },
    };
  }

  private async buildExamStats(tenantId: string): Promise<DashboardStats["exams"]> {
    const [examGroups, recent] = await Promise.all([
      this.examsRepository.countByStatus(tenantId),
      this.examsRepository.listRecent(tenantId, RECENT_EXAMS_LIMIT),
    ]);

    const byStatus = zeroedByExamStatus();
    for (const group of examGroups) {
      byStatus[group.status] += group.total;
    }
    const total = examGroups.reduce((sum, g) => sum + g.total, 0);

    return { total, byStatus, recent };
  }
}
