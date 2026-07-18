import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtPayload, Role } from "@exams-generator/shared";
import { TENANT_PARAM_KEY } from "./tenant-param.decorator";

const DEFAULT_TENANT_PARAM = "id";

/** Roles that carry `tenantId: null` and therefore have global (cross-tenant) access. */
const GLOBAL_ROLES: ReadonlySet<Role> = new Set([Role.PlatformAdmin, Role.ContentEditor]);

/**
 * Checks the authenticated user's JWT `tenantId` against the target
 * resource's tenant id (read from the route param declared via
 * `@TenantParam()`, defaulting to `:id`). `platform_admin` / `content_editor`
 * with `tenantId: null` bypass scoping entirely (global access, per design
 * doc §2). Must run AFTER `JwtAuthGuard`.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; params: Record<string, string | undefined> }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException("Missing authenticated user");
    }

    if (GLOBAL_ROLES.has(user.role) && user.tenantId === null) {
      return true;
    }

    const paramName =
      this.reflector.getAllAndOverride<string | undefined>(TENANT_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_TENANT_PARAM;

    const targetTenantId = request.params[paramName];

    if (!targetTenantId || targetTenantId !== user.tenantId) {
      throw new ForbiddenException("Tenant mismatch");
    }

    return true;
  }
}
