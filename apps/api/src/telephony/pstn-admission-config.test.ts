import { describe, expect, it } from "vitest";

import { resolvePstnAdmissionConfig } from "./pstn-admission-config";

describe("resolvePstnAdmissionConfig", () => {
  it("requires Redis in production and keeps the provisional global cap at 20", () => {
    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      HOSTNAME: "api-primary",
      PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
      PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
      PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
      PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
      PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
    })).toMatchObject({
      mode: "redis",
      redisUrl: "redis://redis:6379",
      workerId: "api-primary",
      limits: {
        global: 20,
        provider: 20,
        tenant: 20,
        worker: 20,
        runtime: {
          "pstn-sandwich": 20,
          "pstn-premium-realtime": 20,
        },
      },
      claimTtlMs: 30_000,
      activeTtlMs: 120_000,
      renewIntervalMs: 30_000,
      commandTimeoutMs: 750,
    });

    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      HOSTNAME: "api-primary",
    })).toMatchObject({
      mode: "unavailable",
      unavailableReason: "redis_not_configured",
    });

    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
    })).toMatchObject({
      mode: "unavailable",
      unavailableReason: "admission_config_invalid",
    });
  });

  it("uses memory only outside production and accepts bounded platform overrides", () => {
    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "test",
      PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS: "12",
      PSTN_ADMISSION_PROVIDER_MAX_CONCURRENT_CALLS: "9",
      PSTN_ADMISSION_TENANT_MAX_CONCURRENT_CALLS: "7",
      PSTN_ADMISSION_WORKER_MAX_CONCURRENT_CALLS: "6",
      PSTN_ADMISSION_SANDWICH_MAX_CONCURRENT_CALLS: "8",
      PSTN_ADMISSION_PREMIUM_MAX_CONCURRENT_CALLS: "4",
      PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
      PSTN_ADMISSION_GLOBAL_CPS_RATE: "5",
      PSTN_ADMISSION_PROVIDER_CPS_BURST: "4",
      PSTN_ADMISSION_PROVIDER_CPS_RATE: "2",
      PSTN_ADMISSION_CLAIM_TTL_MS: "45000",
      PSTN_ADMISSION_ACTIVE_TTL_MS: "180000",
      PSTN_ADMISSION_RENEW_INTERVAL_MS: "45000",
      PSTN_ADMISSION_COMMAND_TIMEOUT_MS: "500",
      PSTN_WORKER_ID: "worker-a",
    })).toEqual({
      mode: "memory",
      workerId: "worker-a",
      limits: {
        global: 12,
        provider: 9,
        tenant: 7,
        worker: 6,
        runtime: {
          "pstn-sandwich": 8,
          "pstn-premium-realtime": 4,
        },
      },
      cps: {
        global: {
          capacity: 10,
          refillPerSecond: 5,
        },
        providerAccount: {
          capacity: 4,
          refillPerSecond: 2,
        },
      },
      claimTtlMs: 45_000,
      activeTtlMs: 180_000,
      renewIntervalMs: 45_000,
      commandTimeoutMs: 500,
    });
  });

  it.each([
    {
      label: "an explicitly malformed renewal interval",
      overrides: {
        PSTN_ADMISSION_RENEW_INTERVAL_MS: "later",
      },
    },
    {
      label: "an unsafe active TTL and renewal interval relationship",
      overrides: {
        PSTN_ADMISSION_ACTIVE_TTL_MS: "30000",
        PSTN_ADMISSION_RENEW_INTERVAL_MS: "20000",
      },
    },
  ])("fails production admission closed for $label", ({ overrides }) => {
    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
      PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
      PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
      PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
      PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
      ...overrides,
    })).toMatchObject({
      mode: "unavailable",
      unavailableReason: "admission_config_invalid",
    });
  });

  it.each([
    {
      overrides: {
        PSTN_ADMISSION_RENEW_INTERVAL_MS: "later",
      },
    },
    {
      overrides: {
        PSTN_ADMISSION_ACTIVE_TTL_MS: "30000",
        PSTN_ADMISSION_RENEW_INTERVAL_MS: "20000",
      },
    },
  ])("keeps deterministic lease defaults outside production", ({ overrides }) => {
    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "test",
      ...overrides,
    })).toMatchObject({
      mode: "memory",
      activeTtlMs: 120_000,
      renewIntervalMs: 30_000,
    });
  });

  it("honors an explicit zero concurrency limit and fails malformed production limits closed", () => {
    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "test",
      PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS: "0",
    }).limits.global).toBe(0);

    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
      PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
      PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
      PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
      PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
      PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS: "twenty",
    })).toMatchObject({
      mode: "unavailable",
      unavailableReason: "admission_config_invalid",
    });

    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      HOSTNAME: "api-primary",
      PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
      PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
      PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
      PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
      PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
      PSTN_ADMISSION_GLOBAL_MAX_CONCURRENT_CALLS: "1000001",
    })).toMatchObject({
      mode: "unavailable",
      unavailableReason: "admission_config_invalid",
    });
  });

  it.each([
    ["PSTN_ADMISSION_GLOBAL_CPS_BURST", "100001"],
    ["PSTN_ADMISSION_PROVIDER_CPS_RATE", "100001"],
    ["PSTN_ADMISSION_GLOBAL_CPS_BURST", "1.5"],
    ["PSTN_ADMISSION_PROVIDER_CPS_BURST", "2.5"],
    ["PSTN_ADMISSION_CLAIM_TTL_MS", "300001"],
    ["PSTN_ADMISSION_ACTIVE_TTL_MS", "300001"],
  ] as const)(
    "fails oversized production admission setting %s closed before readiness",
    (name, value) => {
      expect(resolvePstnAdmissionConfig({
        NODE_ENV: "production",
        PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
        PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
        PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
        PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
        PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
        [name]: value,
      })).toMatchObject({
        mode: "unavailable",
        unavailableReason: "admission_config_invalid",
      });
    },
  );

  it("loads an explicit platform-owned Twilio quota allowance", () => {
    expect(resolvePstnAdmissionConfig({
      NODE_ENV: "production",
      PSTN_ADMISSION_REDIS_URL: "redis://redis:6379",
      PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
      PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
      PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
      PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
      PSTN_ADMISSION_TWILIO_QUOTA_MAX_CONCURRENT_CALLS: "3",
    })).toMatchObject({
      mode: "redis",
      providerQuotaAllowances: {
        twilio: 3,
      },
    });
  });
});
