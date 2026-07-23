import type { OpenAiRealtimeScenario } from "./openai-realtime-simulator";
import type { LoadScenarioName, LoadTenantMode } from "./load-profiles";
import type { LoadCallResult } from "./load-runner";
import { createCallFingerprint } from "./twilio-protocol";
import type { TwilioVirtualCallerInput, TwilioVirtualCallerResult } from "./twilio-virtual-caller";

export interface LoadTenantConfig {
  accountSid: string;
  authToken: string;
  from: string;
  webhookUrl: string;
  destinations: { default: string } & Partial<Record<LoadScenarioName, string>>;
}

interface LoadSimulator {
  setScenario(callId: string, scenario: OpenAiRealtimeScenario): void;
  waitForCallIdle(callId: string): Promise<void>;
  getRecords(callId: string): LoadSimulatorRecord[];
  releaseCall(callId: string): void;
}

interface LoadSimulatorRecord {
  direction: "inbound" | "outbound";
  eventType: string;
  agentId?: string | undefined;
  handoffTargetAgentId?: string | undefined;
}

interface LoadCaller {
  run(input: TwilioVirtualCallerInput): Promise<TwilioVirtualCallerResult>;
}

export class PstnProtocolLoadDriver {
  private readonly nowMs: () => number;

  constructor(private readonly options: {
    tenants: LoadTenantConfig[];
    simulator: LoadSimulator;
    caller: LoadCaller;
    callSidFactory(callIndex: number): string;
    nowMs?: (() => number) | undefined;
  }) {
    if (options.tenants.length === 0) throw new Error("PSTN load driver requires at least one tenant route.");
    this.nowMs = options.nowMs ?? Date.now;
  }

  async runCall(input: {
    scenario: LoadScenarioName;
    tenantMode: LoadTenantMode;
    callIndex: number;
    signal: AbortSignal;
  }): Promise<LoadCallResult> {
    const startedAt = this.nowMs();
    const tenant = this.selectTenant(input.tenantMode, input.callIndex);
    const destination = tenant.destinations[input.scenario] ?? tenant.destinations.default;
    const scenario = scenarioFor(input.scenario);
    let callSessionId: string | undefined;
    try {
      const callerResult = await this.options.caller.run({
        accountSid: tenant.accountSid,
        authToken: tenant.authToken,
        callSid: this.options.callSidFactory(input.callIndex),
        from: tenant.from,
        to: destination,
        webhookUrl: tenant.webhookUrl,
        durationMs: scenario.caller.durationMs,
        ...(scenario.caller.callerTurns === undefined ? {} : { callerTurns: scenario.caller.callerTurns }),
        ...(scenario.caller.markAckLatencyMs === undefined
          ? {}
          : { markAckLatencyMs: scenario.caller.markAckLatencyMs }),
        ...(scenario.caller.interruptionAtMs === undefined
          ? {}
          : { interruptionAtMs: scenario.caller.interruptionAtMs }),
        ...(scenario.requireRemoteClose ? { requireRemoteClose: true } : {}),
        ...(input.scenario === "cross-provider-handoff" ? { quiescenceMs: 2_500 } : {}),
        signal: input.signal,
        ...(input.scenario === "cross-provider-handoff" ? {} : {
          completionProbe: () => callSessionId !== undefined
            && isScenarioTerminal(input.scenario, this.options.simulator.getRecords(callSessionId)),
        }),
        beforeConnect: ({ callSessionId: id }) => {
          callSessionId = id;
          this.options.simulator.setScenario(id, {
            callFingerprint: createCallFingerprint(id),
            responseMode: scenario.responseMode,
            timing: scenario.timing,
          });
        },
      });
      await this.options.simulator.waitForCallIdle(callerResult.callSessionId);
      const records = this.options.simulator.getRecords(callerResult.callSessionId);
      const behaviorPassed = validateScenario(input.scenario, callerResult, records);
      return {
        scenario: input.scenario,
        outcome: behaviorPassed ? "passed" : "failed",
        durationMs: callerResult.totalDurationMs ?? Math.max(0, this.nowMs() - startedAt),
        webhookLatencyMs: callerResult.webhookLatencyMs,
        mediaConnectLatencyMs: callerResult.mediaConnectLatencyMs,
        firstAudioLatencyMs: callerResult.firstOutboundAudioLatencyMs,
        inboundFrameCount: callerResult.inboundFrameCount,
        outboundFrameCount: callerResult.outboundFrameCount,
        identityIsolated: callerResult.outboundFingerprintMatched,
        ...(behaviorPassed ? {} : { failureCode: "scenario_contract_failed" }),
      };
    } catch {
      return {
        scenario: input.scenario,
        outcome: input.signal.aborted ? "aborted" : "failed",
        durationMs: Math.max(0, this.nowMs() - startedAt),
        inboundFrameCount: 0,
        outboundFrameCount: 0,
        identityIsolated: true,
        failureCode: input.signal.aborted ? "resource_exhausted" : "call_failure",
      };
    } finally {
      if (callSessionId !== undefined) {
        try {
          await this.options.simulator.waitForCallIdle(callSessionId);
          this.options.simulator.releaseCall(callSessionId);
        } catch {
          // The runner reports the call failure; cleanup must not expose provider details.
        }
      }
    }
  }

