import { Difficulty, Role } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { ExamsRepository } from "../exams/exams.repository";
import { DashboardStatsService } from "./dashboard-stats.service";

const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };
const STAFF_USER: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };

function buildDeps() {
  const bankRepository = {
    countByDifficultyAndStatus: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<BankRepository>;

  const examsRepository = {
    countByStatus: jest.fn().mockResolvedValue([]),
    listRecent: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ExamsRepository>;

  const service = new DashboardStatsService(bankRepository, examsRepository);
  return { service, bankRepository, examsRepository };
}

describe("DashboardStatsService.getStats", () => {
  it("aggregates bank counts by difficulty and status, zero-filling missing buckets", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.countByDifficultyAndStatus.mockResolvedValue([
      { difficulty: Difficulty.Easy, status: "approved", total: 5 },
      { difficulty: Difficulty.Easy, status: "draft", total: 2 },
      { difficulty: Difficulty.Hard, status: "approved", total: 3 },
    ]);

    const result = await service.getStats(TEACHER_USER);

    expect(result.bank.total).toBe(10);
    expect(result.bank.byDifficulty).toEqual({ easy: 7, medium: 0, hard: 3 });
    expect(result.bank.byStatus).toEqual({ draft: 2, approved: 8, archived: 0 });
  });

  it("derives aiDrafts.pending from the draft bucket of the same bank query (no extra call)", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.countByDifficultyAndStatus.mockResolvedValue([
      { difficulty: Difficulty.Medium, status: "draft", total: 4 },
    ]);

    const result = await service.getStats(TEACHER_USER);

    expect(result.aiDrafts.pending).toBe(4);
  });

  it("scopes the bank query to the requester's tenantId", async () => {
    const { service, bankRepository } = buildDeps();

    await service.getStats(TEACHER_USER);

    expect(bankRepository.countByDifficultyAndStatus).toHaveBeenCalledWith("tenant-1");
  });

  it("aggregates exam counts by status and returns recent exams for a tenant user", async () => {
    const { service, examsRepository } = buildDeps();
    examsRepository.countByStatus.mockResolvedValue([
      { status: "draft", total: 1 },
      { status: "ready", total: 2 },
    ]);
    examsRepository.listRecent.mockResolvedValue([
      { id: "exam-1", title: "Examen de Álgebra", status: "ready", createdAt: "2026-07-01T00:00:00.000Z" },
    ]);

    const result = await service.getStats(TEACHER_USER);

    expect(result.exams.total).toBe(3);
    expect(result.exams.byStatus).toEqual({ draft: 1, ready: 2 });
    expect(result.exams.recent).toEqual([
      { id: "exam-1", title: "Examen de Álgebra", status: "ready", createdAt: "2026-07-01T00:00:00.000Z" },
    ]);
    expect(examsRepository.listRecent).toHaveBeenCalledWith("tenant-1", 5);
  });

  it("returns zeroed exam stats for platform staff (tenantId=null), never calling ExamsRepository", async () => {
    const { service, examsRepository } = buildDeps();

    const result = await service.getStats(STAFF_USER);

    expect(result.exams).toEqual({ total: 0, byStatus: { draft: 0, ready: 0 }, recent: [] });
    expect(examsRepository.countByStatus).not.toHaveBeenCalled();
    expect(examsRepository.listRecent).not.toHaveBeenCalled();
  });
});
