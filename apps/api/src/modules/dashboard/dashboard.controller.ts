import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { DashboardStats, DashboardStatsService } from "./dashboard-stats.service";

/** `GET /dashboard/stats` (design doc §2) — reachable by every authenticated role, no `RolesGuard`. */
@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardStatsService) {}

  @Get("stats")
  async stats(@CurrentUser() user: AuthTokenPayload): Promise<DashboardStats> {
    return this.service.getStats(user);
  }
}
