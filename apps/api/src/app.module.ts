import { Module } from "@nestjs/common";
import { AiModule } from "./modules/ai/ai.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BankModule } from "./modules/bank/bank.module";
import { HealthModule } from "./modules/health/health.module";
import { TenantsModule } from "./modules/tenants/tenants.module";

@Module({
  imports: [HealthModule, AuthModule, BankModule, TenantsModule, AiModule],
})
export class AppModule {}
