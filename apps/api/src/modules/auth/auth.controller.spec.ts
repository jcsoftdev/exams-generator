import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController", () => {
  let controller: AuthController;
  const authService = { login: jest.fn() };

  beforeEach(async () => {
    authService.login.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it("delegates to AuthService.login and returns its result", async () => {
    authService.login.mockResolvedValue({ accessToken: "signed-token" });

    const result = await controller.login({ email: "a@b.com", password: "pw" });

    expect(authService.login).toHaveBeenCalledWith("a@b.com", "pw");
    expect(result).toEqual({ accessToken: "signed-token" });
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
