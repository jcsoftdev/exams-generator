import { Injectable, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { JwtPayload, LoginResponseDto, MeResponseDto } from "@exams-generator/shared";
import { db } from "../../db/client";
import { tenants, users } from "../../db/schema";
import { comparePassword } from "./password.util";
import { TokenService } from "./token.service";

/**
 * Reads Postgres directly via the shared Drizzle `db` client, matching the
 * convention already used by `db/seed.ts` — this codebase has no
 * repository/DI abstraction over Drizzle yet, so auth follows the same
 * direct-import pattern rather than introducing one unilaterally.
 *
 * Signs tokens via `TokenService` (already used by `JwtAuthGuard`/the bank
 * module for verification) rather than `@nestjs/jwt`'s `JwtService` — this
 * keeps a single sign/verify implementation instead of introducing a
 * second, parallel JWT stack.
 */
@Injectable()
export class AuthService {
  constructor(private readonly tokenService: TokenService) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.active) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.tokenService.sign(payload);
    const tenantSlug = await this.resolveTenantSlug(user.tenantId);
    return { accessToken, tenantSlug };
  }

  /**
   * The caller's OWN identity, read from the JWT `sub` (never a
   * client-supplied id — see `AuthController.me()`). Columns are selected
   * explicitly rather than `select().from(users)` so `passwordHash` can
   * never leak here even if the schema grows more sensitive columns later.
   */
  async me(userId: string): Promise<MeResponseDto> {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        tenantId: users.tenantId,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      // The JWT verified fine but the row is gone (deleted account) — same
      // 401 shape as "not logged in" rather than a 404, since anonymously
      // probing user ids should never be distinguishable from a bad token.
      throw new UnauthorizedException("User not found");
    }

    return user;
  }

  // `null` for platform staff (`platform_admin`/`content_editor` — global
  // scope, no single tenant). Callers (the web login flow) use this to
  // detect a cross-origin login and redirect to the right
  // `{slug}.creaexamen.com` subdomain instead of assuming same-origin.
  private async resolveTenantSlug(tenantId: string | null): Promise<string | null> {
    if (!tenantId) {
      return null;
    }
    const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    return tenant?.slug ?? null;
  }
}
