import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { AssetsService } from "./assets.service";

/**
 * `GET /assets/:id` — streams the binary object behind an `assets` row
 * (the piece `GET /bank/questions`'s bare `imageAssetId` needs to be
 * actually renderable, e.g. via `<img>` on the web). Bearer-JWT protected
 * like every other route; tenant scoping happens in `AssetsService`, same
 * pattern as `BankController`.
 */
@Controller("assets")
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get(":id")
  async getAsset(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.service.getAssetContent(user, id);
    res.set("Content-Type", asset.mime);
    res.send(asset.buffer);
  }
}
