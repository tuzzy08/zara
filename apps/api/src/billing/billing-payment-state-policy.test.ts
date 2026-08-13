import { describe, expect, it } from "vitest";

import {
  projectPolarSubscription,
  selectActiveSubscription,
} from "./billing-payment-state-policy";

describe("billing payment-state policy", () => {
  it("fails closed for an unknown Polar subscription state", () => {
    expect(projectPolarSubscription({
      providerSubscriptionId: "sub-unknown",
      providerStatus: "future_new_state",
      updatedAt: "2026-08-10T02:00:00.000Z",
      now: "2026-08-10T02:00:01.000Z",
    })).toEqual({
      providerSubscriptionId: "sub-unknown",
      status: "unknown",
      accessAllowed: false,
      updatedAt: "2026-08-10T02:00:00.000Z",
    });
  });

  it("selects one active subscription without restoring stale or past-due state", () => {
    expect(selectActiveSubscription([
      subscription("sub-stale-active", "active", "2026-08-01T00:00:00.000Z"),
      subscription("sub-current-canceled", "canceled", "2026-08-10T00:00:00.000Z"),
      subscription("sub-current-active", "active", "2026-08-09T00:00:00.000Z"),
      subscription("sub-past-due", "past_due", "2026-08-10T01:00:00.000Z"),
    ])).toEqual(expect.objectContaining({
      providerSubscriptionId: "sub-current-active",
      status: "active",
      accessAllowed: true,
    }));
  });

  it("allows past-due access only during an explicit grace period", () => {
    expect(projectPolarSubscription({
      providerSubscriptionId: "sub-grace",
      providerStatus: "past_due",
      graceEndsAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      now: "2026-08-11T00:00:00.000Z",
    }).accessAllowed).toBe(true);
    expect(projectPolarSubscription({
      providerSubscriptionId: "sub-expired",
      providerStatus: "past_due",
      graceEndsAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      now: "2026-08-11T00:00:00.000Z",
    }).accessAllowed).toBe(false);
  });
});

function subscription(
  providerSubscriptionId: string,
  providerStatus: string,
  updatedAt: string,
) {
  return projectPolarSubscription({
    providerSubscriptionId,
    providerStatus,
    updatedAt,
    now: "2026-08-11T00:00:00.000Z",
  });
}
