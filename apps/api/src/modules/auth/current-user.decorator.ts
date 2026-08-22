import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedRequest } from "./jwt-auth.guard";
import { AuthTokenPayload } from "./token.service";

/**
 * Extracted as a standalone function (not just the decorator factory) so it
 * can be unit tested directly — `createParamDecorator` output can't be
 * invoked outside a real Nest request pipeline.
 */
export function extractCurrentUser(context: ExecutionContext): AuthTokenPayload {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new Error("CurrentUser decorator used on a route without JwtAuthGuard applied first");
  }
  return request.user;
}

/** Route handler param decorator: `@CurrentUser() user: AuthTokenPayload`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  extractCurrentUser(context),
);
