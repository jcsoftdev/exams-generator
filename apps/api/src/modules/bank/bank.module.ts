import { Module } from "@nestjs/common";
import { BankController } from "./bank.controller";
import { STORAGE_PORT } from "./bank.constants";
import { BankRepository } from "./bank.repository";
import { BankService } from "./bank.service";
import { resolveStorageAdapter } from "./storage-provider";

@Module({
  controllers: [BankController],
  providers: [
    BankService,
    BankRepository,
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
  ],
})
export class BankModule {}
