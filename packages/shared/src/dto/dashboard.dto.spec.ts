import { Difficulty } from "../enums/difficulty.enum";
import { EXAM_STATUSES } from "./exam.dto";
import { QUESTION_STATUSES } from "./bank-question.dto";
import { DashboardStats } from "./dashboard.dto";

/**
 * `DashboardStats` reuses `ExamStatus`/`QuestionStatus` rather than declaring
 * its own narrower unions (audit 2026-08-21, M4b). This pins that its two
 * `byStatus` records are keyed by EVERY value of the status list they claim
 * to cover — a status added to one list and not the other fails here instead
 * of surfacing as a bucket the UI has no bar for.
 */
describe("DashboardStats", () => {
  it("accepts a bank.byStatus record covering every QuestionStatus", () => {
    const byStatus = Object.fromEntries(QUESTION_STATUSES.map((status) => [status, 0])) as DashboardStats["bank"]["byStatus"];

    const stats: DashboardStats = {
      bank: {
        total: 0,
        byDifficulty: { [Difficulty.Easy]: 0, [Difficulty.Medium]: 0, [Difficulty.Hard]: 0 },
        byStatus,
      },
      exams: { total: 0, byStatus: { draft: 0, ready: 0 }, recent: [] },
      aiDrafts: { pending: 0 },
    };

    expect(Object.keys(stats.bank.byStatus)).toEqual([...QUESTION_STATUSES]);
  });

  it("accepts an exams.byStatus record covering every ExamStatus, and a recent row typed by it", () => {
    const byStatus = Object.fromEntries(EXAM_STATUSES.map((status) => [status, 0])) as DashboardStats["exams"]["byStatus"];

    const stats: DashboardStats = {
      bank: { total: 0, byDifficulty: { [Difficulty.Easy]: 0, [Difficulty.Medium]: 0, [Difficulty.Hard]: 0 }, byStatus: { draft: 0, approved: 0, archived: 0 } },
      exams: {
        total: 1,
        byStatus,
        recent: [{ id: "exam-1", title: "Examen", status: "ready", createdAt: "2026-08-21T00:00:00.000Z" }],
      },
      aiDrafts: { pending: 0 },
    };

    expect(Object.keys(stats.exams.byStatus)).toEqual([...EXAM_STATUSES]);
  });
});
