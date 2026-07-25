import { BadRequestException, Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { LoginRequestDto, LoginResponseDto } from "@exams-generator/shared";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
