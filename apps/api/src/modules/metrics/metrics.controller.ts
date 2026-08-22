import { Controller, ForbiddenException, Get, Headers, Res } from "@nestjs/common";
import { Response } from "express";
import { extractBearerToken } from "../auth/jwt-auth.guard";
import { metricsRequireToken, resolveMetricsToken } from "./metrics.env";
import { MetricsService } from "./metrics.service";

/**
 * `GET /metrics` — the Prometheus scrape endpoint (audit 2026-08-20, M6).
 *
 * Deliberately NOT behind `JwtAuthGuard`: a scraper has no account and cannot
 * hold a JWT. Access is a bearer token from `METRICS_TOKEN` instead, and in
 * production the endpoint refuses to answer at all when that variable is
 * unset — an unset variable should not silently mean "public".
 */
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(
    @Headers("authorization") authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const expected = resolveMetricsToken();

    if (expected === undefined && metricsRequireToken()) {
      throw new ForbiddenException("Metrics are disabled: set METRICS_TOKEN to enable scraping");
    }
    if (expected !== undefined && extractBearerToken(authorization) !== expected) {
      throw new ForbiddenException("Invalid metrics token");
    }

    res.setHeader("Content-Type", this.metrics.contentType);
    res.send(await this.metrics.render());
  }
}
