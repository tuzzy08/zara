import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPstnTestRouteViaApi,
  dispatchInboundTelephonyTestViaApi,
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
