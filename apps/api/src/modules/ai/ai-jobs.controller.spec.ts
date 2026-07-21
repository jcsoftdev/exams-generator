import { AiJobsController } from "./ai-jobs.controller";
import { GenerationJobEventsService } from "./generation-job-events.service";
import { GenerationJobsService } from "./generation-jobs.service";

function buildDeps() {
  const service = { get: jest.fn() } as unknown as jest.Mocked<GenerationJobsService>;
  const events = new GenerationJobEventsService();
  const controller = new AiJobsController(service, events);
  return { controller, service, events };
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

describe("AiJobsController - GET :id/stream", () => {
  it("writes the current job and closes immediately when it is already terminal", async () => {
    const { controller, service } = buildDeps();
    service.get.mockResolvedValue({ id: "job-1", status: "completed" } as never);
    const res = fakeResponse();

    await controller.stream(USER, "job-1", res as never);

    expect(res.writes).toEqual([`data: ${JSON.stringify({ id: "job-1", status: "completed" })}\n\n`]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("pushes a fresh write every time GenerationJobEventsService reports an update for this id, ignoring other ids", async () => {
    const { controller, service, events } = buildDeps();
    service.get
      .mockResolvedValueOnce({ id: "job-1", status: "running" } as never)
      .mockResolvedValueOnce({ id: "job-1", status: "running", createdCount: 1 } as never)
      .mockResolvedValueOnce({ id: "job-1", status: "completed", createdCount: 3 } as never);
    const res = fakeResponse();

    const pending = controller.stream(USER, "job-1", res as never);
    await Promise.resolve();

    events.notify("job-2"); // different job — must be ignored
    await Promise.resolve();
    expect(res.writes).toHaveLength(1);

    events.notify("job-1");
    await Promise.resolve();
    events.notify("job-1");
    await Promise.resolve();
    await pending;

    expect(service.get).toHaveBeenCalledTimes(3);
    expect(res.writes).toHaveLength(3);
    expect(res.writes[2]).toContain('"status":"completed"');
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from job updates when the client closes the connection", async () => {
    const { controller, service, events } = buildDeps();
    service.get.mockResolvedValue({ id: "job-1", status: "running" } as never);
    const res = fakeResponse();

    await controller.stream(USER, "job-1", res as never);
    res.triggerClose();
    events.notify("job-1");
    await Promise.resolve();

    // Only the initial write — the closed connection must not receive more.
    expect(res.writes).toHaveLength(1);
  });
});
