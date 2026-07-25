import { Module } from "@nestjs/common";
import Redis from "ioredis";
import { db, DRIZZLE_DB } from "../../db/client";
import { STORAGE_PORT } from "../bank/bank.constants";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { resolveRedisConnection } from "../../common/queue.env";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { HEALTH_REDIS_CLIENT } from "./health.constants";

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: DRIZZLE_DB, useValue: db },
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    {
      provide: HEALTH_REDIS_CLIENT,
      useFactory: () => new Redis({ ...resolveRedisConnection(), lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
})
export class HealthModule {}
