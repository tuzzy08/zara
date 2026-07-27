import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PstnAdmissionCoordinator } from "../telephony/pstn-admission-coordinator";
import { HealthController } from "./health.controller";

function createController(
  health:
    | {
        status: "healthy";
        backend: "memory" | "redis";
      }
    | {
        status: "unavailable";
        backend: "redis";
        reasonCode: "backend_unavailable" | "indeterminate_result";
      },
) {
  return new HealthController({
    getHealth: vi.fn(async () => health),
  } as unknown as PstnAdmissionCoordinator);
}

describe("HealthController", () => {
  it("keeps liveness independent from Redis readiness", () => {
    const controller = createController({
      status: "unavailable",
      backend: "redis",
      reasonCode: "backend_unavailable",
    });

    expect(controller.getHealth()).toEqual({
      status: "ok",
      service: "zara-api",
    });
  });

  it("reports ready only when PSTN admission is healthy", async () => {
    const controller = createController({
      status: "healthy",
      backend: "redis",
    });

    await expect(controller.getReadiness()).resolves.toEqual({
      status: "ready",
      checks: {
        pstnAdmission: {
          status: "healthy",
          backend: "redis",
        },
      },
    });
  });

  it("returns a bounded 503 readiness response when admission is unavailable", async () => {
    const controller = createController({
      status: "unavailable",
      backend: "redis",
      reasonCode: "backend_unavailable",
    });

    try {
      await controller.getReadiness();
      throw new Error("Expected readiness to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const unavailable = error as ServiceUnavailableException;
      expect(unavailable.getStatus()).toBe(503);
      expect(unavailable.getResponse()).toEqual({
        status: "not_ready",
        checks: {
          pstnAdmission: {
            status: "unavailable",
            backend: "redis",
            reasonCode: "backend_unavailable",
          },
        },
      });
    }
  });
});
