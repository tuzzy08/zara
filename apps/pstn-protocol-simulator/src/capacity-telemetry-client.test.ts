import { describe, expect, it, vi } from "vitest";

import { CapacityTelemetryClient } from "./capacity-telemetry-client";

describe("CapacityTelemetryClient", () => {
  it("reads the staff posture with secret headers kept outside the result", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        accept: "application/json",
        authorization: "Bearer service-secret",
        cookie: "better-auth.session_token=session-secret",
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ aiObservability: { pstnCapacity: sample } });
    });
    const client = new CapacityTelemetryClient({
      endpoint: "https://admin-api.example.test/platform-admin/runtime/ai-observability",
      bearerToken: "service-secret",
      cookie: "better-auth.session_token=session-secret",
      timeoutMs: 1_000,
      fetch,
    });

    await expect(client.read()).resolves.toEqual(sample);
    expect(JSON.stringify(await client.read())).not.toContain("service-secret");
  });

  it("fails closed on HTTP errors and incomplete posture", async () => {
    await expect(new CapacityTelemetryClient({
      endpoint: "https://admin-api.example.test/platform-admin/runtime/ai-observability",
      fetch: vi.fn(async () => new Response("secret provider body", { status: 403 })),
    }).read()).rejects.toThrow("HTTP 403");

    await expect(new CapacityTelemetryClient({
      endpoint: "https://admin-api.example.test/platform-admin/runtime/ai-observability",
      fetch: vi.fn(async () => Response.json({ aiObservability: { pstnCapacity: { status: "healthy" } } })),
    }).read()).rejects.toThrow("invalid capacity posture");

    await expect(new CapacityTelemetryClient({
      endpoint: "https://admin-api.example.test/platform-admin/runtime/ai-observability",
      fetch: vi.fn(async () => Response.json({
        aiObservability: {
          pstnCapacity: {
            ...sample,
            calls: { active: "unknown" },
          },
        },
      })),
    }).read()).rejects.toThrow("invalid capacity posture");

    const { admission: _admission, ...withoutAdmission } = sample;
    void _admission;
    await expect(new CapacityTelemetryClient({
      endpoint: "https://admin-api.example.test/platform-admin/runtime/ai-observability",
      fetch: vi.fn(async () => Response.json({
        aiObservability: { pstnCapacity: withoutAdmission },
      })),
    }).read()).rejects.toThrow("invalid capacity posture");
  });
});

const resource = { available: true, used: 0, limit: 1, utilization: 0, status: "healthy" };
const sample = {
  capturedAt: "2026-07-23T00:00:00.000Z",
  status: "healthy",
  envelope: {
    maxConcurrentCalls: 20,
    cpuLimitMillicores: 2_000,
    memoryLimitBytes: 1_073_741_824,
    fileDescriptorLimit: 4_096,
    databasePoolMax: 10,
    eventLoopDelayLimitMs: 50,
    certified: false,
    expectedWebSocketLegsPerPremiumCall: 2,
  },
  resources: {
    calls: resource,
    cpu: resource,
    eventLoop: resource,
    memory: resource,
    database: resource,
    fileDescriptors: resource,
    queues: resource,
  },
  calls: { active: 0 },
  admission: { trackedReservations: 0, pendingReleases: 0 },
  process: { rssBytes: 128 * 1024 * 1024 },
  sockets: { open: [], bufferedBytes: 0 },
  queues: [],
  telemetry: { metricExportFailureCount: 0 },
};
