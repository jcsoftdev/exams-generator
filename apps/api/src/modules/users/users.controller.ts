import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SchoolAdmin)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthTokenPayload) {
    return this.service.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: { email: string; name: string; role: "teacher" | "school_admin" },
  ) {
    return this.service.create(user, body.email, body.name, body.role);
  }

  @Patch(":id")
  setActive(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string, @Body() body: { active: boolean }) {
    return this.service.setActive(user, id, body.active);
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  resetPassword(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.resetPassword(user, id);
  }
}
