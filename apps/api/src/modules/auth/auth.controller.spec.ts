import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@exams-generator/shared";
import { AccountStatusService } from "./account-status.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { InvalidTokenError, TokenService } from "./token.service";
import { LoginExchangeService } from "./login-exchange.service";

describe("AuthController", () => {
  let controller: AuthController;
  const authService = { login: jest.fn(), me: jest.fn() };
  const tokenService = { verify: jest.fn() };
  const loginExchangeService = { createCode: jest.fn(), redeemCode: jest.fn() };

  beforeEach(async () => {
    authService.login.mockReset();
    authService.me.mockReset();
    tokenService.verify.mockReset();
    loginExchangeService.createCode.mockReset();
    loginExchangeService.redeemCode.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokenService },
        { provide: LoginExchangeService, useValue: loginExchangeService },
        // `JwtAuthGuard` on `GET /auth/me` asks it whether the account is still
        // usable; this spec exercises the controller, not that rule.
        {
          provide: AccountStatusService,
          useValue: { isUsable: () => Promise.resolve(true), invalidate: () => {} },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe("login", () => {
    it("delegates to AuthService.login and returns its result", async () => {
      authService.login.mockResolvedValue({ accessToken: "signed-token", tenantSlug: "colegio-demo" });

      const result = await controller.login({ email: "a@b.com", password: "pw" });

      expect(authService.login).toHaveBeenCalledWith("a@b.com", "pw");
      expect(result).toEqual({ accessToken: "signed-token", tenantSlug: "colegio-demo" });
    });

    it("throws BadRequestException when email is missing", async () => {
      await expect(controller.login({ email: "", password: "pw" })).rejects.toThrow(BadRequestException);
      expect(authService.login).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when password is missing", async () => {
      await expect(controller.login({ email: "a@b.com", password: "" })).rejects.toThrow(BadRequestException);
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe("exchangeCode", () => {
    it("verifies the token then mints a code", async () => {
      tokenService.verify.mockReturnValue({ sub: "u1", role: "teacher", tenantId: "t1" });
      loginExchangeService.createCode.mockResolvedValue("one-time-code");

      const result = await controller.exchangeCode({ accessToken: "signed-token" });

      expect(tokenService.verify).toHaveBeenCalledWith("signed-token");
      expect(loginExchangeService.createCode).toHaveBeenCalledWith("signed-token");
      expect(result).toEqual({ code: "one-time-code" });
    });

    it("throws BadRequestException when accessToken is missing", async () => {
      await expect(controller.exchangeCode({ accessToken: "" })).rejects.toThrow(BadRequestException);
      expect(loginExchangeService.createCode).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException when the token fails verification", async () => {
      tokenService.verify.mockImplementation(() => {
        throw new InvalidTokenError();
      });

      await expect(controller.exchangeCode({ accessToken: "garbage" })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(loginExchangeService.createCode).not.toHaveBeenCalled();
    });
  });

  describe("exchange", () => {
    it("redeems the code and returns the accessToken", async () => {
      loginExchangeService.redeemCode.mockResolvedValue("signed-token");

      const result = await controller.exchange({ code: "one-time-code" });

      expect(loginExchangeService.redeemCode).toHaveBeenCalledWith("one-time-code");
      expect(result).toEqual({ accessToken: "signed-token" });
    });

    it("throws BadRequestException when code is missing", async () => {
      await expect(controller.exchange({ code: "" })).rejects.toThrow(BadRequestException);
      expect(loginExchangeService.redeemCode).not.toHaveBeenCalled();
    });

    it("throws UnauthorizedException when the code is unknown or already used", async () => {
      loginExchangeService.redeemCode.mockResolvedValue(null);

      await expect(controller.exchange({ code: "stale-code" })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("me", () => {
    it("delegates to AuthService.me with the JWT sub — never a client-supplied id", async () => {
      authService.me.mockResolvedValue({
        id: "u1",
        name: "Ana",
        email: "ana@test.local",
        role: Role.Teacher,
        tenantId: "t1",
      });

      const result = await controller.me({ sub: "u1", role: Role.Teacher, tenantId: "t1" });

      expect(authService.me).toHaveBeenCalledWith("u1");
      expect(result).toEqual({
        id: "u1",
        name: "Ana",
        email: "ana@test.local",
        role: Role.Teacher,
        tenantId: "t1",
      });
    });
  });
});
