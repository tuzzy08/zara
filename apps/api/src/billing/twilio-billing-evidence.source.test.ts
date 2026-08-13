import { describe, expect, it, vi } from "vitest";

import { TelephonySecretVault } from "../telephony/telephony-secret-vault";
import { TwilioBillingEvidenceSource } from "./twilio-billing-evidence.source";

const cycle = {
  organizationId: "tenant-a",
  catalogId: "catalog-a",
  cycleStartsAt: "2026-08-01T00:00:00.000Z",
  cycleEndsAt: "2026-09-01T00:00:00.000Z",
};

function fixture() {
  const vault = new TelephonySecretVault({ masterSecret: "test-master-secret", keyVersion: 1 });
  const state = {
    schemaVersion: 1 as const,
    organizationId: "tenant-a",
    connections: [{
      id: "connection-a",
      tenantId: "tenant-a",
      provider: "twilio",
      ownershipMode: "platform_managed",
      externalReference: "AC-account-a",
    }],
    phoneNumbers: [{
      id: "number-a",
      tenantId: "tenant-a",
      connectionId: "connection-a",
      provider: "twilio",
      phoneNumber: "+14155550100",
    }],
    executionSessions: [{
      tenantId: "tenant-a",
      connectionId: "connection-a",
      callSessionId: "CA-call-a:telephony",
      provider: "twilio",
      ownershipMode: "platform_managed",
      direction: "outbound",
      testCall: false,
      createdAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:02:00.000Z",
    }],
    credentials: [{
      connectionId: "connection-a",
      envelope: vault.seal({ authToken: "twilio-auth-token" }),
    }],
  };
  const states = { load: vi.fn().mockResolvedValue(state) };
  const catalogs = { getPriceCatalog: vi.fn().mockResolvedValue({
    id: "catalog-a",
    document: { telephonyRoutes: {
      "twilio-outbound": {
        provider: "twilio",
        direction: "outbound",
        currency: "usd",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        customerRateMinorPerMinute: 35,
        rounding: "next_full_minute",
      },
    } },
  }) };
  const calls = { listCalls: vi.fn().mockImplementation(async (input: { direction: string }) =>
    input.direction === "inbound" ? [] : [{
    sid: "CA-call-a",
    accountSid: "AC-account-a",
    status: "completed",
    direction: "outbound-api",
    durationSeconds: 61,
    price: "-0.024",
    priceUnit: "USD",
    startedAt: "2026-08-12T09:00:10.000Z",
    endedAt: "2026-08-12T09:01:11.000Z",
  }]) };
  return { source: new TwilioBillingEvidenceSource(states, vault, catalogs, calls), states, catalogs, calls };
}

