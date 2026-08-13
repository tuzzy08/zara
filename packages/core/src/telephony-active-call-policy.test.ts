import { describe, expect, it } from "vitest";

import {
  applyTelephonyActiveCallPolicy,
  createTelephonyConnection,
  createTelephonyExecutionSession,
  defaultRecordingPolicy,
} from "./telephony";

function createActiveSession() {
  const connection = createTelephonyConnection({
    id: "connection-platform",
    tenantId: "tenant-west-africa",
    label: "Zara Edge West",
    ownershipMode: "platform_managed",
    provider: "twilio",
    region: "eu-west-1",
    createdBy: "user-ops-lead",
    recordingPolicy: defaultRecordingPolicy(),
    blockRoutingOnHealthFailure: true,
  });

  return createTelephonyExecutionSession({
    tenantId: "tenant-west-africa",
    dispatchId: "dispatch-payg-policy",
    connection,
    direction: "inbound",
    disposition: "routed",
    toPhoneNumber: "+14155550110",
    fromPhoneNumber: "+233201110001",
    callSessionId: "CA-payg-policy:telephony",
    testCall: false,
    now: "2026-08-11T10:00:00.000Z",
  });
}

describe("applyTelephonyActiveCallPolicy", () => {
  it("closes after the current turn when durable PAYG credit cannot fund the next safe segment", () => {
    const result = applyTelephonyActiveCallPolicy({
      session: createActiveSession(),
      now: "2026-08-11T10:05:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
        billingAccessMode: "payg",
        paygNextSafeSegment: "unfunded",
      },
    });

    expect(result).toMatchObject({
      status: "closeout-pending",
      policyState: {
        state: "payg_closeout_after_turn",
      },
    });
  });

  it("fails closed when a PAYG call has no durable next-segment posture", () => {
    const result = applyTelephonyActiveCallPolicy({
      session: createActiveSession(),
      now: "2026-08-11T10:05:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
        billingAccessMode: "payg",
      },
    });

    expect(result).toMatchObject({
      status: "closeout-pending",
      policyState: {
        state: "payg_closeout_after_turn",
      },
    });
  });

  it("uses the explicit safe-closeout action for a provider failure", () => {
    const result = applyTelephonyActiveCallPolicy({
      session: createActiveSession(),
      now: "2026-08-11T10:05:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
        providerState: "failed",
        providerFailureAction: "safe_closeout",
      },
    });

    expect(result).toMatchObject({
      status: "closeout-pending",
      policyState: {
        state: "provider_failure_closeout_after_turn",
      },
    });
  });

  it("uses the explicit termination action for a provider failure", () => {
    const result = applyTelephonyActiveCallPolicy({
      session: createActiveSession(),
      now: "2026-08-11T10:05:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
        providerState: "failed",
        providerFailureAction: "terminate",
      },
    });

    expect(result).toMatchObject({
      status: "terminated",
      policyState: {
        state: "terminated_for_provider_failure",
      },
    });
  });

  it("terminates when a provider failure has no explicit action", () => {
    const result = applyTelephonyActiveCallPolicy({
      session: createActiveSession(),
      now: "2026-08-11T10:05:00.000Z",
      policy: {
        subscriptionStatus: "active",
        tenantStatus: "active",
        budgetAction: "allow",
        providerState: "failed",
      },
    });

    expect(result).toMatchObject({
      status: "terminated",
      policyState: {
        state: "terminated_for_provider_failure",
        reason: "Provider failure has no explicit closeout action; terminate to fail closed.",
      },
    });
  });
});
