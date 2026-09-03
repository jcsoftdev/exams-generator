import { BankFoldersResponse } from "@exams-generator/shared";
import { Controller, Get, UseGuards } from "@nestjs/common";
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
}
