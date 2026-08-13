import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PremiumRealtimeConversationPolicyModule } from "../premium-realtime-policy/premium-realtime-conversation-policy.module";
import { RuntimePromptPolicyModule } from "../runtime-prompt-policy/runtime-prompt-policy.module";
import { PremiumRealtimeRuntimeModule } from "../runtime-sessions/premium-realtime-runtime.module";
import { PstnAdmissionModule } from "../telephony/pstn-admission.module";
import { TelephonyController } from "../telephony/telephony.controller";
import { TelephonyModule } from "../telephony/telephony.module";
import { RuntimeSessionsModule } from "../runtime-sessions/runtime-sessions.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY } from "../workflows/published-workflow-manifest.repository";
import { AppModule } from "../app.module";
import { BillingRuntimeFundingModule } from "../billing/billing-runtime-funding.module";
import { BillingCustomerStateReconciliationScheduler } from "../billing/billing-customer-state-reconciliation.scheduler";
import { BillingPolarOutboxScheduler } from "../billing/billing-polar-outbox.scheduler";
import { TrustedPaygActiveCallFundingService } from "../billing/trusted-payg-active-call-funding.service";
import { BillingService } from "../billing/billing.service";
import { TrustedBillingUsageProducer } from "../billing/trusted-billing-usage-producer";
import { TrustedPaygTerminalFinalizationService } from "../billing/trusted-payg-terminal-finalization.service";
import { TrustedSubscriptionCallLifecycleService } from "../billing/trusted-subscription-call-lifecycle.service";
import { TerminalBillingRecoveryRepository } from "../billing/terminal-billing-recovery.repository";
import { TrustedTerminalBillingRecoveryService } from "../billing/trusted-terminal-billing-recovery.service";
import { TerminalBillingRecoveryScheduler } from "../billing/terminal-billing-recovery.scheduler";
import { PstnRealtimeWorkerHealthController } from "./pstn-realtime-worker-health.controller";
import {
  createPstnRealtimeWorkerRegistry,
  PSTN_REALTIME_WORKER_CONFIG,
  PstnRealtimeWorkerModule,
  resolvePstnRealtimeWorkerIdentity,
} from "./pstn-realtime-worker.module";
import { PstnRealtimeWorkerRegistry } from "./pstn-realtime-worker-registry";
import { PstnPremiumFinalizationReconciler } from "./pstn-premium-finalization-reconciler";
import { TelephonyService } from "../telephony/telephony.service";
import { PstnPremiumCallExecution } from "../telephony/pstn-premium-call-execution";

describe("PstnRealtimeWorkerModule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("imports only the controller-free runtime dependencies", () => {
    const imports = moduleMetadata<unknown[]>("imports");

    expect(imports).toEqual(expect.arrayContaining([
      PremiumRealtimeRuntimeModule,
      PstnAdmissionModule,
      PremiumRealtimeConversationPolicyModule,
      RuntimePromptPolicyModule,
      BillingRuntimeFundingModule,
    ]));
    expect(imports).not.toEqual(expect.arrayContaining([
      AppModule,
      TelephonyModule,
      RuntimeSessionsModule,
      WorkflowsModule,
    ]));
  });

  it("exposes only the worker health controller", () => {
    expect(moduleMetadata<unknown[]>("controllers")).toEqual([
      PstnRealtimeWorkerHealthController,
    ]);
    expect(moduleMetadata<unknown[]>("controllers")).not.toContain(
      TelephonyController,
    );
  });

  it("declares worker config and registry providers without control-plane controllers", () => {
    const providers = moduleMetadata<Array<
      | { provide?: unknown }
      | (new (...args: never[]) => unknown)
    >>("providers");
    const providedTokens = providers.map((provider) =>
      typeof provider === "function" ? provider : provider.provide
    );

    expect(providedTokens).toEqual(expect.arrayContaining([
      PSTN_REALTIME_WORKER_CONFIG,
      PstnRealtimeWorkerRegistry,
      PstnPremiumFinalizationReconciler,
      PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
    ]));
    expect(providedTokens).not.toContain(TelephonyController);
  });

  it("compiles the production worker dependency graph", async () => {
    for (const [name, value] of Object.entries(workerEnvironment())) {
      vi.stubEnv(name, value);
    }

    const moduleRef = await Test.createTestingModule({
      imports: [PstnRealtimeWorkerModule],
    }).compile();

    expect(moduleRef.get(PstnRealtimeWorkerRegistry)).toBeInstanceOf(
      PstnRealtimeWorkerRegistry,
    );
    expect(moduleRef.get(TrustedPaygActiveCallFundingService)).toBeInstanceOf(
      TrustedPaygActiveCallFundingService,
    );
    expect(moduleRef.get(BillingService)).toBeInstanceOf(BillingService);
    expect(moduleRef.get(TrustedBillingUsageProducer)).toBeInstanceOf(
      TrustedBillingUsageProducer,
    );
    expect(moduleRef.get(TrustedPaygTerminalFinalizationService)).toBeInstanceOf(
      TrustedPaygTerminalFinalizationService,
    );
    expect(moduleRef.get(TrustedSubscriptionCallLifecycleService)).toBeInstanceOf(
      TrustedSubscriptionCallLifecycleService,
    );
    expect(moduleRef.get(TerminalBillingRecoveryRepository)).toBeInstanceOf(
      TerminalBillingRecoveryRepository,
    );
    expect(moduleRef.get(TrustedTerminalBillingRecoveryService)).toBeInstanceOf(
      TrustedTerminalBillingRecoveryService,
    );
    const telephony = moduleRef.get(TelephonyService);
    expect(telephony).toBeInstanceOf(TelephonyService);
    const trustedBilling = telephony as unknown as {
      trustedBillingUsageProducer?: unknown;
      trustedPaygTerminalFinalizer?: unknown;
      trustedSubscriptionLifecycle?: unknown;
      trustedTerminalBillingRecovery?: unknown;
    };
    expect(trustedBilling.trustedBillingUsageProducer).toBeInstanceOf(
      TrustedBillingUsageProducer,
    );
    expect(trustedBilling.trustedPaygTerminalFinalizer).toBeInstanceOf(
      TrustedPaygTerminalFinalizationService,
    );
    expect(trustedBilling.trustedSubscriptionLifecycle).toBeInstanceOf(
      TrustedSubscriptionCallLifecycleService,
    );
    expect(trustedBilling.trustedTerminalBillingRecovery).toBeInstanceOf(
      TrustedTerminalBillingRecoveryService,
    );
    expect(moduleRef.get(PstnPremiumCallExecution)).toBeInstanceOf(
      PstnPremiumCallExecution,
    );
    expect(() => moduleRef.get(BillingPolarOutboxScheduler, { strict: false })).toThrow();
    expect(() => moduleRef.get(BillingCustomerStateReconciliationScheduler, {
      strict: false,
    })).toThrow();
    expect(() => moduleRef.get(TerminalBillingRecoveryScheduler, { strict: false })).toThrow();
    await moduleRef.close();
  });
});

