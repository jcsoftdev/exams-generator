import { Registry } from "prom-client";
import { MetricsService, QueueDepthSource } from "./metrics.service";

function queue(name: string, counts: Record<string, number>): QueueDepthSource {
  return { name, getJobCounts: () => Promise.resolve(counts) };
}

async function metricsText(service: MetricsService): Promise<string> {
  return service.render();
}

describe("MetricsService", () => {
  it("reports how deep each queue is, per state", async () => {
    // Audit 2026-08-20 M6: a growing queue or a dead worker was invisible
    // until a user complained.
    const service = new MetricsService(new Registry(), [
      queue("generation", { waiting: 3, active: 1, failed: 2, delayed: 0, completed: 99 }),
    ]);

    const text = await metricsText(service);

    expect(text).toMatch(/exams_queue_jobs\{queue="generation",state="waiting"\} 3/);
    expect(text).toMatch(/exams_queue_jobs\{queue="generation",state="active"\} 1/);
    expect(text).toMatch(/exams_queue_jobs\{queue="generation",state="failed"\} 2/);
  });

  it("reports every queue, not just the first", async () => {
    const service = new MetricsService(new Registry(), [
      queue("generation", { waiting: 1 }),
      queue("exam-versions", { waiting: 7 }),
    ]);

    const text = await metricsText(service);

    expect(text).toMatch(/exams_queue_jobs\{queue="exam-versions",state="waiting"\} 7/);
  });

  it("still serves the rest of the metrics when a queue cannot be read", async () => {
    // Redis being down is exactly when someone is looking at this endpoint;
    // it must not answer 500 because one gauge is unavailable.
    const broken: QueueDepthSource = {
      name: "generation",
      getJobCounts: () => Promise.reject(new Error("redis down")),
    };
    const service = new MetricsService(new Registry(), [broken]);

    const text = await metricsText(service);

    expect(text).toMatch(/exams_queue_scrape_failures_total\{queue="generation"\} 1/);
    expect(text).not.toMatch(/exams_queue_jobs\{queue="generation"/);
  });

  it("records request duration by method, route template and status", async () => {
    const service = new MetricsService(new Registry(), []);

    service.recordRequest({ method: "GET", route: "/exams/:examId", statusCode: 200, durationMs: 12 });

    const text = await metricsText(service);

    // The route TEMPLATE, never the raw path — one series per endpoint, not per id.
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/exams\/:examId",status_code="200"\} 1/);
  });

  it("keeps process metrics, so a leak or a blocked event loop is visible", async () => {
    const service = new MetricsService(new Registry(), []);

    const text = await metricsText(service);

    expect(text).toContain("process_cpu_seconds_total");
    expect(text).toContain("nodejs_eventloop_lag_seconds");
  });
});
