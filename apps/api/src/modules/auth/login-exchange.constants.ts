/** DI token for the dedicated `ioredis` client `LoginExchangeService` stores one-time codes in — see its constructor docstring for why it's not the BullMQ queue's own connection. */
export const LOGIN_EXCHANGE_REDIS_CLIENT = Symbol("LoginExchangeRedisClient");
