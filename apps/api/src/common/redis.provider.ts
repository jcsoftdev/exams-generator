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
      // Same options as every other Redis client in this repo (`auth.module.ts`,
      // `health.module.ts`, `test-support/jest-global-setup.ts`): `lazyConnect`
      // so a Redis outage surfaces on first use instead of blocking app boot,
      // and `maxRetriesPerRequest: 1` instead of ioredis's default 20 retries
      // so a down Redis fails a request fast rather than hanging it.
      useFactory: () => new Redis({ ...resolveRedisConnection(), lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    // `quit()` rejects on a client that never actually connected (e.g. it was
    // never used, or Redis was down for the whole test); left unguarded, that
    // rejection escapes into `app.close()` and turns a Redis outage into a
    // failed SHUTDOWN across all 27 e2e suites. `disconnect()` never rejects.
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
