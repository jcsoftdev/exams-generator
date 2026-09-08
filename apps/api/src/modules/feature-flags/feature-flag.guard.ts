import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FeatureFlag, JwtPayload } from "@exams-generator/shared";
import { FeatureFlagsService } from "./feature-flags.service";
import { REQUIRES_FEATURE_KEY } from "./requires-feature.decorator";

/**
 * Enforces `@RequiresFeature(...)`. Must run AFTER `JwtAuthGuard` — it reads
 * `request.user` for the tenant whose flags apply.
 *
 * There is NO role exemption here, and that is the point. `AiController`
 * carries no `RolesGuard`, so a `content_editor` reaches the AI routes and
 * generates straight into the central bank; sparing staff would spare the
 * one account that generates at platform scale, which is precisely the case
 * the kill switch exists for. Staff simply have no tenant layer to consult,
 * which the resolver already handles.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<FeatureFlag | undefined>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException("Missing authenticated user");
    }

    if (!(await this.features.isEnabled(required, user.tenantId))) {
      // Names the key so the web can tell "your plan does not include this"
      // apart from "you lack the role", which are the same 403 otherwise.
      throw new ForbiddenException({
        statusCode: 403,
        message: "Feature not enabled",
        feature: required,
      });
    }

    return true;
  }
}
