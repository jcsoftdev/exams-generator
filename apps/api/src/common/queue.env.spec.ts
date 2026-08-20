import { resolveRedisConnection } from "./queue.env";

describe("resolveRedisConnection", () => {
  const originalHost = process.env.REDIS_HOST;
  const originalPort = process.env.REDIS_PORT;
  const originalPassword = process.env.REDIS_PASSWORD;

  afterEach(() => {
    for (const [k, v] of [
      ["REDIS_HOST", originalHost],
      ["REDIS_PORT", originalPort],
      ["REDIS_PASSWORD", originalPassword],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("falls back to the docker-compose host mapping when nothing is set", () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;

    expect(resolveRedisConnection()).toEqual({ host: "localhost", port: 6390 });
  });

  it("reads REDIS_HOST/REDIS_PORT when set", () => {
    process.env.REDIS_HOST = "exams-redis";
    process.env.REDIS_PORT = "6379";
    delete process.env.REDIS_PASSWORD;

    expect(resolveRedisConnection()).toEqual({ host: "exams-redis", port: 6379 });
  });

  /**
   * Audit 2026-08-20 (H4): the Dokploy deployment shares one Docker network
   * with unrelated projects, so the production Redis must be able to require
   * auth. Every consumer (BullMQ root, health ping, login-exchange) spreads
   * this object into its client options, so supporting the password HERE
   * covers all three without touching them.
   */
  it("includes the password only when REDIS_PASSWORD is set and non-empty", () => {
    process.env.REDIS_PASSWORD = "s3cret";

    expect(resolveRedisConnection()).toMatchObject({ password: "s3cret" });
  });

  it("omits the password key entirely when REDIS_PASSWORD is unset or blank", () => {
    process.env.REDIS_PASSWORD = "";

    // `password: undefined` vs an absent key matters to ioredis: an explicit
    // empty/undefined password still triggers an AUTH command against a
    // passwordless local Redis, which then rejects the handshake.
    expect(Object.keys(resolveRedisConnection())).not.toContain("password");
  });
});
