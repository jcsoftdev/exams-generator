import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../../../../common/redis.provider";
import { CachedExtraction, ExtractionCachePort } from "../../domain/ports/extraction-cache.port";

/** Long enough for a teacher to review and adjust; short enough to bound memory. */
const TTL_SECONDS = 30 * 60;

const keyFor = (extractionId: string): string => `ai:extract:${extractionId}`;

@Injectable()
export class RedisExtractionCacheAdapter implements ExtractionCachePort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async put(extractionId: string, entry: CachedExtraction): Promise<void> {
    const key = keyFor(extractionId);
    // A hash rather than one JSON blob: the image stays raw bytes instead of
    // paying a 33% base64 tax on every 5 MB photo in Redis.
    await this.redis.hset(key, {
      userId: entry.userId,
      mimeType: entry.mimeType,
      image: entry.image,
    });
    await this.redis.expire(key, TTL_SECONDS);
  }

  async get(extractionId: string): Promise<CachedExtraction | null> {
    const entry = await this.redis.hgetallBuffer(keyFor(extractionId));
    if (!entry.image || !entry.userId || !entry.mimeType) {
      return null;
    }
    return {
      userId: entry.userId.toString("utf8"),
      mimeType: entry.mimeType.toString("utf8"),
      image: entry.image,
    };
  }
}
