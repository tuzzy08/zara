import { randomUUID } from "node:crypto";

import { OpenAiRealtimeProtocolSimulator } from "./openai-realtime-server";
import type { OpenAiRealtimeResponseMode } from "./openai-realtime-simulator";
import { formatSmokeFailure } from "./smoke-output";
import { createSmokeCallSid } from "./smoke-identities";
import { createCallFingerprint } from "./twilio-protocol";
import { TwilioVirtualCaller } from "./twilio-virtual-caller";

interface SmokeScenario {
  name: string;
  responseMode: OpenAiRealtimeResponseMode;
  caller: {
    durationMs: number;
    callerTurns?: Array<{ durationMs: number; silenceAfterMs?: number }>;
    markAckLatencyMs?: number;
    loseMarks?: boolean;
    interruptionAtMs?: number;
    duplicateMediaStream?: boolean;
    simultaneousDuplicateMediaStream?: boolean;
  };
}

const scenarios: SmokeScenario[] = [
  {
    name: "normal",
    responseMode: "normal",
    caller: {
      durationMs: 400,
      interruptionAtMs: 800,
      callerTurns: [{ durationMs: 400, silenceAfterMs: 300 }, { durationMs: 400 }],
    },
  },
  {
    name: "interrupted",
    responseMode: "normal",
    caller: { durationMs: 1_600, interruptionAtMs: 120, markAckLatencyMs: 80 },
  },
  {
    name: "duplicate-media",
    responseMode: "normal",
    caller: {
      durationMs: 400,
      interruptionAtMs: 800,
      callerTurns: [{ durationMs: 400, silenceAfterMs: 300 }, { durationMs: 400 }],
      duplicateMediaStream: true,
    },
  },
  {
    name: "simultaneous-duplicate-media",
    responseMode: "normal",
    caller: {
      durationMs: 400,
      interruptionAtMs: 800,
      callerTurns: [{ durationMs: 400, silenceAfterMs: 300 }, { durationMs: 400 }],
      simultaneousDuplicateMediaStream: true,
    },
  },
  {
    name: "tool-handoff",
    responseMode: "handoff",
    caller: {
      durationMs: 400,
      interruptionAtMs: 800,
      callerTurns: [{ durationMs: 400, silenceAfterMs: 500 }, { durationMs: 400 }],
    },
  },
  { name: "provider-failure", responseMode: "rate_limit", caller: { durationMs: 500, interruptionAtMs: 800 } },
];

async function main() {
  const config = readConfig(process.env);
  const simulator = new OpenAiRealtimeProtocolSimulator();
  const endpoint = await simulator.start({ host: config.simulatorHost, port: config.simulatorPort });
  const caller = new TwilioVirtualCaller();
  const summaries: Array<Record<string, unknown>> = [];
  const runId = randomUUID();

  try {
    for (const [index, scenario] of scenarios.entries()) {
      const callSid = createSmokeCallSid(runId, scenario.name, index);
      let activeCallSessionId: string | undefined;
      const scenarioComplete = () => activeCallSessionId !== undefined
        && isScenarioTerminal(scenario, simulator.getRecords(activeCallSessionId));
      const result = await caller.run({
        accountSid: config.accountSid,
        authToken: config.authToken,
        callSid,
        from: config.from,
        to: config.to,
        webhookUrl: config.webhookUrl,
        ...scenario.caller,
        completionProbe: scenarioComplete,
        requireRemoteClose: scenario.name === "provider-failure",
        beforeConnect: ({ callSessionId }) => {
          activeCallSessionId = callSessionId;
          simulator.setScenario(callSessionId, {
            callFingerprint: createCallFingerprint(callSessionId),
            responseMode: scenario.responseMode,
            timing: { mode: scenario.name === "interrupted" ? "delayed" : "immediate", delayMs: 40 },
          });
        },
      });
      await simulator.waitForCallIdle(result.callSessionId);
      const records = simulator.getRecords(result.callSessionId);
      validateScenario(scenario, result, records);
      summaries.push({
        scenario: scenario.name,
        outcome: "passed",
        inboundFrames: result.inboundFrameCount,
        outboundFrames: result.outboundFrameCount,
        marksAcknowledged: result.markAcknowledgements,
        clears: result.clearCount,
        providerEvents: records.filter((record) => record.direction === "outbound").length,
      });
      simulator.releaseCall(result.callSessionId);
    }
  } finally {
    await simulator.stop();
  }

  process.stdout.write(`${JSON.stringify({
    outcome: "passed",
    simulatorEndpoint: redactEndpoint(endpoint),
    scenarios: summaries,
  }, null, 2)}\n`);
}

