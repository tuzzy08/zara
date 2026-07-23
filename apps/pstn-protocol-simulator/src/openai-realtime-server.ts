import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

import {
  createOpenAiRealtimeScenarioEvents,
  type OpenAiRealtimeScenario,
  type OpenAiRealtimeServerEvent,
  waitForOpenAiRealtimeEvent,
} from "./openai-realtime-simulator";

export interface SimulatorRecord {
  callId: string;
  direction: "inbound" | "outbound";
  eventType: string;
  byteCount: number;
  agentId?: string | undefined;
  handoffTargetAgentId?: string | undefined;
}

interface PendingCallerTurn {
  controller: AbortController;
  events: OpenAiRealtimeServerEvent[];
  generation: number;
  scenario: OpenAiRealtimeScenario;
}

export class OpenAiRealtimeProtocolSimulator {
  private server: WebSocketServer | undefined;
  private readonly scenarios = new Map<string, OpenAiRealtimeScenario>();
  private readonly connections = new Set<WebSocket>();
  private readonly recordsByCall = new Map<string, SimulatorRecord[]>();
  private readonly sessionTools = new WeakMap<WebSocket, Array<Record<string, unknown>>>();
  private readonly processing = new WeakMap<WebSocket, Promise<void>>();
  private readonly pendingCallerTurns = new WeakMap<WebSocket, PendingCallerTurn>();
  private readonly responseGenerations = new Map<string, number>();
  private readonly responseSequences = new Map<string, number>();
  private readonly activeTasks = new Map<string, Set<Promise<void>>>();
  private readonly connectionCounts = new Map<string, number>();
  private readonly connectionAgentIds = new WeakMap<WebSocket, string>();
  private readonly responseControllers = new WeakMap<WebSocket, AbortController>();

  setScenario(callId: string, scenario: OpenAiRealtimeScenario) {
    this.scenarios.set(callId, scenario);
  }

  getRecords(callId?: string) {
    if (callId !== undefined) return (this.recordsByCall.get(callId) ?? []).map((record) => ({ ...record }));
    return [...this.recordsByCall.values()].flatMap((records) => records.map((record) => ({ ...record })));
  }

  releaseCall(callId: string) {
    if ((this.connectionCounts.get(callId) ?? 0) > 0 || (this.activeTasks.get(callId)?.size ?? 0) > 0) {
      throw new Error(`Cannot release active simulator call '${callId}'.`);
    }
    this.scenarios.delete(callId);
    this.responseGenerations.delete(callId);
    this.responseSequences.delete(callId);
    this.activeTasks.delete(callId);
    this.connectionCounts.delete(callId);
    this.recordsByCall.delete(callId);
  }

  async waitForCallIdle(callId: string, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((this.connectionCounts.get(callId) ?? 0) === 0 && (this.activeTasks.get(callId)?.size ?? 0) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Simulator call '${callId}' did not release its provider connections.`);
  }

  async start(input: { host?: string; port?: number; authToken?: string } = {}) {
    if (this.server !== undefined) throw new Error("OpenAI realtime simulator is already running.");
    const host = input.host ?? "127.0.0.1";
    if (!isLoopbackHost(host) && (input.authToken?.length ?? 0) < 32) {
      throw new Error("OpenAI realtime simulator requires an authentication token outside loopback.");
    }
    const server = new WebSocketServer({ host, port: input.port ?? 0 });
    this.server = server;
    server.on("connection", (socket, request) => {
      if (input.authToken !== undefined && !matchesToken(request.headers["x-zara-simulator-token"], input.authToken)) {
        socket.close(4401, "simulator_authentication_failed");
        return;
      }
      const rawCallId = request.headers["x-zara-simulator-call-id"];
      const callId = Array.isArray(rawCallId) ? rawCallId[0] : rawCallId;
      if (callId === undefined || !this.scenarios.has(callId)) {
        socket.close(4404, "simulator_scenario_missing");
        return;
      }
      this.connections.add(socket);
      this.connectionCounts.set(callId, (this.connectionCounts.get(callId) ?? 0) + 1);
      const rawAgentId = request.headers["x-zara-simulator-agent-id"];
      const agentId = Array.isArray(rawAgentId) ? rawAgentId[0] : rawAgentId;
      if (agentId !== undefined) this.connectionAgentIds.set(socket, agentId);
      this.record(callId, "inbound", "connection.opened", 0, agentId);
      socket.once("close", () => {
        this.responseControllers.get(socket)?.abort();
        this.pendingCallerTurns.get(socket)?.controller.abort();
        this.connections.delete(socket);
        this.connectionCounts.set(callId, Math.max(0, (this.connectionCounts.get(callId) ?? 1) - 1));
        this.record(callId, "inbound", "connection.closed", 0, agentId);
      });
      socket.on("message", (raw) => {
        const previous = this.processing.get(socket) ?? Promise.resolve();
        const next = previous
          .then(() => this.handleMessage(socket, callId, raw.toString()))
          .catch(() => socket.close(1011, "simulator_protocol_failure"));
        this.processing.set(socket, next);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Simulator address is unavailable.");
    return `ws://${host}:${address.port}/realtime`;
  }

  async stop() {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    const connections = [...this.connections];
    for (const connection of connections) {
      this.responseControllers.get(connection)?.abort();
      this.pendingCallerTurns.get(connection)?.controller.abort();
      connection.close(1001, "simulator_shutdown");
    }
    const forceClose = setTimeout(() => {
      for (const connection of connections) connection.terminate();
    }, 1_000);
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      clearTimeout(forceClose);
      this.connections.clear();
    }
  }

