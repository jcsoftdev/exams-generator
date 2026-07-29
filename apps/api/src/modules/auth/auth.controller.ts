import { BadRequestException, Body, Controller, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ExchangeCodeRequestDto,
  ExchangeCodeResponseDto,
  ExchangeTokenRequestDto,
  ExchangeTokenResponseDto,
  LoginRequestDto,
  LoginResponseDto,
} from "@exams-generator/shared";
import { AuthService } from "./auth.service";
import { InvalidTokenError, TokenService } from "./token.service";
import { LoginExchangeService } from "./login-exchange.service";

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
  async login(@Body() body: LoginRequestDto): Promise<LoginResponseDto> {
    if (!body?.email || !body?.password) {
      throw new BadRequestException("email and password are required");
    }
    return this.authService.login(body.email, body.password);
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
}