function validateScenario(
  scenario: SmokeScenario,
  result: Awaited<ReturnType<TwilioVirtualCaller["run"]>>,
  records: ReturnType<OpenAiRealtimeProtocolSimulator["getRecords"]>,
) {
  const outboundEvents = new Set(
    records.filter((record) => record.direction === "outbound").map((record) => record.eventType),
  );
  const connectionCount = countEvent(records, "connection.opened");
  const connectedAgentIds = records.flatMap((record) =>
    record.eventType === "connection.opened" && record.agentId !== undefined ? [record.agentId] : []);
  const sourceAgentId = connectedAgentIds[0];
  const targetAgentId = readRequestedHandoffTarget(records);
  const passed = scenario.name === "normal"
    ? result.outboundFrameCount > 0 && result.outboundFingerprintMatched && outboundEvents.has("response.done")
    : scenario.name === "interrupted"
      ? result.clearCount > 0 && outboundEvents.has("input_audio_buffer.speech_started")
      : scenario.name === "duplicate-media"
        ? result.duplicateMediaStream?.closeCode === 4409
          && result.inboundFrameCount > 0
          && result.outboundFrameCount > 0
          && result.outboundFingerprintMatched
          && connectionCount === 1
          && outboundEvents.has("response.done")
      : scenario.name === "simultaneous-duplicate-media"
        ? result.duplicateMediaStream?.closeCode === 4409
          && result.inboundFrameCount > 0
          && result.outboundFrameCount > 0
          && result.outboundFingerprintMatched
          && connectionCount === 1
          && outboundEvents.has("response.done")
      : scenario.name === "tool-handoff"
        ? outboundEvents.has("response.done")
          && connectionCount >= 2
          && targetAgentId !== undefined
          && connectedAgentIds.includes(targetAgentId)
          && targetAgentId !== sourceAgentId
          && countEvent(records, "session.updated", "outbound") >= 2
          && hasAgentEvent(records, targetAgentId, "input_audio_buffer.append", "inbound")
          && hasAgentEvent(
            records,
            targetAgentId,
            "conversation.item.input_audio_transcription.completed",
            "outbound",
          )
          && hasAgentEvent(records, targetAgentId, "response.create", "inbound")
          && hasAgentEvent(records, targetAgentId, "response.done", "outbound")
      : scenario.name === "provider-failure"
        ? outboundEvents.has("error")
          && result.closeMode === "remote"
          && result.remoteCloseCode !== undefined
          && result.remoteCloseCode !== 1000
        : false;
  if (!passed) {
    throw new Error(`PSTN protocol smoke scenario '${scenario.name}' did not complete its Zara-side behavior.`);
  }
}

function isScenarioTerminal(
  scenario: SmokeScenario,
  records: ReturnType<OpenAiRealtimeProtocolSimulator["getRecords"]>,
) {
  if (scenario.name === "tool-handoff") {
    const connectedAgentIds = records.flatMap((record) =>
      record.eventType === "connection.opened" && record.agentId !== undefined ? [record.agentId] : []);
    const sourceAgentId = connectedAgentIds[0];
    const targetAgentId = readRequestedHandoffTarget(records);
    return countEvent(records, "connection.opened") >= 2
      && countEvent(records, "session.updated", "outbound") >= 2
      && targetAgentId !== undefined
      && connectedAgentIds.includes(targetAgentId)
      && targetAgentId !== sourceAgentId
      && hasAgentEvent(records, targetAgentId, "input_audio_buffer.append", "inbound")
      && hasAgentEvent(
        records,
        targetAgentId,
        "conversation.item.input_audio_transcription.completed",
        "outbound",
      )
      && hasAgentEvent(records, targetAgentId, "response.create", "inbound")
      && hasAgentEvent(records, targetAgentId, "response.done", "outbound");
  }
  if (scenario.name === "provider-failure") return countEvent(records, "error", "outbound") >= 1;
  if (scenario.name === "interrupted") {
    return countEvent(records, "input_audio_buffer.speech_started", "outbound") >= 1
      && countEvent(records, "response.done", "outbound") >= 1;
  }
  if (scenario.name === "duplicate-media") {
    return countEvent(records, "connection.opened") === 1
      && countEvent(records, "response.done", "outbound") >= 3;
  }
  if (scenario.name === "simultaneous-duplicate-media") {
    return countEvent(records, "connection.opened") === 1
      && countEvent(records, "response.done", "outbound") >= 3;
  }
  return countEvent(records, "response.done", "outbound") >= 3;
}

function readRequestedHandoffTarget(
  records: ReturnType<OpenAiRealtimeProtocolSimulator["getRecords"]>,
) {
  return records.find((record) => record.handoffTargetAgentId !== undefined)?.handoffTargetAgentId;
}

function hasAgentEvent(
  records: ReturnType<OpenAiRealtimeProtocolSimulator["getRecords"]>,
  agentId: string,
  eventType: string,
  direction: "inbound" | "outbound",
) {
  return records.some((record) =>
    record.agentId === agentId && record.eventType === eventType && record.direction === direction);
}

function countEvent(
  records: ReturnType<OpenAiRealtimeProtocolSimulator["getRecords"]>,
  eventType: string,
  direction?: "inbound" | "outbound",
) {
  return records.filter((record) =>
    record.eventType === eventType && (direction === undefined || record.direction === direction)).length;
}

function readConfig(env: NodeJS.ProcessEnv) {
  const required = (name: string) => {
    const value = env[name]?.trim() ?? "";
    if (value.length === 0) throw new Error(`Missing required PSTN protocol smoke variable: ${name}.`);
    return value;
  };
  const simulatorPort = Number(env.ZARA_PSTN_SIMULATOR_PORT ?? "4319");
  if (!Number.isInteger(simulatorPort) || simulatorPort < 1 || simulatorPort > 65_535) {
    throw new Error("ZARA_PSTN_SIMULATOR_PORT must be a valid TCP port.");
  }
  return {
    accountSid: required("ZARA_PSTN_SIMULATOR_TWILIO_ACCOUNT_SID"),
    authToken: required("ZARA_PSTN_SIMULATOR_TWILIO_AUTH_TOKEN"),
    from: required("ZARA_PSTN_SIMULATOR_FROM"),
    to: required("ZARA_PSTN_SIMULATOR_TO"),
    webhookUrl: required("ZARA_PSTN_SIMULATOR_WEBHOOK_URL"),
    simulatorHost: env.ZARA_PSTN_SIMULATOR_HOST?.trim() || "127.0.0.1",
    simulatorPort,
  };
}

function redactEndpoint(endpoint: string) {
  const parsed = new URL(endpoint);
  return `${parsed.protocol}//${parsed.hostname}:${parsed.port}${parsed.pathname}`;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${formatSmokeFailure(error)}\n`);
  process.exitCode = 1;
});
