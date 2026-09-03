import { BankFolderNode, BankFoldersResponse, CreateBankFolderDto } from "@exams-generator/shared";
import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
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
}
