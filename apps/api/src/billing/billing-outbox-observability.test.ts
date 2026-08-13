import { describe, expect, it } from "vitest";

import { BillingOutboxObservability } from "./billing-outbox-observability";

describe("BillingOutboxObservability", () => {
  it("reports low-cardinality delivery and reconciliation metrics with alerts", () => {
    const observability = new BillingOutboxObservability();

    observability.recordDelivery("delivered");
    observability.recordDelivery("dead_lettered");
    observability.recordReconciliation({ lateCount: 2, mismatchCount: 1 });

    expect(observability.getSnapshot()).toEqual({
      deliveries: { delivered: 1, retried: 0, deadLettered: 1 },
      reconciliation: { lateEvents: 2, mismatches: 1 },
      alerts: { deadLetter: 1, lateUsage: 1 },
    });
  });
});
