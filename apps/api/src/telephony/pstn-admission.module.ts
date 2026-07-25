import {
  Global,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { InMemoryPstnCallAdmission } from "./in-memory-pstn-call-admission";
import {
  resolvePstnAdmissionConfig,
  type PstnAdmissionConfig,
  type PstnAdmissionUnavailableReason,
} from "./pstn-admission-config";
import { PstnAdmissionCoordinator } from "./pstn-admission-coordinator";
import {
  createPstnAdmissionRedisClient,
  type PstnAdmissionRedisClient,
} from "./pstn-admission-redis-client";
import {
  PSTN_CALL_ADMISSION,
  type PstnCallAdmission,
} from "./pstn-call-admission";
import { RedisPstnCallAdmission } from "./redis-pstn-call-admission";

export const PSTN_ADMISSION_CONFIG = Symbol("PSTN_ADMISSION_CONFIG");
const PSTN_ADMISSION_REDIS_CLIENT = Symbol(
  "PSTN_ADMISSION_REDIS_CLIENT",
);

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
      provide: PstnAdmissionCoordinator,
      useFactory: (
        admission: PstnCallAdmission,
        config: PstnAdmissionConfig,
        observability: PstnCapacityObservability,
      ) =>
        new PstnAdmissionCoordinator(
          admission,
          config,
          observability,
        ),
      inject: [
        PSTN_CALL_ADMISSION,
        PSTN_ADMISSION_CONFIG,
        PstnCapacityObservability,
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
    PSTN_CALL_ADMISSION,
    PstnCapacityObservability,
    PstnAdmissionCoordinator,
    PstnAdmissionRedisLifecycle,
  ],
})
export class PstnAdmissionModule {}
