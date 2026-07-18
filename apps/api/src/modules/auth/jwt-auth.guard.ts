import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
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
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      request.user = this.tokenService.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }

    return true;
  }
}
