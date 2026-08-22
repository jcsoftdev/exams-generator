import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type Redis from "ioredis";
import { Database, DRIZZLE_DB } from "../../db/client";
import { STORAGE_PORT } from "../bank/bank.constants";
import { StoragePort } from "../exams/domain/ports/storage.port";
import { HEALTH_REDIS_CLIENT } from "./health.constants";

const PING_TIMEOUT_MS = 2000;

export interface HealthCheckResult {
  readonly status: "ok" | "error";
  readonly checks: {
    readonly db: "ok" | "error";
    readonly redis: "ok" | "error";
    readonly storage: "ok" | "error";
  };
}

/** Races `promise` against a timeout — an unresponsive dependency must report unhealthy, not hang the healthcheck (docker-compose restarts on a non-200, see `infra/docker-compose.yml`). */
function withTimeout(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("health check timed out")), PING_TIMEOUT_MS),
    ),
  ]);
}

/**
 * `GET /health` (used by docker-compose to decide whether to restart the
 * `api` container, `infra/docker-compose.yml:84`) previously always
 * returned `{ status: "ok" }` regardless of whether Postgres/Redis/MinIO
 * were actually reachable (audit P2) — a container could be completely
 * unable to serve requests and still look healthy. Pings all 3 real
 * dependencies in parallel, each capped at `PING_TIMEOUT_MS`.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    // A dedicated connection, deliberately NOT the BullMQ queue's own Redis
    // client — reusing that would couple this health check's correctness to
    // BullMQ's internal connection lifecycle/reconnection state instead of a
    // plain, direct "is Redis reachable" probe.
    @Inject(HEALTH_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Same reasoning as LoginExchangeService.onModuleDestroy: without this,
  // app.close() (every e2e spec's teardown) leaves this lazily-opened Redis
  // connection open, which keeps the Jest worker process alive past the
  // test run — invisible until a spec actually calls GET /health.
  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  async check(): Promise<HealthCheckResult> {
    const [db, redis, storage] = await Promise.all([this.pingDb(), this.pingRedis(), this.pingStorage()]);
    const status = db === "ok" && redis === "ok" && storage === "ok" ? "ok" : "error";
    return { status, checks: { db, redis, storage } };
  }

  private async pingDb(): Promise<"ok" | "error"> {
    try {
      await withTimeout(this.db.execute(sql`select 1`));
      return "ok";
    } catch {
      return "error";
    }
  }

  private async pingRedis(): Promise<"ok" | "error"> {
    try {
      await withTimeout(this.redis.ping());
      return "ok";
    } catch {
      return "error";
    }
  }

  private async pingStorage(): Promise<"ok" | "error"> {
    try {
      await withTimeout(this.storage.ping());
      return "ok";
    } catch {
      return "error";
    }
  }
}
