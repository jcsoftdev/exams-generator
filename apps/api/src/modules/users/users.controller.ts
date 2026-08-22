import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CreateUserPayload, Role } from "@exams-generator/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { UsersService } from "./users.service";
import { clampPagination } from "../../common/pagination.util";

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SchoolAdmin)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthTokenPayload,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const clamped = clampPagination(page, pageSize);
    return this.service.list(user, clamped.page, clamped.pageSize);
  }

  @Post()
  create(@CurrentUser() user: AuthTokenPayload, @Body() body: CreateUserPayload) {
    return this.service.create(user, body.email, body.name, body.role);
  }

  @Patch(":id")
  setActive(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { active: boolean },
  ) {
    return this.service.setActive(user, id, body.active);
  }

  /**
   * Ley 29733 — derecho de acceso. A GET, so answering an access request is a
   * read and leaves no trace on the account it is about.
   */
  @Get(":id/personal-data")
  exportPersonalData(@CurrentUser() user: AuthTokenPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.exportPersonalData(user, id);
  }

  /**
   * Ley 29733 — derecho de cancelación. POST, not DELETE: the row deliberately
   * survives as an authorship anchor, and calling it DELETE would promise
   * something this does not do.
   */
  @Post(":id/anonymize")
  @HttpCode(200)
  anonymize(@CurrentUser() user: AuthTokenPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.anonymize(user, id);
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  resetPassword(@CurrentUser() user: AuthTokenPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.resetPassword(user, id);
  }
}
