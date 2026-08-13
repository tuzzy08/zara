import { describe, expect, it } from "vitest";

import { BillingUsageReconciliationService } from "./billing-usage-reconciliation.service";
import { BillingOutboxObservability } from "./billing-outbox-observability";

describe("BillingUsageReconciliationService", () => {
  it("accepts provider-native facts without comparing provider credits to Zara seconds", () => {
    const service = new BillingUsageReconciliationService();
    expect(service.reconcileProviderUsageEvidence({
      expected: { standard_runtime_seconds: 60 },
      evidence: providerNativeEvidence("matched", []),
    })).toEqual([]);
  });

  it("returns a release-blocking mismatch for invalid provider-native facts", () => {
    const service = new BillingUsageReconciliationService();
    expect(service.reconcileProviderUsageEvidence({
      expected: { premium_runtime_seconds: 60 },
      evidence: providerNativeEvidence("mismatch", ["provider_facts_missing"]),
    })).toEqual([expect.objectContaining({
      mismatchClass: "provider_native_evidence_mismatch",
      severity: "critical",
    })]);
  });

  it("does not use Cartesia evidence to prove premium runtime", () => {
    const service = new BillingUsageReconciliationService();
    expect(service.reconcileProviderUsageEvidence({
      expected: { premium_runtime_seconds: 60 },
      evidence: providerNativeEvidence("matched", []),
    })).toEqual([expect.objectContaining({
      mismatchClass: "provider_native_evidence_mismatch",
      details: expect.objectContaining({ meterKeys: "premium_runtime_seconds" }),
    })]);
  });

  it("does not use OpenAI evidence to prove standard runtime", () => {
    const service = new BillingUsageReconciliationService();
    const evidence = providerNativeEvidence("matched", []);
    evidence.providerNative[0]!.provider = "openai";
    expect(service.reconcileProviderUsageEvidence({
      expected: { standard_runtime_seconds: 60 },
      evidence,
    })).toEqual([expect.objectContaining({
      mismatchClass: "provider_native_evidence_mismatch",
      details: expect.objectContaining({ providers: "cartesia" }),
    })]);
  });

  it("requires every direct provider report in trusted evidence to match", () => {
    const service = new BillingUsageReconciliationService();
    const evidence = providerNativeEvidence("matched", []);
    evidence.providerNative[0]!.provider = "openai";
    evidence.providerNative.push({
      ...evidence.providerNative[0]!, provider: "gemini", sourceReportId: "gemini-1",
      status: "mismatch", issues: ["provider_fact_scope_mismatch"],
    });
    expect(service.reconcileProviderUsageEvidence({
      expected: { premium_runtime_seconds: 60 }, evidence,
    })).toEqual([expect.objectContaining({
      mismatchClass: "provider_native_evidence_mismatch",
      details: expect.objectContaining({ providers: "gemini" }),
    })]);
  });

  it("requires every cycle-covered mapped premium provider", () => {
    const service = new BillingUsageReconciliationService();
    const evidence = providerNativeEvidence("matched", []);
    evidence.providerNative[0]!.provider = "openai";
    const scopedEvidence = { ...evidence, requiredNativeProviders: ["openai", "gemini"] };
    expect(service.reconcileProviderUsageEvidence({
      expected: { premium_runtime_seconds: 60 }, evidence: scopedEvidence,
    })).toEqual([expect.objectContaining({
      mismatchClass: "provider_native_evidence_mismatch",
      details: expect.objectContaining({ providers: "gemini" }),
    })]);
  });

  it("classifies missing, duplicate, late, and mismatched Polar usage by tenant cycle", () => {
    const observability = new BillingOutboxObservability();
    const service = new BillingUsageReconciliationService(observability);

    const report = service.reconcileCycle({
      organizationId: "tenant-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      zaraEvents: [
        usage("event-missing", 60),
        usage("event-duplicate", 30),
        usage("event-late", 20),
        usage("event-mismatch", 40),
      ],
      polarEvents: [
        polar("event-duplicate", 30, "2026-08-10T01:00:01.000Z"),
        polar("event-duplicate", 30, "2026-08-10T01:00:02.000Z"),
        polar("event-late", 20, "2026-09-02T00:00:00.000Z"),
        polar("event-mismatch", 41, "2026-08-10T01:00:01.000Z"),
      ],
    });

    expect(report).toEqual({
      organizationId: "tenant-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
      zaraQuantity: 150,
      polarQuantity: 121,
      missingExternalEventIds: ["event-missing"],
      duplicateExternalEventIds: ["event-duplicate"],
      lateExternalEventIds: ["event-late"],
      mismatches: [{ externalEventId: "event-mismatch", zaraQuantity: 40, polarQuantity: 41 }],
      status: "mismatch",
    });
    expect(observability.getSnapshot().reconciliation).toEqual({
      lateEvents: 1,
      mismatches: 4,
    });
    expect(observability.getSnapshot().alerts.lateUsage).toBe(1);
  });

  it("reconciles the single $5 PAYG grant against session debits and the Polar balance", () => {
    const service = new BillingUsageReconciliationService();

    expect(service.reconcilePaygBalance({
      organizationId: "tenant-payg",
      creditEntries: [
        { id: "grant-1", entryType: "grant", amountMinor: 500 },
        { id: "debit-call-1", entryType: "debit", amountMinor: 89 },
      ],
      polarBalanceMinor: 411,
    })).toEqual({
      organizationId: "tenant-payg",
      grantedMinor: 500,
      debitedMinor: 89,
      localBalanceMinor: 411,
      polarBalanceMinor: 411,
      differenceMinor: 0,
      status: "matched",
    });
  });

  it("removes an unused $5 grant from the balance after a refund reversal", () => {
    const service = new BillingUsageReconciliationService();

    expect(service.reconcilePaygBalance({
      organizationId: "tenant-payg-refund",
      creditEntries: [
        { id: "grant-1", entryType: "grant", amountMinor: 500 },
        { id: "reversal-1", entryType: "reversal", amountMinor: 500 },
      ],
      polarBalanceMinor: 0,
    })).toMatchObject({
      localBalanceMinor: 0,
      differenceMinor: 0,
      status: "matched",
    });
  });
});

function providerNativeEvidence(status: "matched" | "mismatch", issues: string[]) {
  return {
    evidenceId: "provider-1", sourceId: "provider-reports:cartesia",
    fetchedAt: "2026-09-01T01:00:00.000Z", organizationId: "tenant-a",
    catalogId: "catalog-1", cycleStartsAt: "2026-08-01T00:00:00.000Z",
    cycleEndsAt: "2026-09-01T00:00:00.000Z", quantities: {},
    providerNative: [{ provider: "cartesia", sourceReportId: "cartesia-1", status,
      factCount: status === "matched" ? 1 : 0, scopeId: "key-1",
      coverageStartsAt: "2026-08-01T00:00:00.000Z",
      coverageEndsAt: "2026-09-01T00:00:00.000Z", totals: { credits: 25 }, issues }],
    requiredNativeProviders: ["cartesia"],
  };
}

function usage(externalEventId: string, quantity: number) {
  return {
    externalEventId,
    meterKey: "standard_runtime_seconds",
    quantity,
    occurredAt: "2026-08-10T01:00:00.000Z",
  };
}

function polar(externalEventId: string, quantity: number, receivedAt: string) {
  return { externalEventId, quantity, receivedAt };
}
