import { Controller, Get, Param, ParseUUIDPipe, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { AssetsService } from "./assets.service";
import { isSafeImageMime } from "./image-mime";

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
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.service.getAssetContent(user, id);
    // Never echo an attacker-chosen Content-Type. `asset.mime` came from the
    // uploader's own header (multer copies it verbatim); an `image/svg+xml`
    // or `text/html` blob served inline runs as script in a same-tenant
    // viewer's tab — stored XSS. Collapse anything outside the image allowlist
    // to octet-stream, and forbid MIME sniffing so the browser cannot
    // second-guess us back into rendering it.
    res.set("Content-Type", isSafeImageMime(asset.mime) ? asset.mime : "application/octet-stream");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Disposition", "inline");
    res.send(asset.buffer);
  }
}
