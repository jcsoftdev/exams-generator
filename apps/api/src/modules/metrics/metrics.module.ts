import { Module } from "@nestjs/common";
import { BullModule, getQueueToken } from "@nestjs/bullmq";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Queue } from "bullmq";
import { Registry } from "prom-client";
import { HttpMetricsInterceptor } from "./http-metrics.interceptor";
import { MetricsController } from "./metrics.controller";
import { MetricsService, QueueDepthSource } from "./metrics.service";

/**
 * Registers the two queues read-only, purely to ask them how deep they are.
 * `BullModule.registerQueue` is idempotent per name, so declaring them here as
 * well as in `AiModule`/`ExamsModule` shares one connection rather than
 * opening a second.
 */
@Module({
  imports: [BullModule.registerQueue({ name: "generation" }, { name: "exam-versions" })],
  controllers: [MetricsController],
  providers: [
    { provide: Registry, useFactory: () => new Registry() },
    {
      provide: MetricsService,
      inject: [Registry, getQueueToken("generation"), getQueueToken("exam-versions")],
      useFactory: (registry: Registry, generation: Queue, examVersions: Queue) =>
        new MetricsService(registry, [generation, examVersions] as unknown as QueueDepthSource[]),
    },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class MetricsModule {}
