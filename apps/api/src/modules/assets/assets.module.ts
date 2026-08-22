import { Module } from "@nestjs/common";
import { STORAGE_PORT } from "../bank/bank.constants";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { AssetsController } from "./assets.controller";
import { AssetsRepository } from "./assets.repository";
import { AssetsService } from "./assets.service";

/**
 * Reuses `STORAGE_PORT`/`resolveStorageAdapter` straight from the `bank`
 * module, same convention `exams.module.ts` already follows, instead of
 * introducing a second MinIO binding.
 */
@Module({
  controllers: [AssetsController],
  providers: [AssetsRepository, AssetsService, { provide: STORAGE_PORT, useFactory: resolveStorageAdapter }],
})
export class AssetsModule {}
