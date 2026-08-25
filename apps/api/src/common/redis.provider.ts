import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { resolveRedisConnection } from "./queue.env";

/** DI token for the shared ioredis client. */
export const REDIS_CLIENT = Symbol("RedisClient");

/**
 * One ioredis client for everything that is NOT a BullMQ queue (BullMQ opens
 * and owns its own connections). Global so a feature module can inject
 * `REDIS_CLIENT` without importing this module explicitly — same reasoning as
 * `QueueModule`'s globally-registered `BullModule.forRoot`.
 *
 * Implements `OnModuleDestroy` (a `@Module` class can implement Nest lifecycle
 * hooks the same as a provider) so `await app.close()` — which every e2e spec
 * already calls — quits the connection. Without this, a plain `new Redis(...)`
 * value has no Nest-managed teardown: every e2e suite boots its own
 * `AppModule` instance, so a leaked client per suite is a leaked open handle
 * that forces Jest to hard-exit the worker instead of shutting down cleanly.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => new Redis(resolveRedisConnection()),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
