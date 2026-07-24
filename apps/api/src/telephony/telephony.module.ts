import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
import { RuntimeSessionsModule } from "../runtime-sessions/runtime-sessions.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { AuditLogModule } from "../compliance/audit-log.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import {
  createConfiguredPstnCallObservabilityRecorder,
  pstnCallObservabilityRecorderToken,
} from "../runtime-observability/runtime-observability";
import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { TelephonyController } from "./telephony.controller";
import { PostgresTelephonyIncrementalRepository } from "./postgres-telephony-incremental.repository";
import { PostgresTelephonyStateRepository } from "./postgres-telephony-state.repository";
import { resolveTelephonySecretVaultConfig } from "./telephony-env";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "./telephony-incremental.repository";
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
import { PstnPremiumCallExecution } from "./pstn-premium-call-execution";

@Module({
  imports: [AuditLogModule, BillingModule, RuntimeSessionsModule, WorkflowsModule],
  controllers: [TelephonyController],
  providers: [
    PostgresPoolService,
    PstnCapacityObservability,
    TelephonyService,
    PstnPremiumCallExecution,
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
      useFactory: (
        postgresPoolService: PostgresPoolService,
        capacityObservability: PstnCapacityObservability,
      ) => new PostgresTelephonyStateRepository(
        postgresPoolService.pool,
        capacityObservability,
      ),
      inject: [PostgresPoolService, PstnCapacityObservability],
    },
    {
      provide: TELEPHONY_INCREMENTAL_REPOSITORY,
      useFactory: (
        postgresPoolService: PostgresPoolService,
        capacityObservability: PstnCapacityObservability,
      ) =>
        new PostgresTelephonyIncrementalRepository(
          postgresPoolService.pool,
          capacityObservability,
        ),
      inject: [PostgresPoolService, PstnCapacityObservability],
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
  exports: [PstnCapacityObservability, TelephonyService],
})
export class TelephonyModule {}
