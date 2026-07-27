import { Controller, Get, HttpCode, NotFoundException, Param } from "@nestjs/common";
import { TenantsService } from "./tenants.service";

/**
 * Deliberately separate from `TenantsController`: no class-level
 * `@UseGuards`, so this stays public (needed pre-login, before any JWT
 * exists), and deliberately NOT nested under `/tenants/*` to avoid Express
 * route-matching ambiguity against the guarded `GET /tenants/:id`. Leaks
 * nothing beyond existence — 204 vs 404, no tenant data in the body.
 */
@Controller("tenant-lookup")
export class TenantLookupController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get(":slug")
  @HttpCode(204)
  async check(@Param("slug") slug: string): Promise<void> {
    const exists = await this.tenantsService.existsBySlug(slug);
    if (!exists) {
      throw new NotFoundException(`Tenant not found: ${slug}`);
    }
  }
}
