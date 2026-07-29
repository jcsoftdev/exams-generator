import type Redis from "ioredis";
import { LoginExchangeService } from "./login-exchange.service";

/** In-memory stand-in for the 3 Redis commands this service uses — exercises the real single-use/TTL logic without a live Redis connection. */
function createFakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string): Promise<"OK"> {
      store.set(key, value);
      return "OK";
    },
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
}

describe("LoginExchangeService", () => {
  it("redeemCode() returns the accessToken createCode() was given", async () => {
    const service = new LoginExchangeService(createFakeRedis());

    const code = await service.createCode("jwt-abc");

    await expect(service.redeemCode(code)).resolves.toBe("jwt-abc");
  });

  it("redeemCode() is single-use — a second redemption of the same code fails", async () => {
    const service = new LoginExchangeService(createFakeRedis());
    const code = await service.createCode("jwt-abc");
    await service.redeemCode(code);

    await expect(service.redeemCode(code)).resolves.toBeNull();
  });

  it("redeemCode() returns null for a code that was never issued", async () => {
    const service = new LoginExchangeService(createFakeRedis());

    await expect(service.redeemCode("never-issued")).resolves.toBeNull();
  });

  it("createCode() returns a different code on every call", async () => {
    const service = new LoginExchangeService(createFakeRedis());

    const first = await service.createCode("jwt-abc");
    const second = await service.createCode("jwt-abc");

    expect(first).not.toBe(second);
  });
});
