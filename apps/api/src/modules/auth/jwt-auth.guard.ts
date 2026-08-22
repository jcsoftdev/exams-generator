import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { AccountStatusService } from "./account-status.service";
import { AuthTokenPayload, InvalidTokenError, TokenService } from "./token.service";

/** `request.user` populated by `JwtAuthGuard.canActivate()`. */
export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
}

/** `undefined`/malformed header -> `null` (never throws by itself). */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

/**
 * Minimal auth guard — the tenant-scoping prerequisite for the bank module.
 * Verifies the Bearer token and attaches the decoded payload to
 * `request.user` so `@CurrentUser()` (and repository queries) can read
 * `tenantId`/`role`. No role-based authorization here; that's a separate
 * concern left to individual routes/services if/when needed.
 *
 * A valid signature is necessary but not sufficient: the account behind the
 * token is checked too, because a JWT cannot know it was deactivated or
 * deleted after being issued (audit 2026-08-20, H3 — "Desactivar profesor"
 * left the teacher working for the rest of the 8h TTL while the UI claimed
 * otherwise). `AccountStatusService` caches that answer, so the check costs
 * roughly one read per user per minute, not one per request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly accountStatus: AccountStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let payload: AuthTokenPayload;
    try {
      payload = this.tokenService.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }

    if (!(await this.accountStatus.isUsable(payload.sub))) {
      // Deactivated and deleted answer the same way on purpose: the holder of
      // a token for a deleted account learns nothing about which it was.
      throw new UnauthorizedException("Account is no longer active");
    }

    // Attached only once the account clears, so a rejected request never
    // exposes a populated `request.user` to anything downstream.
    request.user = payload;
    return true;
  }
}
