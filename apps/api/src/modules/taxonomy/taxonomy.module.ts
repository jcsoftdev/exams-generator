import { Module } from "@nestjs/common";
import { TaxonomyController } from "./taxonomy.controller";
import { TaxonomyRepository } from "./taxonomy.repository";
import { TaxonomyService } from "./taxonomy.service";

@Module({
  controllers: [TaxonomyController],
  providers: [TaxonomyService, TaxonomyRepository],
})
export class TaxonomyModule {}
