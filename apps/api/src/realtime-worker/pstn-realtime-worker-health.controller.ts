import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  PstnRealtimeWorkerHealthPosture,
} from "./pstn-realtime-worker-lifecycle";

export interface PstnRealtimeWorkerHealthSource {
  getHealthPosture(): PstnRealtimeWorkerHealthPosture;
}

export const PSTN_REALTIME_WORKER_HEALTH_SOURCE = Symbol(
  "PSTN_REALTIME_WORKER_HEALTH_SOURCE",
);

@Controller("health")
export class PstnRealtimeWorkerHealthController {
  constructor(
    @Inject(PSTN_REALTIME_WORKER_HEALTH_SOURCE)
    private readonly healthSource: PstnRealtimeWorkerHealthSource,
  ) {}

  @Get("live")
  live() {
    const health = this.healthSource.getHealthPosture();
    return {
      status: "live" as const,
      state: health.state,
    };
  }

  @Get("ready")
  ready() {
    const health = this.healthSource.getHealthPosture();
    if (
      health.state !== "ready"
      || !health.registered
      || !health.dependencies.redis
      || !health.dependencies.postgres
      || !health.belowExhaustion
      || !health.acceptingCalls
    ) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        ...health,
      });
    }
    return {
      status: "ready" as const,
      ...health,
    };
  }
}