describe("Twilio billing evidence source", () => {
  it("collects tenant-cycle Twilio call duration and cost through linked CallSid records", async () => {
    const { source, calls } = fixture();

    await expect(source.collectCycle(cycle)).resolves.toEqual({
      provider: "twilio",
      evidenceKind: "telephony_usage",
      sourceReportId: "twilio-calls:1022e91aa1d46fef59fc51c51c255d30da5defcb33500241156dff3caade804d",
      payload: {
        quantities: { platform_telephony_charge_minor: 70 },
        facts: [{
          id: "CA-call-a",
          callSid: "CA-call-a",
          connectionId: "connection-a",
          durationSeconds: 61,
          supplierCostMinor: 3,
          price: "-0.024",
          priceUnit: "USD",
          startedAt: "2026-08-12T09:00:10.000Z",
          endedAt: "2026-08-12T09:01:11.000Z",
          customerChargeMinor: 70,
          routeRateId: "twilio-outbound",
        }],
      },
    });
    expect(calls.listCalls).toHaveBeenCalledWith({
      accountSid: "AC-account-a",
      authToken: "twilio-auth-token",
      cycleStartsAt: cycle.cycleStartsAt,
      cycleEndsAt: cycle.cycleEndsAt,
      direction: "outbound",
      phoneNumber: "+14155550100",
    });
  });

  it.each([
    ["missing duration", { durationSeconds: undefined }],
    ["missing price", { price: null }],
    ["positive provider price", { price: "0.024" }],
    ["wrong currency", { priceUnit: "NGN" }],
    ["wrong account", { accountSid: "AC-other" }],
    ["wrong direction", { direction: "inbound" }],
    ["out-of-cycle time", { startedAt: "2026-09-02T09:00:10.000Z" }],
  ])("fails closed for %s", async (_label, changed) => {
    const { source, calls } = fixture();
    calls.listCalls.mockImplementation(async (input: { direction: string }) => input.direction === "inbound" ? [] : [{
      sid: "CA-call-a", accountSid: "AC-account-a", status: "completed",
      direction: "outbound-api", durationSeconds: 61, price: "-0.024", priceUnit: "USD",
      startedAt: "2026-08-12T09:00:10.000Z", endedAt: "2026-08-12T09:01:11.000Z",
      ...changed,
    }]);

    await expect(source.collectCycle(cycle)).rejects.toThrow(/Twilio billing evidence/);
  });

  it("fails closed when Twilio lists a call that has no tenant session", async () => {
    const { source, calls } = fixture();
    calls.listCalls.mockImplementation(async (input: { direction: string }) => input.direction === "inbound" ? [] : [
      {
        sid: "CA-call-a", accountSid: "AC-account-a", status: "completed",
        direction: "outbound-api", durationSeconds: 61, price: "-0.024", priceUnit: "USD",
        startedAt: "2026-08-12T09:00:10.000Z", endedAt: "2026-08-12T09:01:11.000Z",
      },
      {
        sid: "CA-provider-extra", accountSid: "AC-account-a", status: "completed",
        direction: "outbound-api", durationSeconds: 10, price: "-0.01", priceUnit: "USD",
        startedAt: "2026-08-12T10:00:10.000Z", endedAt: "2026-08-12T10:00:20.000Z",
      },
    ]);

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "Twilio billing evidence provider call CA-provider-extra has no linked tenant session.",
    );
  });

  it("fails closed when a tenant session is absent from the Twilio cycle list", async () => {
    const { source, calls } = fixture();
    calls.listCalls.mockResolvedValue([]);

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "Twilio billing evidence tenant call CA-call-a is missing from the provider cycle.",
    );
  });

  it("uses a fixed-length source report ID for a large provider cycle", async () => {
    const { source, states, calls } = fixture();
    const state = await states.load("tenant-a");
    const sessions = Array.from({ length: 200 }, (_, index) => ({
      ...state.executionSessions[0],
      callSessionId: `CA-call-${index}:telephony`,
    }));
    states.load.mockResolvedValue({ ...state, executionSessions: sessions });
    calls.listCalls.mockImplementation(async (input: { direction: string }) => input.direction === "inbound" ? [] : sessions.map((session, index) => ({
      sid: session.callSessionId.replace(":telephony", ""),
      accountSid: "AC-account-a", status: "completed", direction: "outbound-api",
      durationSeconds: 1, price: "-0.001", priceUnit: "USD",
      startedAt: `2026-08-12T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
      endedAt: `2026-08-12T09:${String(index % 60).padStart(2, "0")}:01.000Z`,
    })));

    const report = await source.collectCycle(cycle);
    expect(report?.sourceReportId).toMatch(/^twilio-calls:[a-f0-9]{64}$/);
    expect(report?.sourceReportId).toHaveLength(77);
  });

  it("scopes a shared account to tenant-owned phone numbers", async () => {
    const { source, calls } = fixture();

    await source.collectCycle(cycle);

    expect(calls.listCalls).toHaveBeenCalledWith(expect.objectContaining({
      direction: "inbound",
      phoneNumber: "+14155550100",
    }));
    expect(calls.listCalls).toHaveBeenCalledWith(expect.objectContaining({
      direction: "outbound",
      phoneNumber: "+14155550100",
    }));
    expect(calls.listCalls).not.toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: "+14155550999",
    }));
  });

  it("fails closed when a platform connection has no tenant-owned phone number", async () => {
    const { source, states } = fixture();
    const state = await states.load("tenant-a");
    states.load.mockResolvedValue({ ...state, phoneNumbers: [] });

    await expect(source.collectCycle(cycle)).rejects.toThrow(
      "Twilio billing evidence connection connection-a has no tenant-owned phone number.",
    );
  });

  it("discards day-filter boundary calls outside the exact cycle before reconciliation", async () => {
    const { source, calls } = fixture();
    calls.listCalls.mockImplementation(async (input: { direction: string }) => input.direction === "inbound" ? [] : [
      {
        sid: "CA-before-cycle", accountSid: "AC-account-a", status: "completed",
        direction: "outbound-api", durationSeconds: 20, price: "-0.01", priceUnit: "USD",
        startedAt: "2026-07-31T23:59:59.000Z", endedAt: "2026-08-01T00:00:19.000Z",
      },
      {
        sid: "CA-call-a", accountSid: "AC-account-a", status: "completed",
        direction: "outbound-api", durationSeconds: 61, price: "-0.024", priceUnit: "USD",
        startedAt: "2026-08-12T09:00:10.000Z", endedAt: "2026-08-12T09:01:11.000Z",
      },
      {
        sid: "CA-at-cycle-end", accountSid: "AC-account-a", status: "completed",
        direction: "outbound-api", durationSeconds: 20, price: "-0.01", priceUnit: "USD",
        startedAt: "2026-09-01T00:00:00.000Z", endedAt: "2026-09-01T00:00:20.000Z",
      },
    ]);

    const report = await source.collectCycle(cycle);

    expect(report?.payload.facts).toEqual([expect.objectContaining({ id: "CA-call-a" })]);
    expect(report?.payload.quantities).toEqual({ platform_telephony_charge_minor: 70 });
  });
});
