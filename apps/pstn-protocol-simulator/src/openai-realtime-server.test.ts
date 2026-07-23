import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createCallFingerprint, verifyCallFingerprint } from "./twilio-protocol";
import { OpenAiRealtimeProtocolSimulator } from "./openai-realtime-server";

describe("OpenAiRealtimeProtocolSimulator", () => {
  let simulator: OpenAiRealtimeProtocolSimulator | undefined;

  afterEach(async () => {
    await simulator?.stop();
  });

  it("requires authentication when binding outside loopback", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();

    await expect(simulator.start({ host: "0.0.0.0" })).rejects.toThrow(
      "requires an authentication token outside loopback",
    );
  });

  it("acknowledges session setup and isolates output audio by call", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-1", {
      callFingerprint: createCallFingerprint("call-session-1"),
      responseMode: "normal",
      timing: { mode: "immediate" },
    });
    const socket = new WebSocket(endpoint, {
      headers: { "X-Zara-Simulator-Call-Id": "call-session-1" },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => {
      const parsed: unknown = JSON.parse(raw.toString());
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        messages.push(parsed as Record<string, unknown>);
      }
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));

    socket.send(JSON.stringify({ type: "session.update", session: { model: "gpt-realtime-2.1" } }));
    await waitForMessage(messages, "session.updated");
    socket.send(JSON.stringify({ type: "response.create" }));
    const audio = await waitForMessage(messages, "response.output_audio.delta");

    expect(typeof audio.delta).toBe("string");
    const payload = typeof audio.delta === "string" ? audio.delta : "";
    expect(verifyCallFingerprint(payload, createCallFingerprint("call-session-1"))).toBe(true);
    expect(verifyCallFingerprint(payload, createCallFingerprint("call-session-2"))).toBe(false);
  });

  it("auto-creates a response after a simulated caller turn", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-turn", {
      callFingerprint: createCallFingerprint("call-session-turn"),
      responseMode: "normal",
      timing: { mode: "immediate" },
    });
    const socket = new WebSocket(endpoint, {
      headers: { "X-Zara-Simulator-Call-Id": "call-session-turn" },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => {
      const parsed: unknown = JSON.parse(raw.toString());
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        messages.push(parsed as Record<string, unknown>);
      }
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "session.update", session: { model: "gpt-realtime-2.1" } }));
    await waitForMessage(messages, "session.updated");

    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "caller-pcmu-1" }));
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "caller-pcmu-2" }));
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "caller-pcmu-3" }));

    await expect(waitForMessage(messages, "input_audio_buffer.committed")).resolves.toBeDefined();
    await expect(waitForMessage(messages, "response.created")).resolves.toBeDefined();
    await expect(waitForMessage(messages, "response.done")).resolves.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages.filter((message) => message.type === "input_audio_buffer.committed")).toHaveLength(1);
    expect(messages.filter((message) => message.type === "response.created")).toHaveLength(1);

    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.close(1000, "test_complete");
    await closed;
    await simulator.waitForCallIdle("call-session-turn");
    simulator.releaseCall("call-session-turn");
    expect(simulator.getRecords("call-session-turn")).toEqual([]);
  });

  it("commits a caller turn only after silence follows the final frame", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-vad", {
      callFingerprint: createCallFingerprint("call-session-vad"),
      responseMode: "normal",
      timing: { mode: "immediate" },
      turnDetectionSilenceMs: 300,
    });
    const socket = new WebSocket(endpoint, {
      headers: { "X-Zara-Simulator-Call-Id": "call-session-vad" },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    await new Promise<void>((resolve) => socket.once("open", resolve));

    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "frame-1" }));
    await waitForMessage(messages, "input_audio_buffer.speech_started");
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(messages.some((message) => message.type === "input_audio_buffer.committed")).toBe(false);
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "frame-2" }));
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(messages.some((message) => message.type === "input_audio_buffer.committed")).toBe(false);

    await expect(waitForMessage(messages, "input_audio_buffer.committed")).resolves.toBeDefined();
  });

  it("interrupts an in-flight delayed response when caller speech starts", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-interruption", {
      callFingerprint: createCallFingerprint("call-session-interruption"),
      responseMode: "normal",
      timing: { mode: "delayed", delayMs: 5 },
    });
    const socket = new WebSocket(endpoint, {
      headers: { "X-Zara-Simulator-Call-Id": "call-session-interruption" },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => {
      const parsed: unknown = JSON.parse(raw.toString());
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        messages.push(parsed as Record<string, unknown>);
      }
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "session.update", session: { model: "gpt-realtime-2.1" } }));
    await waitForMessage(messages, "session.updated");
    socket.send(JSON.stringify({ type: "response.create" }));
    await waitForMessage(messages, "response.output_audio.delta");

    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "caller-interruption" }));

    await expect(waitForMessage(messages, "input_audio_buffer.speech_started")).resolves.toBeDefined();
    await expect(waitForMessage(messages, "response.done")).resolves.toBeDefined();
    expect(messages.filter((message) => message.type === "response.output_audio.delta").length).toBeLessThan(60);
  });

  it("creates distinct response identities for caller turns separated by silence", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-multi-turn", {
      callFingerprint: createCallFingerprint("call-session-multi-turn"),
      responseMode: "normal",
      timing: { mode: "immediate" },
      turnDetectionSilenceMs: 10,
    });
    const socket = new WebSocket(endpoint, {
      headers: { "X-Zara-Simulator-Call-Id": "call-session-multi-turn" },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on("message", (raw) => {
      const parsed: unknown = JSON.parse(raw.toString());
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        messages.push(parsed as Record<string, unknown>);
      }
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "session.update", session: { model: "gpt-realtime-2.1" } }));
    await waitForMessage(messages, "session.updated");

    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "first-turn" }));
    await waitForMessageCount(messages, "response.done", 1);
    await new Promise((resolve) => setTimeout(resolve, 15));
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "second-turn" }));
    await waitForMessageCount(messages, "response.done", 2);

    const responseIds = messages
      .filter((message) => message.type === "response.created")
      .map((message) => readNestedString(message, "response", "id"));
    expect(responseIds).toHaveLength(2);
    expect(new Set(responseIds).size).toBe(2);
  });

  it("cancels stalled provider work when its socket closes", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-stalled", {
      callFingerprint: createCallFingerprint("call-session-stalled"),
      responseMode: "normal",
      timing: { mode: "stalled" },
    });
    const socket = new WebSocket(endpoint, {
      headers: { "X-Zara-Simulator-Call-Id": "call-session-stalled" },
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({ type: "response.create" }));
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.close(1000, "test_complete");
    await closed;

    await expect(simulator.waitForCallIdle("call-session-stalled", 250)).resolves.toBeUndefined();
    expect(() => simulator?.releaseCall("call-session-stalled")).not.toThrow();
  });

  it("records the exact handoff target requested by the provider", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-handoff", {
      callFingerprint: createCallFingerprint("call-session-handoff"),
      responseMode: "handoff",
      timing: { mode: "immediate" },
    });
    const socket = new WebSocket(endpoint, {
      headers: {
        "X-Zara-Simulator-Call-Id": "call-session-handoff",
        "X-Zara-Simulator-Agent-Id": "agent-router",
      },
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({
      type: "session.update",
      session: {
        tools: [{
          name: "zara_handoff_to_agent",
          parameters: {
            properties: { targetAgentId: { enum: ["agent-billing"] } },
          },
        }],
      },
    }));
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "billing-help" }));
    await waitForRecord(simulator, "call-session-handoff", "response.done");

    expect(simulator.getRecords("call-session-handoff")).toContainEqual(expect.objectContaining({
      direction: "outbound",
      eventType: "response.done",
      agentId: "agent-router",
      handoffTargetAgentId: "agent-billing",
    }));
  });

  it("keeps handoff tools scoped to the router provider connection", async () => {
    simulator = new OpenAiRealtimeProtocolSimulator();
    const endpoint = await simulator.start();
    simulator.setScenario("call-session-tool-scope", {
      callFingerprint: createCallFingerprint("call-session-tool-scope"),
      responseMode: "handoff",
      timing: { mode: "immediate" },
      turnDetectionSilenceMs: 5,
    });
    const router = new WebSocket(endpoint, { headers: {
      "X-Zara-Simulator-Call-Id": "call-session-tool-scope",
      "X-Zara-Simulator-Agent-Id": "agent-router",
    } });
    const specialist = new WebSocket(endpoint, { headers: {
      "X-Zara-Simulator-Call-Id": "call-session-tool-scope",
      "X-Zara-Simulator-Agent-Id": "agent-billing",
    } });
    await Promise.all([
      new Promise<void>((resolve) => router.once("open", resolve)),
      new Promise<void>((resolve) => specialist.once("open", resolve)),
    ]);
    router.send(JSON.stringify({ type: "session.update", session: { tools: [{
      name: "zara_handoff_to_agent",
      parameters: { properties: { targetAgentId: { enum: ["agent-billing"] } } },
    }] } }));
    specialist.send(JSON.stringify({ type: "session.update", session: { tools: [] } }));
    router.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "billing-help" }));
    await waitForRecord(simulator, "call-session-tool-scope", "response.done", "agent-router");
    specialist.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "follow-up" }));
    await waitForRecord(simulator, "call-session-tool-scope", "response.done", "agent-billing");

    const specialistRecords = simulator.getRecords("call-session-tool-scope")
      .filter((record) => record.agentId === "agent-billing");
    expect(specialistRecords.some((record) => record.eventType === "response.output_audio.delta")).toBe(true);
    expect(specialistRecords.some((record) => record.handoffTargetAgentId !== undefined)).toBe(false);
  });
});

async function waitForMessage(messages: Array<Record<string, unknown>>, type: string) {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const message = messages.find((candidate) => candidate.type === type);
    if (message !== undefined) return message;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

async function waitForMessageCount(messages: Array<Record<string, unknown>>, type: string, count: number) {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    if (messages.filter((message) => message.type === type).length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${count} ${type} messages.`);
}

async function waitForRecord(
  simulator: OpenAiRealtimeProtocolSimulator,
  callId: string,
  eventType: string,
  agentId?: string,
) {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    if (simulator.getRecords(callId).some((record) =>
      record.eventType === eventType && (agentId === undefined || record.agentId === agentId))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${eventType} simulator record.`);
}

function readNestedString(value: Record<string, unknown>, objectKey: string, stringKey: string) {
  const nested = value[objectKey];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return undefined;
  const candidate = (nested as Record<string, unknown>)[stringKey];
  return typeof candidate === "string" ? candidate : undefined;
}
