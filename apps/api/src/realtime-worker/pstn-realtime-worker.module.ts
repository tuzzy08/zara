import { Module } from "@nestjs/common";

import { PostgresPoolService } from "../database/postgres-pool.service";
import { PremiumRealtimeConversationPolicyModule } from "../premium-realtime-policy/premium-realtime-conversation-policy.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import {
  createConfiguredPstnCallObservabilityRecorder,
  pstnCallObservabilityRecorderToken,
} from "../runtime-observability/runtime-observability";
import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { PremiumRealtimeRuntimeModule } from "../runtime-sessions/premium-realtime-runtime.module";
import { PostgresTelephonyIncrementalRepository } from "../telephony/postgres-telephony-incremental.repository";
import { PostgresTelephonyStateRepository } from "../telephony/postgres-telephony-state.repository";
import {
  PSTN_ADMISSION_REDIS_CLIENT,
  PstnAdmissionModule,
  PstnAdmissionRedisLifecycle,
} from "../telephony/pstn-admission.module";
import type { PstnAdmissionRedisClient } from "../telephony/pstn-admission-redis-client";
import {
  PSTN_MEDIA_PROCESS_ROLE,
  PSTN_MEDIA_WORKER_READINESS,
  PSTN_MEDIA_WORKER_ID,
  PSTN_MEDIA_WORKER_RELEASE_ID,
  resolvePstnMediaProcessRole,
  resolvePstnMediaWorkerId,
} from "../telephony/pstn-media-process-role";
import { PstnPremiumCallExecution } from "../telephony/pstn-premium-call-execution";
import { PremiumPstnDispatchSnapshotResolver } from "../telephony/premium-pstn-dispatch-snapshot-resolver";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "../telephony/telephony-incremental.repository";
import { resolveTelephonySecretVaultConfig } from "../telephony/telephony-env";
import { TelephonySecretVault } from "../telephony/telephony-secret-vault";
import { TELEPHONY_STATE_REPOSITORY } from "../telephony/telephony-state.repository";
import { TelephonyService } from "../telephony/telephony.service";
import {
  TWILIO_NUMBER_INVENTORY_PROVIDER,
  TwilioRestNumberInventoryProvider,
} from "../telephony/twilio-number-inventory.provider";
import {
  TWILIO_NUMBER_ROUTING_PROVIDER,
  TwilioRestNumberRoutingProvider,
} from "../telephony/twilio-number-routing.provider";
import { TwilioMediaStreamsWebSocketBridge } from "../telephony/twilio-media-streams.websocket-bridge";
import {
  PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
} from "../workflows/published-workflow-manifest.repository";
import { PostgresPublishedWorkflowManifestRepository } from "../workflows/postgres-published-workflow-manifest.repository";
import {
  resolvePstnRealtimeWorkerConfig,
  type PstnRealtimeWorkerConfig,
} from "./pstn-realtime-worker-config";
import {
  PSTN_REALTIME_WORKER_HEALTH_SOURCE,
  PstnRealtimeWorkerHealthController,
} from "./pstn-realtime-worker-health.controller";
import {
  PstnCapacityExecutionPostureAdapter,
  PstnCapacityProcessMetricsSource,
  PstnRealtimeWorkerHostLifecycle,
  PstnRealtimeWorkerPostgresHealthCheck,
  PstnRealtimeWorkerRedisHealthCheck,
} from "./pstn-realtime-worker-host";
import {
  BoundedPstnRealtimeWorkerResourceSampler,
  PstnRealtimeWorkerLifecycleService,
} from "./pstn-realtime-worker-lifecycle";
import { PstnRealtimeWorkerRegistry } from "./pstn-realtime-worker-registry";
import { PstnPremiumFinalizationReconciler } from "./pstn-premium-finalization-reconciler";

export const PSTN_REALTIME_WORKER_CONFIG = Symbol(
  "PSTN_REALTIME_WORKER_CONFIG",
);
const PSTN_REALTIME_WORKER_REDIS_HEALTH = Symbol(
  "PSTN_REALTIME_WORKER_REDIS_HEALTH",
);
const PSTN_REALTIME_WORKER_POSTGRES_HEALTH = Symbol(
  "PSTN_REALTIME_WORKER_POSTGRES_HEALTH",
);
const PSTN_REALTIME_WORKER_EXECUTION_POSTURE = Symbol(
  "PSTN_REALTIME_WORKER_EXECUTION_POSTURE",
);
const PSTN_REALTIME_WORKER_RESOURCE_SAMPLER = Symbol(
  "PSTN_REALTIME_WORKER_RESOURCE_SAMPLER",
);
const PSTN_REALTIME_WORKER_PROCESS_METRICS = Symbol(
  "PSTN_REALTIME_WORKER_PROCESS_METRICS",
);

