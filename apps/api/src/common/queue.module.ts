import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { resolveBullmqPrefix, resolveRedisConnection } from "./queue.env";

/**
 * Owns the single shared BullMQ connection/defaults for the whole app.
 *
 * `BullModule.forRoot` is already `global: true` internally, so this could
 * technically live inside any one feature module — it used to live in
 * `AiModule`. It was hoisted here once a SECOND queue appeared
 * (`exam-versions`, owned by `ExamsModule`): leaving it in `AiModule` would
 * have made the exams queue silently depend on the AI module being imported,
 * a dependency direction nothing in the code expresses. Feature modules now
 * only ever call `BullModule.registerQueue({ name })`.
 *
 * `attempts: 3` + exponential backoff applies to every queue: both workers
 * are resumable (each re-reads its job row and skips already-persisted work),
 * so a retry after a transient Redis/Typst/OpenRouter blip never duplicates
 * output.
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: resolveRedisConnection(),
      // Per-worker key prefix in e2e (see resolveBullmqPrefix) — undefined
      // outside tests, so dev/prod keep BullMQ's default "bull" namespace.
      prefix: resolveBullmqPrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24 * 7 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    }),
  ],
})
export class QueueModule {}
