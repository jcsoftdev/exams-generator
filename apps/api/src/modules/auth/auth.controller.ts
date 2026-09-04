import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  ExchangeCodeRequestDto,
  ExchangeCodeResponseDto,
  ExchangeTokenRequestDto,
  ExchangeTokenResponseDto,
  LastTenantResponseDto,
  LoginRequestDto,
  LoginResponseDto,
  MeResponseDto,
} from "@exams-generator/shared";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "./auth.service";
import { AuthTokenPayload, InvalidTokenError, TokenService } from "./token.service";
import { LoginExchangeService } from "./login-exchange.service";
import { LAST_TENANT_COOKIE_NAME, lastTenantCookieOptions } from "./cookie.util";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly loginExchangeService: LoginExchangeService,
  ) {}

  @Post("login")
  @HttpCode(200)
  // 5 attempts/min per IP — tighter than the global default, since this is
  // the one endpoint brute-force actually targets.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(
    @Body() body: LoginRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("email and password are required");
    }
    const response = await this.authService.login(body.email, body.password);
    // Never for platform staff (`tenantSlug: null`) — there's no subdomain to
    // hint at, and clearing any stale cookie from a prior tenant login on
    // this same browser avoids offering a redirect to the wrong tenant.
    const { maxAge, ...cookieOptions } = lastTenantCookieOptions();
    if (response.tenantSlug) {
      res.cookie(LAST_TENANT_COOKIE_NAME, response.tenantSlug, { ...cookieOptions, maxAge });
    } else {
      // `clearCookie` sets its own past-dated `Expires`; passing `maxAge`
      // here is deprecated on Express 4 and a no-op on 5.
      res.clearCookie(LAST_TENANT_COOKIE_NAME, cookieOptions);
    }
    return response;
  }

  // Cross-origin login handoff, step 1: the caller already holds a valid
  // accessToken (from POST /auth/login, same request/response, never a URL)
  // and wants a short-lived one-time code to carry across a redirect to the
  // target tenant's subdomain instead of the raw 24h JWT. No guard here —
  // the caller already possesses the token; this just re-verifies it's a
  // real signed token before minting a code for it (rejects garbage early,
  // doesn't grant anything the caller didn't already have).
  @Post("exchange-code")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async exchangeCode(@Body() body: ExchangeCodeRequestDto): Promise<ExchangeCodeResponseDto> {
    if (!body?.accessToken) {
      throw new BadRequestException("accessToken is required");
    }
    try {
      this.tokenService.verify(body.accessToken);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
    const code = await this.loginExchangeService.createCode(body.accessToken);
    return { code };
  }

  // Cross-origin login handoff, step 2: the target subdomain's callback
  // route redeems the one-time code for the real accessToken. Public and
  // unauthenticated by design — the code itself is the credential, and it's
  // single-use (LoginExchangeService.redeemCode deletes it on first read).
  @Post("exchange")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async exchange(@Body() body: ExchangeTokenRequestDto): Promise<ExchangeTokenResponseDto> {
    if (!body?.code) {
      throw new BadRequestException("code is required");
    }
    const accessToken = await this.loginExchangeService.redeemCode(body.code);
    if (!accessToken) {
      throw new UnauthorizedException("Invalid or expired code");
    }
    return { accessToken };
  }

  // Deliberately lives here, not on `UsersController`: that controller is
  // `@Roles(Role.SchoolAdmin)` at the CLASS level and derives its tenant
  // from the token via `requireTenant()`, which throws for tenant-less
  // platform staff (`platform_admin`/`content_editor`). A "me" route bolted
  // onto it would 403 every non-school-admin role and 500 for staff with a
  // null `tenantId` — this is a "who am I" identity concern, not tenant
  // user management, so it belongs next to `POST /auth/login` instead.
  // `AuthController` has no class-level `@UseGuards`/`@Roles` (each route
  // opts in individually), so this route only needs `JwtAuthGuard` — no
  // `@Roles(...)` override needed, and every authenticated role reaches it.
  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthTokenPayload): Promise<MeResponseDto> {
    // `user.sub` comes from the verified JWT, never from a client-supplied
    // param — see `AuthService.me()`.
    return this.authService.me(user.sub);
  }

  // Public and unauthenticated by design: the root domain's /login page
  // calls this BEFORE any credentials exist in that browser context, to
  // learn which tenant subdomain (if any) to offer a redirect to. Reads
  // only the non-sensitive `lastTenant` cookie set by `login()` above —
  // never touches the JWT, so this route can't be used to check whether a
  // session is still valid, only which tenant it last belonged to.
  @Get("last-tenant")
  lastTenant(@Req() req: Request): LastTenantResponseDto {
    return { slug: req.cookies?.[LAST_TENANT_COOKIE_NAME] ?? null };
  }
}
