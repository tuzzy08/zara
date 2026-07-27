import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
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
import {
  PSTN_ADMISSION_REDIS_CLIENT,
  PstnAdmissionModule,
} from "./pstn-admission.module";
import type { PstnAdmissionRedisClient } from "./pstn-admission-redis-client";
import { PstnPremiumCallExecution } from "./pstn-premium-call-execution";
import { TelephonyShutdownLifecycle } from "./telephony-shutdown.lifecycle";
import {
  PSTN_MEDIA_PROCESS_ROLE,
  PSTN_MEDIA_WORKER_READINESS,
  PSTN_MEDIA_WORKER_ID,
  PSTN_MEDIA_WORKER_RELEASE_ID,
  resolvePstnMediaProcessRole,
  resolvePstnMediaWorkerId,
  resolvePstnMediaWorkerReleaseId,
  type PstnMediaProcessRole,
} from "./pstn-media-process-role";
import { PremiumPstnDispatchSnapshotResolver } from "./premium-pstn-dispatch-snapshot-resolver";
import { PremiumRealtimeConversationPolicyModule } from "../premium-realtime-policy/premium-realtime-conversation-policy.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { PublishedWorkflowManifestReadModule } from "../workflows/published-workflow-manifest-read.module";
import {
  createPstnPremiumWorkerAvailabilityProvider,
} from "../realtime-worker/pstn-premium-worker-availability";
import { PstnRealtimeWorkerRegistry } from "../realtime-worker/pstn-realtime-worker-registry";

@Module({
  imports: [
    AuditLogModule,
    BillingModule,
    PstnAdmissionModule,
    PremiumRealtimeConversationPolicyModule,
    PublishedWorkflowManifestReadModule,
    RuntimePromptPolicyModule,
  ],
  controllers: [TelephonyController],
  providers: [
    PostgresPoolService,
    TelephonyService,
    TwilioMediaStreamsWebSocketBridge,
    TelephonyShutdownLifecycle,
    PremiumPstnDispatchSnapshotResolver,
    {
      provide: PstnPremiumCallExecution,
      useValue: {
        async start() {
          throw new Error(
            "Premium PSTN execution is unavailable in the API process.",
          );
        },
        async appendInboundFrame() {
          throw new Error(
            "Premium PSTN execution is unavailable in the API process.",
          );
        },
        acknowledgePlaybackMark() {
          throw new Error(
            "Premium PSTN execution is unavailable in the API process.",
          );
        },
        async stop() {
          throw new Error(
            "Premium PSTN execution is unavailable in the API process.",
          );
        },
        async shutdown() {},
      },
    },
    {
      provide: PSTN_MEDIA_PROCESS_ROLE,
      useFactory: () => resolvePstnMediaProcessRole(process.env),
    },
    {
      provide: PSTN_MEDIA_WORKER_ID,
      useFactory: (role: PstnMediaProcessRole) =>
        resolvePstnMediaWorkerId(role, process.env),
      inject: [PSTN_MEDIA_PROCESS_ROLE],
    },
    {
      provide: PSTN_MEDIA_WORKER_RELEASE_ID,
      useFactory: (role: PstnMediaProcessRole) =>
        resolvePstnMediaWorkerReleaseId(role, process.env),
      inject: [PSTN_MEDIA_PROCESS_ROLE],
    },
    {
      provide: PSTN_MEDIA_WORKER_READINESS,
      useValue: undefined,
    },
    {
      provide: PstnRealtimeWorkerRegistry,
      useFactory: (client: PstnAdmissionRedisClient | undefined) =>
        client === undefined
          ? undefined
          : new PstnRealtimeWorkerRegistry(client, {}),
      inject: [PSTN_ADMISSION_REDIS_CLIENT],
    },
    createPstnPremiumWorkerAvailabilityProvider(),
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
  exports: [TelephonyService],
})
export class TelephonyModule {}
