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
    //
    // `hset` and `expire` in one `multi()` round trip, not two separate
    // commands: between two separate commands the key would sit with no TTL
    // at all, and a connection drop/failover/kill in exactly that window
    // leaves an immortal 5 MB hash nothing ever reclaims — on the same Redis
    // instance BullMQ shares, so it eventually eats into queue capacity.
    await this.redis
      .multi()
      .hset(key, { userId: entry.userId, mimeType: entry.mimeType, image: entry.image })
      .expire(key, TTL_SECONDS)
      .exec();
  }

  async get(extractionId: string): Promise<CachedExtraction | null> {
    const entry = await this.redis.hgetallBuffer(keyFor(extractionId));
    // `entry.image?.length` rather than `!entry.image`: a Buffer is always
    // truthy, even an empty one, so a plain truthiness check would treat a
    // zero-length field as present and hand it to `sharp` instead of
    // reporting the miss.
    if (!entry.image?.length || !entry.userId || !entry.mimeType) {
      return null;
    }
    return {
      userId: entry.userId.toString("utf8"),
      mimeType: entry.mimeType.toString("utf8"),
      image: entry.image,
    };
  }
}
