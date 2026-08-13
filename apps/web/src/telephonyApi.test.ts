import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPstnTestRouteViaApi,
  dispatchInboundTelephonyTestViaApi,
  dispatchOutboundTelephonyCallViaApi,
} from "./telephonyApi";

describe("telephony API requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs a protected PSTN test route request", async () => {
    const fetchMock = stubSuccessfulFetch();

    await createPstnTestRouteViaApi({
      organizationId: "tenant-west-africa",
      numberId: "number-support",
      publishedVersionId: "published-support-v4",
      workflowLabel: "Support",
      workspaceId: "workspace-default",
      runtimeProfile: "cost-optimized",
      allowedCallerNumbers: ["+233201110001"],
      expiresAt: "2026-07-30T18:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/telephony/numbers/number-support/pstn-test-route",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          publishedVersionId: "published-support-v4",
          workflowLabel: "Support",
          workspaceId: "workspace-default",
          runtimeProfile: "cost-optimized",
          allowedCallerNumbers: ["+233201110001"],
          expiresAt: "2026-07-30T18:00:00.000Z",
        }),
      }),
    );
  });

  it("constructs an inbound phone-test dispatch request", async () => {
    const fetchMock = stubSuccessfulFetch();

    await dispatchInboundTelephonyTestViaApi({
      organizationId: "tenant-west-africa",
      toPhoneNumber: "+14155557890",
      fromPhoneNumber: "+233201110001",
      callSid: "CA-phone-test-001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/telephony/dispatch/inbound",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          toPhoneNumber: "+14155557890",
          fromPhoneNumber: "+233201110001",
          callSid: "CA-phone-test-001",
        }),
      }),
    );
  });

  it("does not send client-supplied outbound billing evidence", async () => {
    const fetchMock = stubSuccessfulFetch();

    await dispatchOutboundTelephonyCallViaApi({
      organizationId: "tenant-west-africa",
      toPhoneNumber: "+14155550999",
      fromPhoneNumber: "+14155550110",
      callSid: "CA-outbound-001",
      publishedVersionId: "published-support-v4",
      workflowLabel: "Support",
      workspaceId: "workspace-default",
      consentGranted: true,
      budgetRemainingUsd: 999,
      estimatedCostUsd: 0,
      localHour: 11,
      callingWindow: { startHour: 8, endHour: 19 },
    } as Parameters<typeof dispatchOutboundTelephonyCallViaApi>[0]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/telephony/dispatch/outbound",
      expect.objectContaining({
        body: JSON.stringify({
          toPhoneNumber: "+14155550999",
          fromPhoneNumber: "+14155550110",
          callSid: "CA-outbound-001",
          publishedVersionId: "published-support-v4",
          workflowLabel: "Support",
          workspaceId: "workspace-default",
          consentGranted: true,
          localHour: 11,
          callingWindow: { startHour: 8, endHour: 19 },
        }),
      }),
    );
  });
});

function stubSuccessfulFetch() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ state: {}, dispatch: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
