import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { JwtAuthGuard } from "../jwt-auth.guard";
import { Roles } from "../roles.decorator";
import { RolesGuard } from "../roles.guard";
import { TenantGuard } from "../tenant.guard";
import { TenantParam } from "../tenant-param.decorator";

/**
 * NOT wired into `AppModule` — exists only so `auth.e2e-spec.ts` can
 * exercise the full `JwtAuthGuard` -> `RolesGuard` -> `TenantGuard`
 * composition over real HTTP before any real protected feature module
 * (tenants/bank) exists yet.
 */
@Controller("test-fixtures/tenants/:tenantId")
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
export class ProtectedFixtureController {
  @Get("protected")
  @Roles(Role.SchoolAdmin)
  @TenantParam("tenantId")
  check(@Param("tenantId") tenantId: string): { ok: true; tenantId: string } {
    return { ok: true, tenantId };
  }
}
