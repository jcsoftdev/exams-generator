import { NotFoundException } from "@nestjs/common";
import { ExamVersionJobEventsService } from "./exam-version-job-events.service";
import { ExamVersionJobsService } from "./exam-version-jobs.service";
import { ExamsController } from "./exams.controller";

function buildDeps() {
  const versionJobsService = { get: jest.fn() } as unknown as jest.Mocked<ExamVersionJobsService>;
  const versionJobEvents = new ExamVersionJobEventsService();
  const controller = new ExamsController(
    null as never,
    null as never,
    versionJobsService,
    versionJobEvents,
  );
  return { controller, versionJobsService, versionJobEvents };
}

function fakeResponse() {
  const writes: string[] = [];
  const closeListeners: (() => void)[] = [];
  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => writes.push(chunk)),
    end: jest.fn(),
    on: jest.fn((event: string, listener: () => void) => {
      if (event === "close") closeListeners.push(listener);
    }),
    writes,
    triggerClose: () => closeListeners.forEach((l) => l()),
  };
}

const USER = { sub: "u1", tenantId: "t1", role: "teacher" } as never;

describe("ExamsController - GET :examId/versions/jobs/:jobId/stream", () => {
  it("writes the current job and closes immediately when it is already terminal", async () => {
    const { controller, versionJobsService } = buildDeps();
    versionJobsService.get.mockResolvedValue({ id: "job-1", status: "completed" } as never);
    const res = fakeResponse();

    await controller.streamVersionJob(USER, "job-1", res as never);

    expect(res.writes).toEqual([`data: ${JSON.stringify({ id: "job-1", status: "completed" })}\n\n`]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression (P0): same ordering bug as `AiJobsController.stream()` — this
   * route is a deliberate copy of it. The tenant-scoped lookup used to run
   * AFTER `flushHeaders()`, putting a `200 OK` on the wire for a job that
   * does not exist and then crashing the process from the exception filter.
   */
  it("rejects with the service error without touching the response when the job does not exist", async () => {
    const { controller, versionJobsService } = buildDeps();
    versionJobsService.get.mockRejectedValue(new NotFoundException("Exam version job not found"));
    const res = fakeResponse();

    await expect(controller.streamVersionJob(USER, "missing", res as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("unsubscribes from job updates when the client closes the connection", async () => {
    const { controller, versionJobsService, versionJobEvents } = buildDeps();
    versionJobsService.get.mockResolvedValue({ id: "job-1", status: "running" } as never);
    const res = fakeResponse();

    await controller.streamVersionJob(USER, "job-1", res as never);
    res.triggerClose();
    versionJobEvents.notify("job-1");
    await Promise.resolve();

    expect(res.writes).toHaveLength(1);
  });
});
