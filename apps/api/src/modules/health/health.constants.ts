/** DI token for the dedicated `ioredis` client `HealthService` pings — see its constructor docstring for why it's not the BullMQ queue's own connection. */
export const HEALTH_REDIS_CLIENT = Symbol("HealthRedisClient");
