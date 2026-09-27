import { afterEach, expect, it, vi } from "vitest";

import { openPolarCustomerPortal, startPaygCheckout, startPolarCheckout, watchTenantBillingState } from "./tenantBillingApi";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("refreshes billing after checkout when subscription events arrive after the invoice", async () => {
  vi.useFakeTimers();
  const onState = vi.fn();
  const onError = vi.fn();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ billing: { plan: null, invoices: [{ status: "paid" }] } })))
    .mockImplementation(async () => new Response(JSON.stringify({ billing: { plan: { status: "active" }, invoices: [{ status: "paid" }] } }))));
  const stop = watchTenantBillingState("tenant-new", { afterCheckout: true, onState, onError });
  await vi.advanceTimersByTimeAsync(2100);
  expect(onState.mock.calls.map(([state]) => state.plan?.status ?? "none")).toEqual(["none", "active"]);
  expect(onError).not.toHaveBeenCalled();
  stop();
});

it("opens the hosted PAYG checkout returned by the billing API", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4173", assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    checkout: { checkoutUrl: "https://sandbox.polar.sh/checkout/test-payg" },
  }), { status: 201 })));
  await startPaygCheckout("tenant-new");
  expect(assign).toHaveBeenCalledWith("https://sandbox.polar.sh/checkout/test-payg");
});

it("limits checkout refreshes and only loads once for an ordinary visit", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ billing: { plan: null } }))));
  const onState = vi.fn();
  const stop = watchTenantBillingState("tenant-new", { afterCheckout: true, onState, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(60000);
  expect(onState).toHaveBeenCalledTimes(16);
  stop();
  onState.mockClear();
  const stopOrdinary = watchTenantBillingState("tenant-new", { afterCheckout: false, onState, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(60000);
  expect(onState).toHaveBeenCalledTimes(1);
  stopOrdinary();
});

it("opens the hosted customer portal returned by the billing API", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4173", assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    portal: { customerPortalUrl: "https://sandbox.polar.sh/customer-portal/test" },
  }), { status: 201 })));
  await openPolarCustomerPortal("tenant-new");
  expect(assign).toHaveBeenCalledWith("https://sandbox.polar.sh/customer-portal/test");
});

it("does not overlap reads or publish a late response after leaving the tenant", async () => {
  vi.useFakeTimers();
  let resolveResponse!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const onState = vi.fn();
  const onError = vi.fn();
  const stop = watchTenantBillingState("tenant-old", { afterCheckout: true, onState, onError });
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
  stop();
  resolveResponse(new Response(JSON.stringify({ billing: { organizationId: "tenant-old" } })));
  await vi.advanceTimersByTimeAsync(10000);
  expect(onState).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("reports a failed refresh without inventing payment state or continuing requests", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => new Response(JSON.stringify({ message: "Session expired" }), { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const onState = vi.fn();
  const onError = vi.fn();
  const stop = watchTenantBillingState("tenant-new", { afterCheckout: true, onState, onError });
  await vi.advanceTimersByTimeAsync(60000);
  expect(onState).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Session expired", status: 401 }));
  expect(fetch).toHaveBeenCalledTimes(1);
  stop();
});

it("opens the hosted subscription checkout returned by the billing API", async () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4173", assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    checkout: { checkoutUrl: "https://sandbox.polar.sh/checkout/test-subscription" },
  }), { status: 201 })));

  await startPolarCheckout("tenant-new", "starter");

  expect(assign).toHaveBeenCalledWith("https://sandbox.polar.sh/checkout/test-subscription");
});
