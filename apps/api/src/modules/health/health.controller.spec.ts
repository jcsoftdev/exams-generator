import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

function fakeResponse() {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe("HealthController", () => {
  it("returns 200 with the aggregated result when every dependency is reachable", async () => {
    const service = { check: async () => ({ status: "ok" as const, checks: { db: "ok", redis: "ok", storage: "ok" } }) };
    const controller = new HealthController(service as unknown as HealthService);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { db: "ok", redis: "ok", storage: "ok" } });
  });

  it("returns 503 when any dependency is unreachable", async () => {
    const service = {
      check: async () => ({ status: "error" as const, checks: { db: "ok", redis: "error", storage: "ok" } }),
    };
    const controller = new HealthController(service as unknown as HealthService);
    const res = fakeResponse();

    await controller.check(res as never);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ status: "error", checks: { db: "ok", redis: "error", storage: "ok" } });
  });
});
