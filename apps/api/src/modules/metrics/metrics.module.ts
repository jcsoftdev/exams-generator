import { Module, OnModuleInit } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { APP_INTERCEPTOR, ModuleRef } from "@nestjs/core";
import { Queue } from "bullmq";
import { Registry } from "prom-client";
import { HttpMetricsInterceptor } from "./http-metrics.interceptor";
import { MetricsController } from "./metrics.controller";
import { MetricsService, QueueDepthSource } from "./metrics.service";

/** The queues this module reports depth for — owned by AiModule and ExamsModule. */
const OBSERVED_QUEUES = ["generation", "exam-versions"] as const;

/**
 * Metrics for `GET /metrics` (audit 2026-08-20, M6).
 *
 * It deliberately does NOT call `BullModule.registerQueue`. Doing so looked
 * harmless — same names, same connection options — but it creates a SECOND
 * `Queue` instance per name, and every BullMQ queue opens its own Redis
 * client. Under the e2e suite that is 26 AppModule boots × 4 workers, so the
 * convenience of one decorator doubles the connection count of the whole run.
 * Reading is not owning: the queues are looked up from the already-built
 * injector instead, `strict: false` because they live in other modules.
 */
@Module({
  controllers: [MetricsController],
  providers: [
    { provide: Registry, useFactory: () => new Registry() },
    {
      provide: MetricsService,
      inject: [Registry],
      useFactory: (registry: Registry) => new MetricsService(registry, []),
    },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class MetricsModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Wired here rather than in the factory because the feature modules that own
   * the queues are not guaranteed to be initialised while this module's
   * providers are being constructed.
   */
  onModuleInit(): void {
    const found: QueueDepthSource[] = [];
    for (const name of OBSERVED_QUEUES) {
      const queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      found.push({ name, getJobCounts: () => queue.getJobCounts() });
    }
    this.metrics.observeQueues(found);
  }
}
