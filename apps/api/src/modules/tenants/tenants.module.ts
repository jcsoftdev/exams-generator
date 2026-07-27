import { Module } from "@nestjs/common";
import { STORAGE_PORT } from "../bank/bank.constants";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { TenantLookupController } from "./tenant-lookup.controller";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

/**
 * Binds `STORAGE_PORT` via the SAME factory the bank module uses
 * (`resolveStorageAdapter`) instead of introducing a second storage
 * DI token/module — logo uploads and question-image uploads hit the
 * same MinIO-backed adapter.
 */
@Module({
  controllers: [TenantsController, TenantLookupController],
  providers: [TenantsService, { provide: STORAGE_PORT, useFactory: resolveStorageAdapter }],
})
export class TenantsModule {}
