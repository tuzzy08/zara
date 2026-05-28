import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
import { AuditLogModule } from "../compliance/audit-log.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import {
  createConfiguredPstnCallObservabilityRecorder,
  pstnCallObservabilityRecorderToken,
} from "../runtime-observability/runtime-observability";
import { TelephonyController } from "./telephony.controller";
import { PostgresTelephonyStateRepository } from "./postgres-telephony-state.repository";
import { resolveTelephonySecretVaultConfig } from "./telephony-env";
import { TELEPHONY_STATE_REPOSITORY } from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";
import { TelephonyService } from "./telephony.service";
import { TwilioMediaStreamsWebSocketBridge } from "./twilio-media-streams.websocket-bridge";

@Module({
  imports: [AuditLogModule, BillingModule],
  controllers: [TelephonyController],
  providers: [
    PostgresPoolService,
    TelephonyService,
    TwilioMediaStreamsWebSocketBridge,
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
    {
      provide: pstnCallObservabilityRecorderToken,
      useFactory: () => createConfiguredPstnCallObservabilityRecorder(process.env),
    },
  ],
  exports: [TelephonyService],
})
export class TelephonyModule {}
