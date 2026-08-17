import { Role } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { BankController } from "./bank.controller";
import { BankService } from "./bank.service";
import { QuestionListItem } from "./bank.repository";

const STAFF_USER: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };

const ITEM = { id: "q1" } as unknown as QuestionListItem;

function buildController() {
  const service = {
    listQuestions: jest.fn(),
  } as unknown as jest.Mocked<BankService>;
  const controller = new BankController(service);
  return { controller, service };
}

/**
 * docs/audit-2026-08-14.md — "GET /bank/questions sin page sigue sin tope"
 * (P2, deliberate debt): `GET /bank/questions` with no `page` query param
 * used to call `BankService.listQuestions(user, filters)` (the unpaginated
 * overload) and hand back whatever came out — no LIMIT at all, the exact
 * shape of the P0 that made `/app/bank` download 41MB. Both web callers of
 * that unpaginated shape (`AiReviewQueueComponent`, `GenerationJobDetailComponent`)
 * are now genuinely paginated (see ai.service.ts / ai-review-queue.component.ts /
 * generation-job-detail.component.ts), so this closes the item: the
 * page-omitted request now goes through the SAME paginated repository path
 * as an explicit `page=1`, just with a fixed default window — never an
 * unbounded scan — while still answering with the legacy flat-array shape
 * so any stray caller (curl, a script, a test fixture) that never adopted
 * `page`/`pageSize` keeps decoding an array, not `{items,total}`.
 */
describe("BankController.listQuestions — default pagination cap", () => {
  it("without ?page, requests a bounded page (1, 100) from the service instead of the unpaginated overload — and unwraps the flat array", async () => {
    const { controller, service } = buildController();
    service.listQuestions.mockResolvedValue({ items: [ITEM], total: 1 });

    const result = await controller.listQuestions(STAFF_USER, { status: "draft" });

    expect(service.listQuestions).toHaveBeenCalledWith(
      STAFF_USER,
      expect.objectContaining({ status: "draft" }),
      { page: 1, pageSize: 100 },
    );
    // Retro-compat: still a bare array, not the {items,total} envelope —
    // existing consumers of the page-omitted shape decode an array.
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([ITEM]);
  });

  it("with ?page, delegates to the clamped paginated overload and returns the {items,total} envelope as-is", async () => {
    const { controller, service } = buildController();
    service.listQuestions.mockResolvedValue({ items: [ITEM], total: 1 });

    const result = await controller.listQuestions(STAFF_USER, { page: "2", pageSize: "5" });

    expect(service.listQuestions).toHaveBeenCalledWith(STAFF_USER, expect.anything(), {
      page: 2,
      pageSize: 5,
    });
    expect(result).toEqual({ items: [ITEM], total: 1 });
  });

  it("page=0&pageSize=0 clamps the SAME as an explicit page (page 1, pageSize 1), not the wider default-cap window", async () => {
    const { controller, service } = buildController();
    service.listQuestions.mockResolvedValue({ items: [], total: 0 });

    await controller.listQuestions(STAFF_USER, { page: "0", pageSize: "0" });

    expect(service.listQuestions).toHaveBeenCalledWith(STAFF_USER, expect.anything(), {
      page: 1,
      pageSize: 1,
    });
  });
});
