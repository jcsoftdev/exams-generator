import type { PoolConfig } from "pg";

/**
 * Resolves `DATABASE_URL` for local dev/test contexts where a shell
 * profile hasn't exported it (e.g. running `pnpm test` directly against
 * the docker-compose Postgres without sourcing the root `.env`). Falls
 * back to the exact docker-compose default documented in
 * `infra/env.example`. Production deploys (Dokploy, `infra/docker-compose.yml`
 * `api` service) always set `DATABASE_URL` explicitly, so the fallback
 * never applies there.
 */
export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://exams:exams@localhost:5439/exams_generator";
}

/**
 * Per-statement ceiling, applied to every connection this pool hands out.
 *
 * 30s rather than something tighter, and the floor is NOT about read queries:
 * `node dist/db/seed.js` runs at container boot on this same pool and inserts
 * the collected bank in batches of 1000 rows (`seed-collected-questions.ts`).
 * A limit under one batch's duration would not show up as a slow page — it
 * would fail the deploy. 30s is far above what any request-path query here
 * should ever take while still bounding a runaway one.
 */
export const POOL_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Connection-pool settings (docs/audit-2026-08-26-prod-latency.md §5.2).
 *
 * This used to be `new Pool({ connectionString })` and nothing more, which
 * meant `max` fell to node-postgres' default of 10 by accident rather than by
 * decision, and the three timeouts below did not exist at all — node-postgres
 * has no default for any of them. Ten connections is genuinely the right size
 * for a single API replica (`docker-compose.dokploy.yml` pins `replicas: 1`
 * and explains why), so that number is unchanged; what is new is that nothing
 * can now hold one of the ten indefinitely.
 */
export function resolvePoolConfig(): PoolConfig & { statement_timeout: number } {
  return {
    connectionString: resolveDatabaseUrl(),
    // Stated, not inherited. Raising it is only meaningful alongside raising
    // `replicas`, which has its own blockers documented in the compose file.
    max: 10,
    // Return idle connections instead of pinning ten sockets open against a
    // Postgres that shares a 6-vCPU host with 34 other services.
    idleTimeoutMillis: 30_000,
    // Fail fast when the pool is exhausted or Postgres is unreachable. Without
    // it, a request waits forever for a connection and the caller sees a hung
    // socket rather than an error.
    connectionTimeoutMillis: 5_000,
    statement_timeout: POOL_STATEMENT_TIMEOUT_MS,
  };
}