describe("worker identity and registry factories", () => {
  it("requires the exact worker process role and worker ID", () => {
    expect(resolvePstnRealtimeWorkerIdentity({
      ZARA_PROCESS_ROLE: "pstn-realtime-worker",
      PSTN_WORKER_ID: "worker-eu-1",
    })).toEqual({
      role: "pstn-realtime-worker",
      workerId: "worker-eu-1",
    });

    expect(() => resolvePstnRealtimeWorkerIdentity({
      ZARA_PROCESS_ROLE: "api",
      PSTN_WORKER_ID: "worker-eu-1",
    })).toThrow("ZARA_PROCESS_ROLE must be 'pstn-realtime-worker'");
  });

  it("fails closed when the Redis client is absent", () => {
    expect(() =>
      createPstnRealtimeWorkerRegistry(undefined, {
        heartbeatTtlMs: 15_000,
      })
    ).toThrow("PSTN admission Redis is required");
  });
});

function moduleMetadata<T>(key: "imports" | "controllers" | "providers") {
  return Reflect.getMetadata(
    MODULE_METADATA[key.toUpperCase() as Uppercase<typeof key>],
    PstnRealtimeWorkerModule,
  ) as T;
}

function workerEnvironment() {
  return {
    NODE_ENV: "production",
    ZARA_PROCESS_ROLE: "pstn-realtime-worker",
    PSTN_WORKER_ID: "worker-eu-1",
    PSTN_WORKER_RELEASE_ID: "release-abc123",
    PSTN_WORKER_PUBLIC_MEDIA_URL:
      "wss://worker-eu-1.zara.test/telephony/twilio/media-streams",
    PORT: "4020",
    PSTN_WORKER_HEARTBEAT_INTERVAL_MS: "5000",
    PSTN_WORKER_HEARTBEAT_TTL_MS: "15000",
    PSTN_WORKER_DRAIN_TIMEOUT_MS: "1800000",
    PSTN_WORKER_MAX_CALLS: "20",
    PSTN_WORKER_MAX_CPU_PERCENT: "85",
    PSTN_WORKER_MAX_MEMORY_PERCENT: "85",
    PSTN_WORKER_MAX_MEMORY_BYTES: "1073741824",
    PSTN_WORKER_MAX_EVENT_LOOP_LAG_MS: "250",
    PSTN_WORKER_MAX_OPEN_FILE_DESCRIPTORS: "4096",
    PSTN_WORKER_MAX_WEBSOCKETS: "200",
    PSTN_ADMISSION_REDIS_URL: "redis://127.0.0.1:6379",
    PSTN_ADMISSION_GLOBAL_CPS_RATE: "10",
    PSTN_ADMISSION_GLOBAL_CPS_BURST: "10",
    PSTN_ADMISSION_PROVIDER_CPS_RATE: "5",
    PSTN_ADMISSION_PROVIDER_CPS_BURST: "5",
    DATABASE_URL: "postgresql://zara:test@127.0.0.1:5432/zara",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
    OPENAI_API_KEY: "openai-key",
  };
}
