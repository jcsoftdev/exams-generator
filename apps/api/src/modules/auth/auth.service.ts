import { Injectable, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { JwtPayload, LoginResponseDto } from "@exams-generator/shared";
import { db } from "../../db/client";
import { users } from "../../db/schema";
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
      throw new UnauthorizedException("Account is deactivated");
    }

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.tokenService.sign(payload);
    return { accessToken };
  }
}
