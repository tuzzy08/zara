import { Module } from "@nestjs/common";

import { AuditLogModule } from "../compliance/audit-log.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { TelephonyController } from "./telephony.controller";
import { PostgresTelephonyStateRepository } from "./postgres-telephony-state.repository";
import { resolveTelephonySecretVaultConfig } from "./telephony-env";
import { TELEPHONY_STATE_REPOSITORY } from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";
import { TelephonyService } from "./telephony.service";

@Module({
  imports: [AuditLogModule],
  controllers: [TelephonyController],
  providers: [
    PostgresPoolService,
    TelephonyService,
    {
      provide: TELEPHONY_STATE_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresTelephonyStateRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TelephonySecretVault,
      useFactory: () => new TelephonySecretVault(resolveTelephonySecretVaultConfig(process.env)),
    },
  ],
  exports: [TelephonyService],
})
export class TelephonyModule {}
