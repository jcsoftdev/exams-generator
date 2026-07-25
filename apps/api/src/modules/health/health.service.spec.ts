import { HealthService } from "./health.service";
import type { Database } from "../../db/client";
import type { StoragePort } from "../exams/domain/ports/storage.port";

function build(overrides: { dbOk?: boolean; redisOk?: boolean; storageOk?: boolean }) {
  const db = {
    execute: overrides.dbOk === false ? () => Promise.reject(new Error("db down")) : () => Promise.resolve(),
  } as unknown as Database;
  const storage = {
    ping: overrides.storageOk === false ? () => Promise.reject(new Error("storage down")) : () => Promise.resolve(),
  } as unknown as StoragePort;
  const redis = {
    ping: overrides.redisOk === false ? () => Promise.reject(new Error("redis down")) : () => Promise.resolve("PONG"),
  } as never;
  return new HealthService(db, storage, redis);
}

describe("HealthService", () => {
  it("reports ok when every dependency is reachable", async () => {
    const service = build({});
    const result = await service.check();
    expect(result).toEqual({ status: "ok", checks: { db: "ok", redis: "ok", storage: "ok" } });
  });

  it("reports error and identifies which dependency failed when db is down", async () => {
    const service = build({ dbOk: false });
    const result = await service.check();
    expect(result).toEqual({ status: "error", checks: { db: "error", redis: "ok", storage: "ok" } });
  });

  it("reports error when redis is down", async () => {
    const service = build({ redisOk: false });
    const result = await service.check();
    expect(result.status).toBe("error");
    expect(result.checks.redis).toBe("error");
  });

  it("reports error when storage is down", async () => {
    const service = build({ storageOk: false });
    const result = await service.check();
    expect(result.status).toBe("error");
    expect(result.checks.storage).toBe("error");
  });
});