  private async handleMessage(socket: WebSocket, callId: string, raw: string) {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("Simulator received a non-object provider message.");
    const message = parsed;
    this.record(
      callId,
      "inbound",
      readString(message.type) ?? "unknown",
      Buffer.byteLength(raw),
      this.connectionAgentIds.get(socket),
    );
    const scenario = this.scenarios.get(callId)!;
    if (message.type === "session.update") {
      const session = isRecord(message.session) ? message.session : {};
      const tools = Array.isArray(session.tools) ? session.tools.filter(isRecord) : [];
      this.sessionTools.set(socket, tools);
      this.send(socket, callId, {
        type: "session.updated",
        session,
      });
      return;
    }
    if (message.type === "response.create") {
      const greetingScenario: OpenAiRealtimeScenario = {
        ...scenario,
        responseMode: "normal",
        responseSequence: this.nextResponseSequence(callId),
      };
      const events = await createOpenAiRealtimeScenarioEvents(greetingScenario);
      const generation = this.responseGenerations.get(callId) ?? 0;
      this.scheduleResponseTask(callId, socket, (signal) =>
        this.sendEvents(socket, callId, greetingScenario, responseEvents(events), generation, signal));
      return;
    }
    if (message.type === "input_audio_buffer.append") {
      await this.receiveCallerAudio(socket, callId, scenario);
    }
  }

  private resolveToolScenario(socket: WebSocket, scenario: OpenAiRealtimeScenario): OpenAiRealtimeScenario {
    if (scenario.responseMode !== "tool" && scenario.responseMode !== "handoff") return scenario;
    const tools = this.sessionTools.get(socket) ?? [];
    const selected = scenario.responseMode === "handoff"
      ? tools.find((tool) => tool.name === "zara_handoff_to_agent")
      : tools.find((tool) => typeof tool.name === "string" && tool.name !== "zara_handoff_to_agent");
    if (selected === undefined) return { ...scenario, responseMode: "normal" };
    const parameters = isRecord(selected?.parameters) ? selected.parameters : {};
    const properties = isRecord(parameters.properties) ? parameters.properties : {};
    const targetAgent = isRecord(properties.targetAgentId) ? properties.targetAgentId : {};
    const targetAgentId = Array.isArray(targetAgent.enum) ? targetAgent.enum[0] : undefined;
    return {
      ...scenario,
      ...(readString(selected?.name) !== undefined ? { toolName: readString(selected?.name) } : {}),
      ...(typeof targetAgentId === "string" ? { handoffTargetAgentId: targetAgentId } : {}),
    };
  }

  private async receiveCallerAudio(
    socket: WebSocket,
    callId: string,
    scenario: OpenAiRealtimeScenario,
  ) {
    const pending = this.pendingCallerTurns.get(socket);
    if (pending !== undefined) {
      pending.controller.abort();
      pending.controller = new AbortController();
      this.scheduleCallerTurnCompletion(socket, callId, pending);
      return;
    }

    const generation = (this.responseGenerations.get(callId) ?? 0) + 1;
    this.responseGenerations.set(callId, generation);
    this.responseControllers.get(socket)?.abort();
    const effectiveScenario = {
      ...this.resolveToolScenario(socket, scenario),
      responseSequence: this.nextResponseSequence(callId),
    };
    const events = await createOpenAiRealtimeScenarioEvents(effectiveScenario);
    const speechStarted = callerEvents(events).find((event) => event.type === "input_audio_buffer.speech_started");
    if (speechStarted !== undefined) this.send(socket, callId, speechStarted);
    const turn: PendingCallerTurn = {
      controller: new AbortController(),
      events,
      generation,
      scenario: effectiveScenario,
    };
    this.pendingCallerTurns.set(socket, turn);
    this.scheduleCallerTurnCompletion(socket, callId, turn);
  }

