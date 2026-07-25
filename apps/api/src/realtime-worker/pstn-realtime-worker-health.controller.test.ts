import {
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { RequestMethod, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { PstnRealtimeWorkerHealthController } from "./pstn-realtime-worker-health.controller";
import type { PstnRealtimeWorkerHealthPosture } from "./pstn-realtime-worker-lifecycle";

describe("PstnRealtimeWorkerHealthController", () => {
  it("exposes the expected liveness and readiness routes", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, PstnRealtimeWorkerHealthController),
    ).toBe("health");
    expect(routeMetadata("live")).toEqual({
      path: "live",
      method: RequestMethod.GET,
    });
    expect(routeMetadata("ready")).toEqual({
      path: "ready",
      method: RequestMethod.GET,
    });
  });

  it("keeps liveness successful while draining", () => {
    const controller = createController(posture({
      state: "draining",
      acceptingCalls: false,
    }));

    expect(controller.live()).toEqual({
      status: "live",
      state: "draining",
    });
  });

  it("returns readiness only when every readiness condition passes", () => {
    const readyPosture = posture();
    const controller = createController(readyPosture);

    expect(controller.ready()).toEqual({
      status: "ready",
      ...readyPosture,
    });
  });

  const readinessFailures: Array<
    [string, Partial<PstnRealtimeWorkerHealthPosture>]
  > = [
    ["not registered", { registered: false }],
    ["redis unhealthy", {
      dependencies: { redis: false, postgres: true },
    }],
    ["postgres unhealthy", {
      dependencies: { redis: true, postgres: false },
    }],
    ["resources exhausted", { belowExhaustion: false }],
    ["not accepting calls", { acceptingCalls: false }],
    ["draining", { state: "draining", acceptingCalls: false }],
  ];

  it.each(readinessFailures)("returns 503 when %s", (_label, override) => {
    const controller = createController(posture(override));

    expect(() => controller.ready()).toThrow(ServiceUnavailableException);
  });
});

function createController(health: PstnRealtimeWorkerHealthPosture) {
  return new PstnRealtimeWorkerHealthController({
    getHealthPosture: () => health,
  });
}

function posture(
  override: Partial<PstnRealtimeWorkerHealthPosture> = {},
): PstnRealtimeWorkerHealthPosture {
  return {
    state: "ready",
    registered: true,
    dependencies: { redis: true, postgres: true },
    belowExhaustion: true,
    acceptingCalls: true,
    activeCalls: 2,
    startingCalls: 1,
    availableSlots: 17,
    ...override,
  };
}

function routeMetadata(methodName: "live" | "ready") {
  const method = PstnRealtimeWorkerHealthController.prototype[methodName];
  return {
    path: Reflect.getMetadata(PATH_METADATA, method),
    method: Reflect.getMetadata(METHOD_METADATA, method),
  };
}
