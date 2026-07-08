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
import {
  TWILIO_NUMBER_INVENTORY_PROVIDER,
  TwilioRestNumberInventoryProvider,
} from "./twilio-number-inventory.provider";
import {
  TWILIO_NUMBER_ROUTING_PROVIDER,
  TwilioRestNumberRoutingProvider,
} from "./twilio-number-routing.provider";
import { TwilioMediaStreamsWebSocketBridge } from "./twilio-media-streams.websocket-bridge";

@Module({
  imports: [AuditLogModule, BillingModule],
  controllers: [TelephonyController],
  providers: [
    PostgresPoolService,
    TelephonyService,
    TwilioMediaStreamsWebSocketBridge,
    {
      provide: TWILIO_NUMBER_INVENTORY_PROVIDER,
      useFactory: () => new TwilioRestNumberInventoryProvider(),
    },
    {
      provide: TWILIO_NUMBER_ROUTING_PROVIDER,
      useFactory: () => new TwilioRestNumberRoutingProvider(),
    },
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
