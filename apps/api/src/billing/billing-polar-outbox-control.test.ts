import { describe, expect, it, vi } from "vitest";
import { BillingPolarOutboxWorker } from "./billing-polar-outbox.worker";

describe("billing delivery decision at the provider boundary", () => {
  it.each([false, true])("does not send when the owner decision changes after claim: %s", async (enabled) => {
    let checks = 0;
    const ingestUsageEvent = vi.fn(async () => ({ providerEventId: "event" }));
    const repository = {
      recoverStaleOutbox: vi.fn(async () => 0),
      claimDueOutbox: vi.fn(async () => [{
        id: "event", organizationId: "tenant", aggregateType: "billing_ledger_entry" as const,
        aggregateId: "entry", eventType: "polar.usage.report" as const, status: "processing" as const,
        attemptCount: 1, nextAttemptAt: "2026-09-27T12:00:00.000Z",
        createdAt: "2026-09-27T12:00:00.000Z", deliveryDecisionId: "enabled-1",
        payload: { externalEventId: "event", externalCustomerId: "tenant",
          ledgerEntryId: "entry", meterKey: "standard_runtime_seconds", quantity: 60,
          occurredAt: "2026-09-27T12:00:00.000Z", deliveryMode: "charge" },
      }]),
      markOutboxDelivered: vi.fn(async () => { throw new Error("Unexpected delivery write"); }),
      markOutboxFailed: vi.fn(async () => { throw new Error("Unexpected failure write"); }),
    };
    const worker = new BillingPolarOutboxWorker(repository, { ingestUsageEvent }, {
      deliveryEnabled: true, releaseId: "release", batchSize: 1, maxAttempts: 3, retryDelayMs: 1000,
    }, undefined, { assertDeliveryAllowed: async () => ++checks === 1
      ? { allowed: true, decisionId: "enabled-1" }
      : { allowed: enabled, decisionId: "enabled-2" } });

    expect(await worker.runOnce("2026-09-27T12:00:01.000Z")).toMatchObject({ delivered: 0, disabled: true });
    expect(ingestUsageEvent).not.toHaveBeenCalled();
    expect(repository.markOutboxDelivered).not.toHaveBeenCalled();
    expect(repository.markOutboxFailed).not.toHaveBeenCalled();
  });

  it("does not claim when the owner has not enabled delivery", async () => {
    const repository = {
      recoverStaleOutbox: vi.fn(async () => 0), claimDueOutbox: vi.fn(async () => []),
      markOutboxDelivered: vi.fn(async () => { throw new Error("Unexpected delivery write"); }),
      markOutboxFailed: vi.fn(async () => { throw new Error("Unexpected failure write"); }),
    };
    const worker = new BillingPolarOutboxWorker(repository, { ingestUsageEvent: vi.fn() }, {
      deliveryEnabled: true, releaseId: "release", batchSize: 1, maxAttempts: 3, retryDelayMs: 1000,
    }, undefined, { assertDeliveryAllowed: async () => ({ allowed: false }) });
    expect(await worker.runOnce("2026-09-27T12:00:01.000Z")).toMatchObject({ disabled: true });
    expect(repository.claimDueOutbox).not.toHaveBeenCalled();
  });
});
