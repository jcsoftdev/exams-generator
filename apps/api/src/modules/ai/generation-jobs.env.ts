export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
}

/**
 * Resolves Redis connection config for the `generation` BullMQ queue,
 * mirroring `resolveDatabaseUrl()` (`db/env.ts`) and `resolveStorageAdapter()`
 * (`bank/storage-provider.ts`): the SAME env var names the `api` service in
 * `infra/docker-compose.yml` sets (container-internal port 6379), falling
 * back to the docker-compose HOST-mapped port (6390) for bare local dev
 * outside Docker.
 */
export function resolveRedisConnection(): RedisConnectionConfig {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6390),
  };
}