  private scheduleCallerTurnCompletion(socket: WebSocket, callId: string, turn: PendingCallerTurn) {
    const controller = turn.controller;
    const task = (async () => {
      await waitForOpenAiRealtimeEvent(
        { mode: "delayed", delayMs: turn.scenario.turnDetectionSilenceMs ?? 200 },
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || this.pendingCallerTurns.get(socket) !== turn) return;
      this.pendingCallerTurns.delete(socket);
      this.scheduleResponseTask(callId, socket, async (signal) => {
        const remainingCallerEvents = callerEvents(turn.events)
          .filter((event) => event.type !== "input_audio_buffer.speech_started");
        await this.sendEvents(socket, callId, turn.scenario, remainingCallerEvents, undefined, signal);
        if (signal.aborted) return;
        if (turn.scenario.responseMode === "provider_close") {
          socket.close(1011, "simulated_provider_close");
          return;
        }
        if (turn.scenario.responseMode === "protocol_error") {
          socket.send("{invalid-json");
          this.record(callId, "outbound", "invalid_json", 13, this.connectionAgentIds.get(socket));
          return;
        }
        await this.sendEvents(
          socket,
          callId,
          turn.scenario,
          responseEvents(turn.events),
          turn.generation,
          signal,
        );
      });
    })()
      .catch(() => {
        if (!controller.signal.aborted) socket.close(1011, "simulator_protocol_failure");
      });
    this.trackTask(callId, task);
  }

  private send(socket: WebSocket, callId: string, event: OpenAiRealtimeServerEvent) {
    if (socket.readyState !== 1) return;
    const serialized = JSON.stringify(event);
    socket.send(serialized);
    this.record(
      callId,
      "outbound",
      event.type,
      Buffer.byteLength(serialized),
      this.connectionAgentIds.get(socket),
      readHandoffTargetAgentId(event),
    );
  }

  private async sendEvents(
    socket: WebSocket,
    callId: string,
    scenario: OpenAiRealtimeScenario,
    events: OpenAiRealtimeServerEvent[],
    generation?: number,
    signal?: AbortSignal,
  ) {
    for (const event of events) {
      await waitForOpenAiRealtimeEvent(scenario.timing, undefined, signal);
      if (signal?.aborted === true) return;
      if (generation !== undefined && (this.responseGenerations.get(callId) ?? 0) !== generation) return;
      this.send(socket, callId, event);
    }
  }

  private scheduleResponseTask(callId: string, socket: WebSocket, action: (signal: AbortSignal) => Promise<void>) {
    this.responseControllers.get(socket)?.abort();
    const controller = new AbortController();
    this.responseControllers.set(socket, controller);
    const task = action(controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) socket.close(1011, "simulator_protocol_failure");
      })
      .finally(() => {
        if (this.responseControllers.get(socket) === controller) this.responseControllers.delete(socket);
      });
    this.trackTask(callId, task);
  }

  private trackTask(callId: string, task: Promise<void>) {
    const tasks = this.activeTasks.get(callId) ?? new Set<Promise<void>>();
    this.activeTasks.set(callId, tasks);
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  }

  private nextResponseSequence(callId: string) {
    const sequence = (this.responseSequences.get(callId) ?? 0) + 1;
    this.responseSequences.set(callId, sequence);
    return sequence;
  }

  private record(
    callId: string,
    direction: "inbound" | "outbound",
    eventType: string,
    byteCount: number,
    agentId?: string,
    handoffTargetAgentId?: string,
  ) {
    const records = this.recordsByCall.get(callId) ?? [];
    if (!this.recordsByCall.has(callId)) this.recordsByCall.set(callId, records);
    records.push({
      callId,
      direction,
      eventType,
      byteCount,
      ...(agentId === undefined ? {} : { agentId }),
      ...(handoffTargetAgentId === undefined ? {} : { handoffTargetAgentId }),
    });
    if (records.length > 10_000) records.splice(0, records.length - 10_000);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function callerEvents(events: OpenAiRealtimeServerEvent[]) {
  return events.filter((event) =>
    event.type.startsWith("input_audio_buffer.")
    || event.type.startsWith("conversation.item.input_audio_transcription."));
}

function responseEvents(events: OpenAiRealtimeServerEvent[]) {
  const firstResponseIndex = events.findIndex((event) =>
    event.type === "response.created" || event.type === "error" || event.type === "simulator.invalid_event");
  return firstResponseIndex < 0 ? [] : events.slice(firstResponseIndex);
}

function readHandoffTargetAgentId(event: OpenAiRealtimeServerEvent) {
  if (event.type !== "response.done" || !isRecord(event.response)) return undefined;
  const output = Array.isArray(event.response.output) ? event.response.output : [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "function_call" || item.name !== "zara_handoff_to_agent") continue;
    if (typeof item.arguments !== "string") return undefined;
    try {
      const parsed: unknown = JSON.parse(item.arguments);
      return isRecord(parsed) ? readString(parsed.targetAgentId) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost"
    || hostname === "::1"
    || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

function matchesToken(value: string | string[] | undefined, expected: string) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}
