import {
  BankFolderNode,
  BankFoldersResponse,
  CreateBankFolderDto,
  DeleteBankFolderResponse,
  UpdateBankFolderDto,
} from "@exams-generator/shared";
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../../auth/token.service";
import { BankFoldersService } from "./bank-folders.service";

/**
 * A tenant's own folder tree over the bank. Separate controller from
 * `BankController` (which is mounted at `bank/questions`) so the route prefix
 * stays honest — same module, so guards and the questions repository are
 * shared, not duplicated.
 */
@Controller("bank/folders")
@UseGuards(JwtAuthGuard)
export class BankFoldersController {
  constructor(private readonly service: BankFoldersService) {}

  @Get()
  async getTree(@CurrentUser() user: AuthTokenPayload): Promise<BankFoldersResponse> {
    return this.service.getTree(user);
  }

  /**
   * `name` and `parentId` are read off the raw body and validated in the
   * service, NOT by a DTO class: the invalid-name case has to answer 422 with
   * `code: "folder_name_invalid"`, and a `ValidationPipe` would answer 400 with
   * its own message shape.
   */
  @Post()
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateBankFolderDto,
  ): Promise<BankFolderNode> {
    return this.service.create(user, { name: body?.name, parentId: body?.parentId ?? null });
  }

  /**
   * Rename and/or move. `ParseUUIDPipe` on `:id` means a malformed id is a 400
   * before the service runs — a non-uuid can never be a folder of this tenant,
   * so there is nothing 404 would tell the caller that 400 does not.
   */
  @Patch(":id")
  async update(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateBankFolderDto,
  ): Promise<BankFolderNode> {
    return this.service.update(user, id, body ?? {});
  }

  /** 200 with the counts, NOT 204: the UI's post-delete banner is built from this body. */
  @Delete(":id")
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<DeleteBankFolderResponse> {
    return this.service.remove(user, id);
  }
}
