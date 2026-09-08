import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { Role, UpdateFeatureFlagDto } from "@exams-generator/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { TenantsService } from "../tenants/tenants.service";
import { FeatureFlagsService } from "./feature-flags.service";
import { parseEnabled, parseFlag } from "./feature-flags.controller";

/**
 * One school's overrides. `platform_admin` only, and deliberately NOT part
 * of the tenant DTO: `PATCH /tenants/:id` is writable by `school_admin`, so
 * a flag riding on that body would let a school grant itself features.
 */
@Controller("tenants/:tenantId/feature-flags")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PlatformAdmin)
export class TenantFeatureFlagsController {
  constructor(
    private readonly features: FeatureFlagsService,
    private readonly tenants: TenantsService,
  ) {}

  /** Returns platform, override and effective per key — see `TenantFeatureFlagStateDto`. */
  @Get()
  async list(@Param("tenantId", ParseUUIDPipe) tenantId: string) {
    // Throws 404 for a tenant that does not exist, rather than confidently
    // reporting catalog defaults for a made-up id.
    await this.tenants.findById(tenantId);
    return this.features.listForTenant(tenantId);
  }

  @Put(":key")
  async set(
    @CurrentUser() user: AuthTokenPayload,
    @Param("tenantId", ParseUUIDPipe) tenantId: string,
    @Param("key") key: string,
    @Body() body: UpdateFeatureFlagDto,
  ) {
    const flag = parseFlag(key);
    await this.tenants.findById(tenantId);
    await this.features.setForTenant(tenantId, flag, parseEnabled(body), user.sub);
    return this.features.listForTenant(tenantId);
  }

  /** Drops the override so the school follows the catalog default again. */
  @Delete(":key")
  async clear(@Param("tenantId", ParseUUIDPipe) tenantId: string, @Param("key") key: string) {
    const flag = parseFlag(key);
    await this.tenants.findById(tenantId);
    await this.features.clearForTenant(tenantId, flag);
    return this.features.listForTenant(tenantId);
  }
}
