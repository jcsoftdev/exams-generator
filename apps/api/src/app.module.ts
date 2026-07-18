import { Module } from "@nestjs/common";
import { AiModule } from "./modules/ai/ai.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BankModule } from "./modules/bank/bank.module";
import { ExamsModule } from "./modules/exams/exams.module";
import { HealthModule } from "./modules/health/health.module";
import { TaxonomyModule } from "./modules/taxonomy/taxonomy.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    BankModule,
    TenantsModule,
    ExamsModule,
    AiModule,
    TaxonomyModule,
    AssetsModule,
    UsersModule,
  ],
})
export class AppModule {}
