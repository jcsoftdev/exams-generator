import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../app.module";
import { pool } from "../../db/client";

/**
 * Full HTTP e2e for `GET /metrics` — the scrape endpoint has no JWT (a
 * Prometheus scraper cannot hold one), so its access rules are worth
 * exercising over real HTTP rather than trusting the unit tests of their
 * parts.
 */
describe("Metrics endpoint (e2e)", () => {
  let app: INestApplication;
  const originalToken = process.env.METRICS_TOKEN;

  beforeAll(async () => {
    delete process.env.METRICS_TOKEN;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (originalToken === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = originalToken;
    }
    await app.close();
    await pool.end();
  });

  it("serves the three signals: request latency, queue depth and process health", async () => {
    // Warm the histogram with a real request so it has a series to report.
    await request(app.getHttpServer()).get("/health");

    const res = await request(app.getHttpServer()).get("/metrics").expect(200);

    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("http_request_duration_seconds");
    expect(res.text).toContain("exams_queue_jobs");
    expect(res.text).toContain("nodejs_eventloop_lag_seconds");
  });

  it("labels latency by route template, never by the concrete path", async () => {
    // One series per endpoint. Labelling by path would mint a new series per
    // exam id and eventually take Prometheus down with it.
    await request(app.getHttpServer()).get("/health");

    const res = await request(app.getHttpServer()).get("/metrics").expect(200);

    expect(res.text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/health"/);
  });

  it("rejects a wrong token once one is configured", async () => {
    process.env.METRICS_TOKEN = "scrape-me";
    try {
      await request(app.getHttpServer()).get("/metrics").expect(403);
      await request(app.getHttpServer()).get("/metrics").set("Authorization", "Bearer wrong").expect(403);
      await request(app.getHttpServer()).get("/metrics").set("Authorization", "Bearer scrape-me").expect(200);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});
