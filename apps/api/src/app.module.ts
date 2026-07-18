import { Module } from "@nestjs/common";
import { AuthModule } from "./modules/auth/auth.module";
import { BankModule } from "./modules/bank/bank.module";
import { HealthModule } from "./modules/health/health.module";
import { TenantsModule } from "./modules/tenants/tenants.module";

@Module({
  imports: [HealthModule, AuthModule, BankModule, TenantsModule],
})
export class AppModule {}
