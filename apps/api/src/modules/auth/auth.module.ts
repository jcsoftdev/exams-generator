import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { TenantGuard } from "./tenant.guard";
import { TokenService } from "./token.service";

/**
 * Global so every feature module (bank, tenants, exams, ...) can inject
 * `TokenService`/`JwtAuthGuard`/`RolesGuard`/`TenantGuard` without
 * re-importing this module. `AuthService`/`AuthController` implement the
 * `POST /auth/login` flow on top of `TokenService` (single sign/verify
 * implementation — no separate passport-jwt stack).
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [TokenService, JwtAuthGuard, AuthService, RolesGuard, TenantGuard],
  exports: [TokenService, JwtAuthGuard, RolesGuard, TenantGuard],
})
export class AuthModule {}
