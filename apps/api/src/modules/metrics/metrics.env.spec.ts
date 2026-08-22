import { metricsRequireToken, resolveMetricsToken } from "./metrics.env";

describe("metrics access", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("treats a blank or whitespace token as no token at all", () => {
    process.env.METRICS_TOKEN = "   ";
    expect(resolveMetricsToken()).toBeUndefined();

    delete process.env.METRICS_TOKEN;
    expect(resolveMetricsToken()).toBeUndefined();
  });

  it("returns the configured token, trimmed", () => {
    process.env.METRICS_TOKEN = " s3cret ";
    expect(resolveMetricsToken()).toBe("s3cret");
  });

  it("demands a token in production and not elsewhere", () => {
    // The endpoint cannot authenticate a scraper the normal way, so the choice
    // is explicit rather than implicit: prod refuses to serve without a token.
    process.env.NODE_ENV = "production";
    expect(metricsRequireToken()).toBe(true);

    process.env.NODE_ENV = "development";
    expect(metricsRequireToken()).toBe(false);
  });
});
