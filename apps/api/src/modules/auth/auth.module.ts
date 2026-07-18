import { Global, Module } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TokenService } from "./token.service";

/**
 * Global so every feature module (bank, exams, ...) can inject
 * `TokenService`/`JwtAuthGuard` without re-importing this module.
 */
@Global()
@Module({
  providers: [TokenService, JwtAuthGuard],
  exports: [TokenService, JwtAuthGuard],
})
export class AuthModule {}
