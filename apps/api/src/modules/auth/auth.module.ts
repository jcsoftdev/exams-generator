import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { resolveRedisConnection } from "../../common/queue.env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LoginExchangeService } from "./login-exchange.service";
import { LOGIN_EXCHANGE_REDIS_CLIENT } from "./login-exchange.constants";
import { RolesGuard } from "./roles.guard";
import { TenantGuard } from "./tenant.guard";
import { TokenService } from "./token.service";

/**
 * Global so every feature module (bank, tenants, exams, ...) can inject
 * `TokenService`/`JwtAuthGuard`/`RolesGuard`/`TenantGuard` without
 * re-importing this module. `AuthService`/`AuthController` implement the
 * `POST /auth/login` flow on top of `TokenService` (single sign/verify
 * implementation — no separate passport-jwt stack). `LoginExchangeService`
 * backs the cross-origin login handoff (POST /auth/exchange-code + POST
 * /auth/exchange) on its own dedicated Redis connection, same pattern as
 * `HealthModule`'s `HEALTH_REDIS_CLIENT`.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    JwtAuthGuard,
    AuthService,
    RolesGuard,
    TenantGuard,
    LoginExchangeService,
    {
      provide: LOGIN_EXCHANGE_REDIS_CLIENT,
      useFactory: () => new Redis({ ...resolveRedisConnection(), lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [TokenService, JwtAuthGuard, RolesGuard, TenantGuard],
})
export class AuthModule {}
