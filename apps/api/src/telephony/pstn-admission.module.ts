import {
  Global,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { PostgresPoolService } from "../database/postgres-pool.service";
import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import {
  resolvePstnAdmissionConfig,
  type PstnAdmissionConfig,
  type PstnAdmissionUnavailableReason,
} from "./pstn-admission-config";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import {
  InMemoryPstnCapacityPolicyRepository,
  PSTN_CAPACITY_POLICY_REPOSITORY,
  type PstnCapacityPolicyRepository,
} from "./pstn-capacity-policy.repository";
import { PstnCapacityPolicyService } from "./pstn-capacity-policy.service";
import {
  InMemoryPstnCapacityRejectionRepository,
  PSTN_CAPACITY_REJECTION_REPOSITORY,
  type PstnCapacityRejectionRepository,
} from "./pstn-capacity-rejection.repository";
import { PstnCapacityRejectionService } from "./pstn-capacity-rejection.service";
import { PstnCapacityReadService } from "./pstn-capacity-read.service";
import {
  InMemoryPstnCapacityScopeCatalog,
  PostgresPstnCapacityScopeCatalog,
  PSTN_CAPACITY_SCOPE_CATALOG,
  type PstnCapacityScopeCatalog,
} from "./pstn-capacity-scope-catalog";
import { PostgresPstnCapacityRejectionRepository } from "./postgres-pstn-capacity-rejection.repository";
import { PostgresPstnCapacityPolicyRepository } from "./postgres-pstn-capacity-policy.repository";
import {
  createPstnAdmissionRedisClient,
  type PstnAdmissionRedisClient,
} from "./pstn-admission-redis-client";
import {
  PSTN_CALL_ADMISSION,
  type PstnCallAdmission,
} from "./pstn-call-admission";
import { RedisPstnCallAdmission } from "./redis-pstn-call-admission";
import { PstnRealtimeWorkerRegistry } from "../realtime-worker/pstn-realtime-worker-registry";

export const PSTN_ADMISSION_CONFIG = Symbol("PSTN_ADMISSION_CONFIG");
export const PSTN_ADMISSION_REDIS_CLIENT = Symbol(
  "PSTN_ADMISSION_REDIS_CLIENT",
);

export function resolvePstnCapacityPersistenceMode(
  env: Record<string, string | undefined>,
) {
  if (env.NODE_ENV === "test") {
    return "memory" as const;
  }
  if ((env.DATABASE_URL?.trim().length ?? 0) > 0) {
    return "postgres" as const;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required for production PSTN capacity state.",
    );
  }
  return "memory" as const;
}

class UnavailablePstnCallAdmission implements PstnCallAdmission {
  constructor(
    private readonly unavailableReason:
      | PstnAdmissionUnavailableReason
      | undefined,
  ) {}

  async reserve() {
    return {
      outcome: "denied" as const,
      reasonCode: "backend_unavailable" as const,
      limitingDimension: "backend" as const,
    };
  }

  async activate() {
    return { outcome: "backend_unavailable" as const };
  }

  async renew() {
    return { outcome: "backend_unavailable" as const };
  }

  async release() {
    return { outcome: "backend_unavailable" as const };
  }

  async getHealth() {
    return {
      status: "unavailable" as const,
      backend: "redis" as const,
      reasonCode: "backend_unavailable" as const,
      ...(this.unavailableReason === undefined
        ? {}
        : { unavailableReason: this.unavailableReason }),
    };
  }
}

export class PstnAdmissionRedisLifecycle
  implements OnModuleInit, OnApplicationShutdown
{
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly client: PstnAdmissionRedisClient | undefined,
    private readonly coordinator: PstnAdmissionCoordinator,
  ) {}

  onModuleInit() {
    void this.client?.connect().catch(() => undefined);
  }

  async onApplicationShutdown() {
    await this.shutdown();
  }

  shutdown() {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown() {
    try {
      await this.coordinator.shutdown();
    } finally {
      this.client?.destroy();
    }
  }
}

