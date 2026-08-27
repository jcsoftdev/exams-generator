import { resolveDatabaseUrl, resolvePoolConfig } from "./env";

describe("resolveDatabaseUrl", () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("prefers DATABASE_URL when set", () => {
    process.env.DATABASE_URL = "postgres://someone@elsewhere:5432/db";
    expect(resolveDatabaseUrl()).toBe("postgres://someone@elsewhere:5432/db");
  });

  it("falls back to the documented docker-compose url", () => {
    delete process.env.DATABASE_URL;
    expect(resolveDatabaseUrl()).toBe("postgres://exams:exams@localhost:5439/exams_generator");
  });
});

describe("resolvePoolConfig", () => {
  it("carries the resolved connection string", () => {
    expect(resolvePoolConfig().connectionString).toBe(resolveDatabaseUrl());
  });

  /**
   * The pool used to be `new Pool({ connectionString })` and nothing else, so
   * every one of these was the library default — including three that have no
   * default at all (docs/audit-2026-08-26-prod-latency.md §5.2). The failure
   * mode that motivates them is not slowness: a query that hangs holds its
   * connection forever, and with `max` connections total it takes exactly
   * `max` of those to leave the API mute with nothing in the logs.
   */
  it("bounds the pool and every way a connection can be held", () => {
    const config = resolvePoolConfig();
    expect(config.max).toBe(10);
    expect(config.idleTimeoutMillis).toBeGreaterThan(0);
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config.statement_timeout).toBeGreaterThan(0);
  });

  /**
   * `statement_timeout` has a floor that is not about queries at all: the same
   * pool backs `node dist/db/seed.js`, which runs at container boot and inserts
   * the collected bank in batches of 1000 (`seed-collected-questions.ts`,
   * `BATCH_SIZE`). Tightening this below the time one batch insert takes would
   * not surface as a slow page — it would fail the deploy.
   */
  it("leaves the seeder's 1000-row batch inserts comfortable room", () => {
    expect(resolvePoolConfig().statement_timeout).toBeGreaterThanOrEqual(30_000);
  });
});
