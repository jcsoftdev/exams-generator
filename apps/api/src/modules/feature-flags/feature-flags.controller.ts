import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { FeatureFlag, Role, UpdateFeatureFlagDto, isFeatureFlag } from "@exams-generator/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { FeatureFlagsService } from "./feature-flags.service";

/**
 * The kill-switch layer. `platform_admin` only — this is the one control
 * that reaches every school at once.
 */
@Controller("feature-flags")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PlatformAdmin)
export class FeatureFlagsController {
  constructor(private readonly features: FeatureFlagsService) {}

  @Get("platform")
  listPlatform() {
    return this.features.listPlatform();
  }

  @Put("platform/:key")
  async setPlatform(
    @CurrentUser() user: AuthTokenPayload,
    @Param("key") key: string,
    @Body() body: UpdateFeatureFlagDto,
  ) {
    const flag = parseFlag(key);
    await this.features.setPlatform(flag, parseEnabled(body), user.sub);
    return this.features.listPlatform();
  }
}

/**
 * A key is a value from a catalog in code, not a stored resource, so an
 * unknown one is a malformed request (400) rather than a missing thing (404).
 */
export function parseFlag(key: string): FeatureFlag {
  if (!isFeatureFlag(key)) {
    throw new BadRequestException(`Unknown feature flag: ${key}`);
  }
  return key;
}

/**
 * Checked by hand because the shared DTOs are plain interfaces: the global
 * `ValidationPipe` reflects them as `Object` and validates nothing. Without
 * this, `{"enabled": "false"}` would store a truthy string and switch the
 * feature ON while the caller believes they turned it off.
 */
export function parseEnabled(body: UpdateFeatureFlagDto | undefined): boolean {
  if (typeof body?.enabled !== "boolean") {
    throw new BadRequestException("enabled must be a boolean");
  }
  return body.enabled;
}