@Global()
@Module({
  providers: [
    PostgresPoolService,
    PstnCapacityObservability,
    {
      provide: PSTN_ADMISSION_CONFIG,
      useFactory: () => resolvePstnAdmissionConfig(process.env),
    },
    {
      provide: PSTN_ADMISSION_REDIS_CLIENT,
      useFactory: (config: PstnAdmissionConfig) =>
        config.mode === "redis" && config.redisUrl !== undefined
          ? createPstnAdmissionRedisClient(
              config.redisUrl,
              config.commandTimeoutMs,
            )
          : undefined,
      inject: [PSTN_ADMISSION_CONFIG],
    },
    {
      provide: PSTN_CALL_ADMISSION,
      useFactory: (
        config: PstnAdmissionConfig,
        redisClient: PstnAdmissionRedisClient | undefined,
      ): PstnCallAdmission => {
        if (config.mode === "memory") {
          return new InMemoryPstnCallAdmission();
        }
        if (config.mode === "redis" && redisClient !== undefined) {
          return new RedisPstnCallAdmission(redisClient);
        }
        return new UnavailablePstnCallAdmission(
          config.unavailableReason,
        );
      },
      inject: [PSTN_ADMISSION_CONFIG, PSTN_ADMISSION_REDIS_CLIENT],
    },
    {
      provide: PSTN_CAPACITY_POLICY_REPOSITORY,
      useFactory: (
        postgres: PostgresPoolService,
      ): PstnCapacityPolicyRepository =>
        resolvePstnCapacityPersistenceMode(process.env) === "memory"
          ? new InMemoryPstnCapacityPolicyRepository()
          : new PostgresPstnCapacityPolicyRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: PstnCapacityPolicyService,
      useFactory: (
        repository: PstnCapacityPolicyRepository,
        config: PstnAdmissionConfig,
      ) => new PstnCapacityPolicyService(repository, config),
      inject: [
        PSTN_CAPACITY_POLICY_REPOSITORY,
        PSTN_ADMISSION_CONFIG,
      ],
    },
    {
      provide: PSTN_CAPACITY_REJECTION_REPOSITORY,
      useFactory: (
        postgres: PostgresPoolService,
      ): PstnCapacityRejectionRepository =>
        resolvePstnCapacityPersistenceMode(process.env) === "memory"
          ? new InMemoryPstnCapacityRejectionRepository()
          : new PostgresPstnCapacityRejectionRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: PstnCapacityRejectionService,
      useFactory: (repository: PstnCapacityRejectionRepository) =>
        new PstnCapacityRejectionService(repository),
      inject: [PSTN_CAPACITY_REJECTION_REPOSITORY],
    },
    {
      provide: PSTN_CAPACITY_SCOPE_CATALOG,
      useFactory: (
        postgres: PostgresPoolService,
        redisClient: PstnAdmissionRedisClient | undefined,
      ): PstnCapacityScopeCatalog =>
        resolvePstnCapacityPersistenceMode(process.env) === "memory"
          ? new InMemoryPstnCapacityScopeCatalog()
          : new PostgresPstnCapacityScopeCatalog(postgres.pool, {
              listReadyWorkerIds: async () => {
                if (redisClient === undefined) return [];
                const registry = new PstnRealtimeWorkerRegistry(
                  redisClient,
                  {},
                );
                const workers = await Promise.all([
                  registry.findReadyWorkers("openai-realtime"),
                  registry.findReadyWorkers("gemini-live"),
                ]);
                return [
                  ...new Set(
                    workers.flat().map((worker) => worker.workerId),
                  ),
                ];
              },
            }),
      inject: [PostgresPoolService, PSTN_ADMISSION_REDIS_CLIENT],
    },
    {
      provide: PstnCapacityReadService,
      useFactory: (
        policyService: PstnCapacityPolicyService,
        rejectionService: PstnCapacityRejectionService,
        admission: PstnCallAdmission,
        config: PstnAdmissionConfig,
        scopeCatalog: PstnCapacityScopeCatalog,
      ) =>
        new PstnCapacityReadService(
          policyService,
          rejectionService,
          admission,
          config,
          scopeCatalog,
        ),
      inject: [
        PstnCapacityPolicyService,
        PstnCapacityRejectionService,
        PSTN_CALL_ADMISSION,
        PSTN_ADMISSION_CONFIG,
        PSTN_CAPACITY_SCOPE_CATALOG,
      ],
    },
    {
      provide: PstnAdmissionCoordinator,
      useFactory: (
        admission: PstnCallAdmission,
        config: PstnAdmissionConfig,
        observability: PstnCapacityObservability,
        policyService: PstnCapacityPolicyService,
        rejectionService: PstnCapacityRejectionService,
      ) =>
        new PstnAdmissionCoordinator(
          admission,
          config,
          observability,
          policyService,
          rejectionService,
        ),
      inject: [
        PSTN_CALL_ADMISSION,
        PSTN_ADMISSION_CONFIG,
        PstnCapacityObservability,
        PstnCapacityPolicyService,
        PstnCapacityRejectionService,
      ],
    },
    {
      provide: PstnAdmissionRedisLifecycle,
      useFactory: (
        client: PstnAdmissionRedisClient | undefined,
        coordinator: PstnAdmissionCoordinator,
      ) => new PstnAdmissionRedisLifecycle(client, coordinator),
      inject: [
        PSTN_ADMISSION_REDIS_CLIENT,
        PstnAdmissionCoordinator,
      ],
    },
  ],
  exports: [
    PSTN_ADMISSION_CONFIG,
    PSTN_ADMISSION_REDIS_CLIENT,
    PSTN_CALL_ADMISSION,
    PSTN_CAPACITY_POLICY_REPOSITORY,
    PSTN_CAPACITY_REJECTION_REPOSITORY,
    PSTN_CAPACITY_SCOPE_CATALOG,
    PstnCapacityObservability,
    PstnCapacityPolicyService,
    PstnCapacityRejectionService,
    PstnCapacityReadService,
    PstnAdmissionCoordinator,
    PstnAdmissionRedisLifecycle,
  ],
})
export class PstnAdmissionModule {}
