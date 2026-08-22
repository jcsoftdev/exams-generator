import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * The slice of a BullMQ `Queue` this service needs. Narrow on purpose: the
 * spec can hand it a plain object, and nothing here can accidentally start
 * enqueuing.
 */
export interface QueueDepthSource {
  readonly name: string;
  getJobCounts(): Promise<Record<string, number>>;
}

export interface RequestSample {
  readonly method: string;
  /** The route TEMPLATE (`/exams/:examId`), never the concrete path. */
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

/**
 * Buckets in seconds, chosen from what this API actually does rather than
 * from a default list: most reads answer in tens of milliseconds, a Typst
 * preview compile takes a second or two, and an AI call is tens of seconds.
 * Without the tail buckets the p99 of the slow endpoints would round into
 * "+Inf" and say nothing.
 */
const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30];

/**
 * Prometheus metrics for `GET /metrics` (audit 2026-08-20, M6 — the only
 * observability was logs, so a worker that died or a queue that kept growing
 * was invisible until a user complained).
 *
 * Three things are exposed, matching the three questions worth asking:
 * request rate/errors/latency (the histogram's count, its `status_code`
 * label and its buckets), saturation (queue depth per state), and process
 * health (`collectDefaultMetrics` — event-loop lag and memory).
 *
 * Queue depth is read AT SCRAPE TIME rather than polled on a timer: nothing
 * is measured when nobody is looking, and the number is never stale by up to
 * a poll interval.
 */
@Injectable()
export class MetricsService {
  private readonly requestDuration: Histogram<"method" | "route" | "status_code">;
  private readonly queueScrapeFailures: Counter<"queue">;
  private readonly queueDepth: Gauge<"queue" | "state">;

  constructor(
    private readonly registry: Registry,
    private readonly queues: readonly QueueDepthSource[],
  ) {
    collectDefaultMetrics({ register: this.registry });

    this.requestDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request duration by route template and status code.",
      labelNames: ["method", "route", "status_code"],
      buckets: DURATION_BUCKETS,
      registers: [this.registry],
    });

    this.queueScrapeFailures = new Counter({
      name: "exams_queue_scrape_failures_total",
      help: "Scrapes that could not read a queue's depth — Redis unreachable, usually.",
      labelNames: ["queue"],
      registers: [this.registry],
    });
    // Touch every series so a queue that has never failed reports 0 rather
    // than being absent — "no data" and "no failures" look identical on a
    // graph otherwise.
    for (const q of this.queues) {
      this.queueScrapeFailures.labels(q.name).inc(0);
    }

    this.queueDepth = new Gauge({
      name: "exams_queue_jobs",
      help: "Jobs in each BullMQ queue, by state — the saturation signal.",
      labelNames: ["queue", "state"],
      registers: [this.registry],
    });
  }

  recordRequest({ method, route, statusCode, durationMs }: RequestSample): void {
    this.requestDuration.labels(method, route, String(statusCode)).observe(durationMs / 1000);
  }

  /**
   * The scrape body, in Prometheus' text exposition format.
   *
   * Queue depth is refreshed HERE rather than from a `collect` callback on the
   * gauge. prom-client serialises metrics in registration order, so a failure
   * counter incremented inside a collect callback is written out before the
   * callback that increments it has run — the first failed scrape reported
   * zero failures and only owned up on the next one. Doing the read first
   * makes the whole scrape describe the same instant.
   */
  async render(): Promise<string> {
    await this.refreshQueueDepth();
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  private async refreshQueueDepth(): Promise<void> {
    this.queueDepth.reset();

    for (const queue of this.queues) {
      try {
        const counts = await queue.getJobCounts();
        for (const [state, value] of Object.entries(counts)) {
          this.queueDepth.labels(queue.name, state).set(value);
        }
      } catch {
        // One unreachable queue must not blank the whole scrape: the rest of
        // the metrics are exactly what someone debugging a Redis outage needs.
        this.queueScrapeFailures.labels(queue.name).inc();
      }
    }
  }
}
