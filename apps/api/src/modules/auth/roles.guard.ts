import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtPayload, Role } from "@exams-generator/shared";
import { ROLES_KEY } from "./roles.decorator";

/**
 * Checks the authenticated user's JWT role against the roles declared via
 * `@Roles(...)` on the handler/class. Must run AFTER `JwtAuthGuard` — it
 * reads `request.user`, populated by `JwtStrategy.validate()`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException("Missing authenticated user");
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException("Insufficient role");
    }

    return true;
  }
}
