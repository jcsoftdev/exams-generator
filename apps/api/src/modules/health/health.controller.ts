import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { Response } from "express";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly service: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res() res: Response): Promise<void> {
    const result = await this.service.check();
    res.status(result.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(result);
  }
}