  private selectTenant(mode: LoadTenantMode, callIndex: number) {
    if (mode === "same-tenant") return this.options.tenants[0]!;
    if (this.options.tenants.length < 2) {
      throw new Error("Cross-tenant PSTN load requires at least two tenant routes.");
    }
    return this.options.tenants[callIndex % this.options.tenants.length]!;
  }
}

function scenarioFor(name: LoadScenarioName): {
  responseMode: OpenAiRealtimeScenario["responseMode"];
  timing: OpenAiRealtimeScenario["timing"];
  requireRemoteClose: boolean;
  caller: Pick<TwilioVirtualCallerInput, "durationMs" | "callerTurns" | "markAckLatencyMs" | "interruptionAtMs">;
} {
  const defaults = {
    responseMode: "normal" as const,
    timing: { mode: "immediate" } as const,
    requireRemoteClose: false,
    caller: { durationMs: 400, callerTurns: [{ durationMs: 400 }] },
  };
  if (name === "delayed-provider-readiness") {
    return { ...defaults, timing: { mode: "delayed", delayMs: 500 } };
  }
  if (name === "twilio-marks") {
    return { ...defaults, caller: { ...defaults.caller, markAckLatencyMs: 120 } };
  }
  if (name === "interruption-clear") {
    return { ...defaults, caller: { durationMs: 1_600, interruptionAtMs: 120 } };
  }
  if (name === "tool-call") return { ...defaults, responseMode: "tool" };
  if (name === "same-provider-handoff" || name === "cross-provider-handoff") {
    return { ...defaults, responseMode: "handoff", caller: {
      durationMs: 400,
      callerTurns: [{ durationMs: 400, silenceAfterMs: 500 }, { durationMs: 400 }],
    } };
  }
  if (name === "long-audio-output") return { ...defaults, responseMode: "output_pressure" };
  if (name === "provider-quota-error") return { ...defaults, responseMode: "rate_limit" };
  if (name === "provider-closure") {
    return { ...defaults, responseMode: "provider_close", requireRemoteClose: true };
  }
  return defaults;
}

function validateScenario(
  name: LoadScenarioName,
  result: TwilioVirtualCallerResult,
  records: LoadSimulatorRecord[],
) {
  if (result.inboundFrameCount === 0 || !result.outboundFingerprintMatched) return false;
  if (name === "provider-quota-error") return hasEvent(records, "error", "outbound");
  if (name === "provider-closure") {
    return result.closeMode === "remote" && hasEvent(records, "connection.closed", "inbound");
  }
  if (name === "interruption-clear") return result.clearCount > 0;
  if (name === "twilio-marks") return result.markAcknowledgements > 0;
  if (name === "tool-call") {
    return countEvent(records, "response.done", "outbound") >= 2
      && hasEvent(records, "conversation.item.create", "inbound");
  }
  if (name === "cross-provider-handoff") {
    const firstTurnFrames = result.outboundFrameCountAfterTurns[0];
    const finalTurnFrames = result.outboundFrameCountAfterTurns.at(-1);
    return firstTurnFrames !== undefined
      && finalTurnFrames !== undefined
      && finalTurnFrames > firstTurnFrames
      && records.some((record) => record.handoffTargetAgentId !== undefined);
  }
  if (name === "same-provider-handoff") {
    const target = records.find((record) => record.handoffTargetAgentId !== undefined)?.handoffTargetAgentId;
    return target !== undefined
      && records.filter((record) => record.eventType === "connection.opened").length >= 2
      && records.some((record) => record.eventType === "connection.opened" && record.agentId === target)
      && records.some((record) =>
        record.eventType === "response.done"
        && record.direction === "outbound"
        && record.agentId === target);
  }
  return result.outboundFrameCount > 0 && hasEvent(records, "response.done", "outbound");
}

function isScenarioTerminal(name: LoadScenarioName, records: LoadSimulatorRecord[]) {
  if (name === "provider-quota-error") return hasEvent(records, "error", "outbound");
  if (name === "provider-closure") return hasEvent(records, "connection.closed", "inbound");
  if (name === "tool-call") {
    return countEvent(records, "response.done", "outbound") >= 2
      && hasEvent(records, "conversation.item.create", "inbound");
  }
  if (name === "same-provider-handoff") {
    return records.filter((record) => record.eventType === "connection.opened").length >= 2
      && hasEvent(records, "response.done", "outbound");
  }
  return hasEvent(records, "response.done", "outbound");
}

function hasEvent(records: LoadSimulatorRecord[], eventType: string, direction: LoadSimulatorRecord["direction"]) {
  return records.some((record) => record.eventType === eventType && record.direction === direction);
}

function countEvent(records: LoadSimulatorRecord[], eventType: string, direction: LoadSimulatorRecord["direction"]) {
  return records.filter((record) => record.eventType === eventType && record.direction === direction).length;
}