@Module({
  imports: [
    PremiumRealtimeRuntimeModule,
    PstnAdmissionModule,
    PremiumRealtimeConversationPolicyModule,
    RuntimePromptPolicyModule,
  ],
  controllers: [PstnRealtimeWorkerHealthController],
  providers: [
    PostgresPoolService,
    TelephonyService,
    PremiumPstnDispatchSnapshotResolver,
    PstnPremiumCallExecution,
    PstnPremiumFinalizationReconciler,
    TwilioMediaStreamsWebSocketBridge,
    {
      provide: PSTN_REALTIME_WORKER_CONFIG,
      useFactory: () => {
        const identity = resolvePstnRealtimeWorkerIdentity(process.env);
        const config = resolvePstnRealtimeWorkerConfig(process.env);
        if (identity.workerId !== config.workerId) {
          throw new Error("PSTN worker identity does not match worker config.");
        }
        return config;
      },
    },
    {
      provide: PSTN_MEDIA_PROCESS_ROLE,
      useFactory: () => resolvePstnRealtimeWorkerIdentity(process.env).role,
    },
    {
      provide: PSTN_MEDIA_WORKER_ID,
      useFactory: (config: PstnRealtimeWorkerConfig) => config.workerId,
      inject: [PSTN_REALTIME_WORKER_CONFIG],
    },
    {
      provide: PSTN_MEDIA_WORKER_RELEASE_ID,
      useFactory: (config: PstnRealtimeWorkerConfig) => config.releaseId,
      inject: [PSTN_REALTIME_WORKER_CONFIG],
    },
    {
      provide: PSTN_MEDIA_WORKER_READINESS,
      useFactory: (lifecycle: PstnRealtimeWorkerLifecycleService) => ({
        isAcceptingCalls: () =>
          lifecycle.getHealthPosture().acceptingCalls,
      }),
      inject: [PstnRealtimeWorkerLifecycleService],
    },
    {
      provide: PstnRealtimeWorkerRegistry,
      useFactory: createPstnRealtimeWorkerRegistry,
      inject: [PSTN_ADMISSION_REDIS_CLIENT, PSTN_REALTIME_WORKER_CONFIG],
    },
    {
      provide: PSTN_REALTIME_WORKER_REDIS_HEALTH,
      useFactory: (client: PstnAdmissionRedisClient | undefined) => {
        if (client === undefined) {
          throw new Error("PSTN admission Redis is required by the realtime worker.");
        }
        return new PstnRealtimeWorkerRedisHealthCheck(client);
      },
      inject: [PSTN_ADMISSION_REDIS_CLIENT],
    },
    {
      provide: PSTN_REALTIME_WORKER_POSTGRES_HEALTH,
      useFactory: (postgres: PostgresPoolService) =>
        new PstnRealtimeWorkerPostgresHealthCheck(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: PSTN_REALTIME_WORKER_EXECUTION_POSTURE,
      useFactory: (
        capacity: PstnCapacityObservability,
        config: PstnRealtimeWorkerConfig,
      ) => new PstnCapacityExecutionPostureAdapter(capacity, config),
      inject: [PstnCapacityObservability, PSTN_REALTIME_WORKER_CONFIG],
    },
    {
      provide: PSTN_REALTIME_WORKER_PROCESS_METRICS,
      useFactory: (capacity: PstnCapacityObservability) =>
        new PstnCapacityProcessMetricsSource(capacity),
      inject: [PstnCapacityObservability],
    },
    {
      provide: PSTN_REALTIME_WORKER_RESOURCE_SAMPLER,
      useFactory: (
        config: PstnRealtimeWorkerConfig,
        source: PstnCapacityProcessMetricsSource,
      ) => new BoundedPstnRealtimeWorkerResourceSampler(config, source),
      inject: [
        PSTN_REALTIME_WORKER_CONFIG,
        PSTN_REALTIME_WORKER_PROCESS_METRICS,
      ],
    },
    {
      provide: PstnRealtimeWorkerLifecycleService,
      useFactory: (
        config: PstnRealtimeWorkerConfig,
        registry: PstnRealtimeWorkerRegistry,
        redisHealth: PstnRealtimeWorkerRedisHealthCheck,
        postgresHealth: PstnRealtimeWorkerPostgresHealthCheck,
        executionPosture: PstnCapacityExecutionPostureAdapter,
        resourceSampler: BoundedPstnRealtimeWorkerResourceSampler,
      ) =>
        new PstnRealtimeWorkerLifecycleService(
          config,
          registry,
          redisHealth,
          postgresHealth,
          executionPosture,
          resourceSampler,
        ),
      inject: [
        PSTN_REALTIME_WORKER_CONFIG,
        PstnRealtimeWorkerRegistry,
        PSTN_REALTIME_WORKER_REDIS_HEALTH,
        PSTN_REALTIME_WORKER_POSTGRES_HEALTH,
        PSTN_REALTIME_WORKER_EXECUTION_POSTURE,
        PSTN_REALTIME_WORKER_RESOURCE_SAMPLER,
      ],
    },
    {
      provide: PSTN_REALTIME_WORKER_HEALTH_SOURCE,
      useExisting: PstnRealtimeWorkerLifecycleService,
    },
    {
      provide: PstnRealtimeWorkerHostLifecycle,
      useFactory: (
        client: PstnAdmissionRedisClient | undefined,
        lifecycle: PstnRealtimeWorkerLifecycleService,
        bridge: TwilioMediaStreamsWebSocketBridge,
        execution: PstnPremiumCallExecution,
        admission: PstnAdmissionRedisLifecycle,
        capacity: PstnCapacityObservability,
      ) => {
        if (client === undefined) {
          throw new Error("PSTN admission Redis is required by the realtime worker.");
        }
        return new PstnRealtimeWorkerHostLifecycle(
          client,
          lifecycle,
          bridge,
          execution,
          admission,
          capacity,
        );
      },
      inject: [
        PSTN_ADMISSION_REDIS_CLIENT,
        PstnRealtimeWorkerLifecycleService,
        TwilioMediaStreamsWebSocketBridge,
        PstnPremiumCallExecution,
        PstnAdmissionRedisLifecycle,
        PstnCapacityObservability,
      ],
    },
    {
      provide: TELEPHONY_STATE_REPOSITORY,
      useFactory: (
        postgres: PostgresPoolService,
        capacity: PstnCapacityObservability,
      ) => new PostgresTelephonyStateRepository(postgres.pool, capacity),
      inject: [PostgresPoolService, PstnCapacityObservability],
    },
    {
      provide: TELEPHONY_INCREMENTAL_REPOSITORY,
      useFactory: (
        postgres: PostgresPoolService,
        capacity: PstnCapacityObservability,
      ) => new PostgresTelephonyIncrementalRepository(postgres.pool, capacity),
      inject: [PostgresPoolService, PstnCapacityObservability],
    },
    {
      provide: PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
      useFactory: (postgres: PostgresPoolService) =>
        new PostgresPublishedWorkflowManifestRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TelephonySecretVault,
      useFactory: () =>
        new TelephonySecretVault(
          resolveTelephonySecretVaultConfig(process.env),
        ),
    },
    {
      provide: TWILIO_NUMBER_INVENTORY_PROVIDER,
      useFactory: () => new TwilioRestNumberInventoryProvider(),
    },
    {
      provide: TWILIO_NUMBER_ROUTING_PROVIDER,
      useFactory: () => new TwilioRestNumberRoutingProvider(),
    },
    {
      provide: pstnCallObservabilityRecorderToken,
      useFactory: () =>
        createConfiguredPstnCallObservabilityRecorder(process.env),
    },
  ],
})
export class PstnRealtimeWorkerModule {}

export function resolvePstnRealtimeWorkerIdentity(
  env: Record<string, string | undefined>,
) {
  const role = resolvePstnMediaProcessRole(env);
  if (role !== "pstn-realtime-worker") {
    throw new Error(
      "ZARA_PROCESS_ROLE must be 'pstn-realtime-worker' for the realtime worker.",
    );
  }
  const workerId = resolvePstnMediaWorkerId(role, env);
  if (workerId === undefined) {
    throw new Error("PSTN_WORKER_ID is required by the realtime worker.");
  }
  return { role, workerId };
}

export function createPstnRealtimeWorkerRegistry(
  client: PstnAdmissionRedisClient | undefined,
  config: Pick<PstnRealtimeWorkerConfig, "heartbeatTtlMs">,
) {
  if (client === undefined) {
    throw new Error("PSTN admission Redis is required by the realtime worker.");
  }
  return new PstnRealtimeWorkerRegistry(client, {
    heartbeatTtlMs: config.heartbeatTtlMs,
  });
}
