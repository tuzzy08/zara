import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module";
import { AuditLogModule } from "../compliance/audit-log.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { DatabaseModule } from "../database/database.module";
import { PostgresTenantStatusRepository } from "../persistence/tenant-status.repository";
import {
  createConfiguredPstnCallObservabilityRecorder,
  createConfiguredRuntimeObservabilityRecorder,
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
import { TrustedPaygTelephonyCallStartService } from "./trusted-payg-telephony-call-start.service";
import { PstnSandwichCallExecution } from "./pstn-sandwich-call-execution";
import type { TelephonyIncrementalRepository } from "./telephony-incremental.repository";
import { PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY, type PublishedWorkflowManifestRepository } from "../workflows/published-workflow-manifest.repository";
import { ProviderUsageRecordingRepository } from "../billing/provider-usage-recording.repository";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import { VoiceLibraryModule } from "../voice-library/voice-library.module";
import { VoiceLibraryService } from "../voice-library/voice-library.service";
import { AssemblyAiSttProvider } from "../sandbox-live-sessions/assemblyai-stt.provider";
import { CartesiaTtsProvider } from "../sandbox-live-sessions/cartesia-tts.provider";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";
import { createLiveSandboxTextModelProvider } from "../sandbox-live-sessions/sandbox-text-model-provider-factory";
import { RuntimeAgentToolExecutionModule } from "../sandbox-live-sessions/runtime-agent-tool-execution.module";
import { RuntimeAgentToolExecutorService } from "../sandbox-live-sessions/runtime-agent-tool-executor.service";
import { GeminiIntentClassifierProvider, UnavailableLiveSandboxIntentClassifierProvider } from "../sandbox-live-sessions/sandbox-intent-classifier.provider";

@Module({
  imports: [
    AuditLogModule,
    BillingModule,
    DatabaseModule,
    PstnAdmissionModule,
    PremiumRealtimeConversationPolicyModule,
    PublishedWorkflowManifestReadModule,
    RuntimePromptPolicyModule,
    VoiceLibraryModule,
    RuntimeAgentToolExecutionModule,
  ],
  controllers: [TelephonyController],
  providers: [
    TelephonyService,
    {
      provide: PostgresTenantStatusRepository,
      useFactory: (postgres: PostgresPoolService) =>
        new PostgresTenantStatusRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    TrustedPaygTelephonyCallStartService,
    TwilioMediaStreamsWebSocketBridge,
    TelephonyShutdownLifecycle,
    PremiumPstnDispatchSnapshotResolver,
    {
      provide: PstnSandwichCallExecution,
      useFactory: (repository: TelephonyIncrementalRepository, manifests: PublishedWorkflowManifestRepository,
        database: PostgresPoolService, policy: RuntimePromptPolicyService, voices: VoiceLibraryService,
        toolExecutor: RuntimeAgentToolExecutorService) =>
        new PstnSandwichCallExecution({ repository, manifests, toolExecutor, promptPolicyService: policy,
          observability: createConfiguredRuntimeObservabilityRecorder(process.env), createProviders: () => {
          const config = resolveLiveSandboxProviderConfig(process.env);
          if (!config.assemblyAiApiKey || !config.cartesiaApiKey) throw new Error("Standard PSTN speech providers are not configured.");
          const usageRecorder = new ProviderUsageRecordingRepository(database.pool);
          return {
            intentClassifier: config.geminiApiKey ? new GeminiIntentClassifierProvider({ apiKey: config.geminiApiKey,
              baseUrl: config.geminiBaseUrl, modelId: config.intentClassifierModelId }) : new UnavailableLiveSandboxIntentClassifierProvider(),
            stt: new AssemblyAiSttProvider({ apiKey: config.assemblyAiApiKey, usageRecorder }),
            model: createLiveSandboxTextModelProvider(config, {
              usageRecorder, openAiProjectId: process.env.OPENAI_PROJECT_ID,
            }),
            tts: new CartesiaTtsProvider({ apiKey: config.cartesiaApiKey, apiVersion: config.cartesiaApiVersion,
              resolveVoiceId: input => voices.resolveProviderVoiceId(input) }),
          };
        } }),
      inject: [TELEPHONY_INCREMENTAL_REPOSITORY, PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
        PostgresPoolService, RuntimePromptPolicyService, VoiceLibraryService, RuntimeAgentToolExecutorService],
    },
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
