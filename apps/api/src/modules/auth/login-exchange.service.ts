import { randomBytes } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";
import { LOGIN_EXCHANGE_REDIS_CLIENT } from "./login-exchange.constants";

const CODE_TTL_SECONDS = 60;
const KEY_PREFIX = "auth-exchange:";

/**
 * Backs the cross-origin login handoff (see `login-exchange.dto.ts`): mints
 * a random, single-use, ~60s-lived code for an already-issued access token,
 * so a redirect between origins (creaexamen.com -> {slug}.creaexamen.com)
 * can carry the code instead of the real 24h JWT. `redeemCode` deletes the
 * key on first read — a leaked/replayed code is useless after one exchange.
 *
 * A dedicated connection, deliberately NOT the BullMQ queue's own Redis
 * client — same reasoning as `HealthService`'s `HEALTH_REDIS_CLIENT`.
 */
@Injectable()
export class LoginExchangeService implements OnModuleDestroy {
  constructor(@Inject(LOGIN_EXCHANGE_REDIS_CLIENT) private readonly redis: Redis) {}

  // Without this, `app.close()` (every e2e spec's teardown) leaves the
  // lazily-opened Redis connection's reconnect timer running, which keeps
  // the Jest worker process alive past the test run ("failed to exit
  // gracefully" / force-exit warning).
  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  async createCode(accessToken: string): Promise<string> {
    const code = randomBytes(24).toString("base64url");
    await this.redis.set(KEY_PREFIX + code, accessToken, "EX", CODE_TTL_SECONDS);
    return code;
  }

  async redeemCode(code: string): Promise<string | null> {
    const key = KEY_PREFIX + code;
    const accessToken = await this.redis.get(key);
    if (accessToken === null) {
      return null;
    }
    await this.redis.del(key);
    return accessToken;
  }
}
