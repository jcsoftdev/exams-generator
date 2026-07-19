import { Module } from "@nestjs/common";
import { BankModule } from "../bank/bank.module";
import { ExamsModule } from "../exams/exams.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardStatsService } from "./dashboard-stats.service";

@Module({
  imports: [BankModule, ExamsModule],
  controllers: [DashboardController],
  providers: [DashboardStatsService],
})
export class DashboardModule {}
