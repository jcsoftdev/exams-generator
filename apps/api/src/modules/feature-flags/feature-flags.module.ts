import { Global, Module } from "@nestjs/common";
import { db, DRIZZLE_DB } from "../../db/client";
import { STORAGE_PORT } from "../bank/bank.constants";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { TenantsService } from "../tenants/tenants.service";
import { FeatureFlagGuard } from "./feature-flag.guard";
import { FeatureFlagsController } from "./feature-flags.controller";
import { FeatureFlagsRepository } from "./feature-flags.repository";
import { FeatureFlagsService } from "./feature-flags.service";
import { TenantFeatureFlagsController } from "./tenant-feature-flags.controller";

/**
 * `@Global` for the same reason `AuthModule` is: `FeatureFlagGuard` gets
 * attached to handlers in the ai, exams and bank modules, and a guard can
 * only be constructed where its dependencies resolve. Making every one of
 * those modules import this one would work, and would also mean a new gated
 * route in a new module fails at boot rather than at review.
 *
 * `TenantsService` is re-provided here (with the storage port it needs)
 * rather than imported, mirroring how `TenantsModule` itself re-provides
 * `STORAGE_PORT` from the bank module instead of adding a second storage
 * token. It is used for one thing: 404-ing a tenant id that does not exist
 * before writing an override for it.
 */
@Global()
@Module({
  controllers: [FeatureFlagsController, TenantFeatureFlagsController],
  providers: [
    { provide: DRIZZLE_DB, useValue: db },
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    FeatureFlagsRepository,
    FeatureFlagsService,
    FeatureFlagGuard,
    TenantsService,
  ],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
