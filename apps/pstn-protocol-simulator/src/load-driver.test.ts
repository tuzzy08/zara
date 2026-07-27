import { describe, expect, it, vi } from "vitest";

import { PstnProtocolLoadDriver } from "./load-driver";
import type { TwilioVirtualCallerInput, TwilioVirtualCallerResult } from "./twilio-virtual-caller";

interface TestSimulatorRecord {
  direction: "inbound" | "outbound";
  eventType: string;
  agentId?: string;
  handoffTargetAgentId?: string;
}

describe("PstnProtocolLoadDriver", () => {
  it("maps load scenarios to simulator behavior and scenario-specific routes", async () => {
    const simulator = createSimulator();
    const caller = createCaller();
    const driver = new PstnProtocolLoadDriver({
      tenants: [{
        accountSid: "AC-one",
        authToken: "secret-one",
        from: "+15550001111",
        webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
        destinations: {
          default: "+15550002222",
          "cross-provider-handoff": "+15550003333",
        },
      }],
      simulator,
      caller,
      callSidFactory: (index) => `CA-${index}`,
      nowMs: (() => {
        let now = 0;
        return () => now += 25;
      })(),
    });

    const result = await driver.runCall({
      scenario: "cross-provider-handoff",
      tenantMode: "same-tenant",
      callIndex: 7,
      signal: new AbortController().signal,
    });

    expect(caller.run).toHaveBeenCalledWith(expect.objectContaining({
      accountSid: "AC-one",
      to: "+15550003333",
      callSid: "CA-7",
    }));
    expect(simulator.setScenario).toHaveBeenCalledWith("session-7", expect.objectContaining({
      responseMode: "handoff",
    }));
    expect(result).toMatchObject({
      scenario: "cross-provider-handoff",
      outcome: "passed",
      identityIsolated: true,
      inboundFrameCount: 20,
      outboundFrameCount: 20,
    });
  });

  it("rotates tenant credentials only for cross-tenant stages", async () => {
    const caller = createCaller();
    const driver = new PstnProtocolLoadDriver({
      tenants: [tenant("AC-one", "+15550001111"), tenant("AC-two", "+15550004444")],
      simulator: createSimulator(),
      caller,
      callSidFactory: (index) => `CA-${index}`,
    });

    await driver.runCall({
      scenario: "normal",
      tenantMode: "same-tenant",
      callIndex: 1,
      signal: new AbortController().signal,
    });
    await driver.runCall({
      scenario: "normal",
      tenantMode: "cross-tenant",
      callIndex: 1,
      signal: new AbortController().signal,
    });

    expect(caller.run.mock.calls.map(([input]) => input.accountSid)).toEqual(["AC-one", "AC-two"]);
  });

  it("classifies expected quota and provider-close behavior as successful failure scenarios", async () => {
    const simulator = createSimulator();
    const caller = createCaller({ outboundFrameCount: 0, closeMode: "remote", remoteCloseCode: 1011 });
    const driver = new PstnProtocolLoadDriver({
      tenants: [tenant("AC-one", "+15550001111")],
      simulator,
      caller,
      callSidFactory: (index) => `CA-${index}`,
    });

    for (const scenario of ["provider-quota-error", "provider-closure"] as const) {
      await expect(driver.runCall({
        scenario,
        tenantMode: "same-tenant",
        callIndex: 1,
        signal: new AbortController().signal,
      })).resolves.toMatchObject({ outcome: "passed", inboundFrameCount: 20 });
    }
  });

  it("does not count a tool request as complete until Zara returns tool output and continues", async () => {
    const simulator = createSimulator();
    simulator.getRecords.mockReturnValue([
      { direction: "outbound" as const, eventType: "response.done" },
    ]);
    const driver = new PstnProtocolLoadDriver({
      tenants: [tenant("AC-one", "+15550001111")],
      simulator,
      caller: createCaller(),
      callSidFactory: (index) => `CA-${index}`,
    });

    await expect(driver.runCall({
      scenario: "tool-call",
      tenantMode: "same-tenant",
      callIndex: 1,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ outcome: "failed", failureCode: "scenario_contract_failed" });
  });

  it("accepts cross-provider continuation from caller media without requiring Gemini on the OpenAI simulator", async () => {
    const simulator = createSimulator();
    simulator.getRecords.mockReturnValue([
      {
        direction: "outbound" as const,
        eventType: "response.done",
        handoffTargetAgentId: "gemini-specialist",
      },
    ]);
    const driver = new PstnProtocolLoadDriver({
      tenants: [tenant("AC-one", "+15550001111")],
      simulator,
      caller: createCaller(),
      callSidFactory: (index) => `CA-${index}`,
    });

    await expect(driver.runCall({
      scenario: "cross-provider-handoff",
      tenantMode: "same-tenant",
      callIndex: 1,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ outcome: "passed", outboundFrameCount: 20 });
  });

  it("requires specialist output after the handoff boundary", async () => {
    const simulator = createSimulator();
    simulator.getRecords.mockReturnValue([
      { direction: "inbound" as const, eventType: "connection.opened", agentId: "source" },
      {
        direction: "outbound" as const,
        eventType: "response.done",
        agentId: "source",
        handoffTargetAgentId: "target",
      },
      { direction: "inbound" as const, eventType: "connection.opened", agentId: "target" },
    ]);
    const sameProvider = new PstnProtocolLoadDriver({
      tenants: [tenant("AC-one", "+15550001111")],
      simulator,
      caller: createCaller(),
      callSidFactory: (index) => `CA-${index}`,
    });
    await expect(sameProvider.runCall({
      scenario: "same-provider-handoff",
      tenantMode: "same-tenant",
      callIndex: 1,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ outcome: "failed" });

    const crossProvider = new PstnProtocolLoadDriver({
      tenants: [tenant("AC-one", "+15550001111")],
      simulator: createSimulator(),
      caller: createCaller({ outboundFrameCountAfterTurns: [20, 20] }),
      callSidFactory: (index) => `CA-${index}`,
    });
    await expect(crossProvider.runCall({
      scenario: "cross-provider-handoff",
      tenantMode: "same-tenant",
      callIndex: 1,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ outcome: "failed" });
  });
});

function tenant(accountSid: string, from: string) {
  return {
    accountSid,
    authToken: `${accountSid}-secret`,
    from,
    webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
    destinations: { default: "+15550002222" },
  };
}

function createCaller(overrides: Partial<TwilioVirtualCallerResult> = {}) {
  return {
    run: vi.fn(async (input: TwilioVirtualCallerInput): Promise<TwilioVirtualCallerResult> => {
      await input.beforeConnect?.({
        callSessionId: `session-${input.callSid.replace("CA-", "")}`,
        callFingerprint: "fingerprint",
      });
      return {
        callSid: input.callSid,
        callSessionId: `session-${input.callSid.replace("CA-", "")}`,
        inboundFrameCount: 20,
        outboundFrameCount: 20,
        outboundFingerprintMatched: true,
        markAcknowledgements: 1,
        clearCount: 1,
        closeMode: "stop",
        webhookLatencyMs: 10,
        mediaConnectLatencyMs: 20,
        firstOutboundAudioLatencyMs: 50,
        totalDurationMs: 100,
        outboundFrameCountAfterTurns: [10, 20],
        ...overrides,
      };
    }),
  };
}

function createSimulator() {
  let activeScenario = "normal";
  return {
    setScenario: vi.fn((_callId: string, scenario: { responseMode: string }) => {
      activeScenario = scenario.responseMode;
    }),
    waitForCallIdle: vi.fn(async () => undefined),
    releaseCall: vi.fn(),
    getRecords: vi.fn((): TestSimulatorRecord[] => {
      if (activeScenario === "rate_limit") return [{ direction: "outbound" as const, eventType: "error" }];
      if (activeScenario === "provider_close") {
        return [{ direction: "inbound" as const, eventType: "connection.closed" }];
      }
      if (activeScenario === "handoff") {
        return [
          { direction: "inbound" as const, eventType: "connection.opened", agentId: "source" },
          {
            direction: "outbound" as const,
            eventType: "response.done",
            agentId: "source",
            handoffTargetAgentId: "target",
          },
          { direction: "inbound" as const, eventType: "connection.opened", agentId: "target" },
          { direction: "outbound" as const, eventType: "response.done", agentId: "target" },
        ];
      }
      return [{ direction: "outbound" as const, eventType: "response.done" }];
    }),
  };
}
