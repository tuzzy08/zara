import type { CompiledRuntimeManifest, PstnAudioFrame } from "@zara/core";
import type { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability.js";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models.js";
import { computeTelephonyPremiumDispatchSnapshotChecksum } from "./telephony-incremental.repository.js";
import { PstnPremiumCallExecution } from "./pstn-premium-call-execution.js";

export function createPremiumDispatchSnapshot(
  manifest: CompiledRuntimeManifest,
) {
  if (manifest.workspaceId === undefined) {
    throw new Error("Premium test manifest requires a workspace.");
  }
  const snapshot = {
    schemaVersion: 1 as const,
    tenantId: manifest.tenantId,
    workspaceId: manifest.workspaceId,
    callSessionId: "CA-premium:telephony",
    dispatchId: "dispatch-premium-1",
    publishedVersionId: manifest.publishedVersionId,
    resolvedManifest: structuredClone(manifest),
    resolvedConversationPolicy: structuredClone(
      defaultPremiumRealtimeConversationPolicy,
    ),
    workerTarget: {
      workerId: "worker-test-1",
      releaseId: "release-test-1",
      mediaStreamBaseUrl:
        "wss://worker-test.zara.test/telephony/twilio/media-streams",
    },
    createdAt: "2026-07-11T11:00:00.000Z",
  };
  return {
    ...snapshot,
    checksum: computeTelephonyPremiumDispatchSnapshotChecksum(snapshot),
  };
}

export function createPremiumManifest() {
  return {
    schemaVersion: "zara.runtime-manifest.v2",
    manifestId: "workflow-premium-v1:manifest",
    publishedVersionId: "workflow-premium-v1",
    workflowId: "workflow-premium",
    tenantId: "tenant-west-africa",
    workspaceId: "workspace-support",
    runtime: "openai-realtime",
    runtimeProfile: "premium-realtime",
    entryAgentId: "agent-jane",
    graph: {
      id: "workflow-premium",
      name: "Premium support",
      nodes: [{
        id: "agent-jane",
        kind: "agent",
        label: "Jane",
        position: { x: 0, y: 0 },
        config: {
          role: {
            kind: "support",
            name: "Jane",
            businessName: "Tuzzy Labs",
            instructions: "Help callers with support questions.",
            defaultModelTier: "standard",
            runtimeProfileOverride: "premium-realtime",
            realtimeProvider: "openai-realtime",
            languagePolicy: {
              defaultLanguage: "en",
              supportedLanguages: ["en"],
              allowMidCallSwitching: false,
            },
          },
        },
      }],
      edges: [],
    },
    budget: { monthlyCapUsd: 100, currentSpendUsd: 0 },
    toolBindings: [],
    agentToolAssignments: [],
  } as unknown as CompiledRuntimeManifest;
}

export function createPremiumCallRuntimeContext() {
  return {
    tenantId: "tenant-west-africa",
    callSessionId: "CA-premium:telephony",
    dispatchId: "dispatch-premium-1",
    connectionId: "connection-1",
    disposition: "routed" as const,
    publishedVersionId: "workflow-premium-v1",
    workspaceId: "workspace-support",
    workflowLabel: "Premium support",
    runtimeProfile: "premium-realtime",
    runtimePath: "pstn-premium-realtime" as const,
    status: "ringing" as const,
    version: 0,
    lifecycleState: {
      stage: "media-connected" as const,
      observedAt: "2026-07-11T10:00:00.000Z",
    },
  };
}

export function createMinimalExecutionHarness(
  runtime: "openai-realtime" | "gemini-live",
  options: {
    connectError?: Error | undefined;
    onTerminate?: ((sessionId: string) => void) | undefined;
    onProviderClose?: ((reason: string) => void) | undefined;
    connectGate?: Promise<void> | undefined;
    providerReady?: Promise<void> | undefined;
    processProviderGate?: Promise<void> | ((rawProviderMessage: string) => Promise<void>) | undefined;
    sendError?: Error | undefined;
    manifest?: CompiledRuntimeManifest | undefined;
    onUpdate?: (() => void) | undefined;
    onObservedEvent?: ((event: { type: string; payload: Record<string, unknown> }) => void) | undefined;
    recordCheckpoint?: ((checkpoint: string) => Promise<void>) | undefined;
    recordLifecycle?: ((
      stage: string,
      input: {
        stage: string;
        ownership?: { workerId: string; ownerEpoch: number };
      },
    ) => Promise<unknown>) | undefined;
    applyRuntimePolicy?: ((input: {
      organizationId: string;
      callSessionId: string;
    }) => Promise<unknown>) | undefined;
    capacityObservability?: Partial<PstnCapacityObservability> | undefined;
  } = {},
) {
  const manifest = options.manifest ?? createPremiumManifest();
  const sentProviderMessages: Record<string, unknown>[] = [];
  const lifecycleStages: string[] = [];
  const registered = {
    organizationId: "tenant-west-africa",
    workspaceId: "workspace-support",
    actorUserId: "pstn:CA-premium",
    session: {
      sessionId: "premium-session-minimal",
      runtime,
      model: runtime === "gemini-live" ? "gemini-live-default" : "gpt-realtime",
      providerConfig: runtime === "gemini-live"
        ? geminiPstnProviderConfig("gemini-live-default")
        : openAiPstnProviderConfig("gpt-realtime"),
      activeAgentId: "agent-jane",
      expiresAt: "2099-07-11T12:00:00.000Z",
      toolDeclarations: [],
    },
    manifest,
    activeAgentId: "agent-jane",
    transcript: "",
    packet: { packetId: "packet-minimal", events: [] },
  };
  let providerCloseHandler: ((event: { code: number; reason: string }) => void) | undefined;
  let providerMessageHandler: ((message: string) => void) | undefined;
  const capacityObservability = options.capacityObservability === undefined
    ? undefined
    : {
        trackCall() {},
        endCall() {},
        openSocket() {},
        updateSocketContext() {},
        recordSocketHandshake() {},
        recordSocketHandshakeAttempt() {},
        recordSocketTraffic() {},
        recordSocketBuffered() {},
        closeSocket() {},
        recordQueue() {},
        recordQueueDrop() {},
        clearCallQueues() {},
        ...options.capacityObservability,
      } as PstnCapacityObservability;
  const execution = new PstnPremiumCallExecution(
    {
      async loadPstnCallRuntimeContext() {
        return { outcome: "found", context: createPremiumCallRuntimeContext() };
      },
      async recordPstnPhoneTestCheckpoint(input: { checkpoint: string }) {
        await options.recordCheckpoint?.(input.checkpoint);
      },
      async recordPstnCallLifecycle(input: {
        stage: string;
        ownership?: { workerId: string; ownerEpoch: number };
      }) {
        lifecycleStages.push(input.stage);
        return (
          await options.recordLifecycle?.(input.stage, input)
          ?? {
            outcome: "applied" as const,
            context: createPremiumCallRuntimeContext(),
          }
        );
      },
      async applyCallRuntimePolicy(input: {
        organizationId: string;
        callSessionId: string;
      }) {
        return await options.applyRuntimePolicy?.(input)
          ?? { session: { status: "active" as const } };
      },
    } as never,
    {
      async loadPremiumDispatchSnapshot() {
        return {
          outcome: "found",
          snapshot: createPremiumDispatchSnapshot(manifest),
        };
      },
    } as never,
    {
      async createRealtimeSessionFromSnapshot() { return registered.session; },
      getRegisteredSession() { return registered; },
      async processProviderMessage(message: { rawProviderMessage: string }) {
        if (typeof options.processProviderGate === "function") {
          await options.processProviderGate(message.rawProviderMessage);
        } else {
          await options.processProviderGate;
        }
        return { packet: registered.packet, providerMessages: [] };
      },
      updateRegisteredSession() { options.onUpdate?.(); },
      terminateRealtimeSession(sessionId: string) { options.onTerminate?.(sessionId); },
    } as never,
    {
      async connect() {
        await options.connectGate;
        if (options.connectError !== undefined) {
          throw options.connectError;
        }
        return {
          waitUntilReady() { return options.providerReady ?? Promise.resolve(); },
          getBufferedAmountBytes() { return 0; },
          send(message: Record<string, unknown>) {
            if (options.sendError !== undefined) {
              throw options.sendError;
            }
            sentProviderMessages.push(message);
            return 0;
          },
          close(_code?: number, reason?: string) { options.onProviderClose?.(reason ?? ""); },
          onMessage(handler: (message: string) => void) { providerMessageHandler = handler; },
          onClose(handler: (event: { code: number; reason: string }) => void) {
            providerCloseHandler = handler;
          },
        };
      },
    },
    options.onObservedEvent === undefined
      ? undefined
      : {
          async recordPstnCall(input: { events: Array<{ type: string; payload: Record<string, unknown> }> }) {
            for (const event of input.events) options.onObservedEvent?.(event);
            return { exportedSpanCount: 0, langsmithExported: false, warnings: [], metrics: {
              langsmithExportFailureCount: 0, spanExportFailureCount: 0, droppedSpanCount: 0,
            } };
          },
        },
    capacityObservability,
  );
  return {
    execution,
    sentProviderMessages,
    lifecycleStages,
    emitProviderMessage(message: string) {
      providerMessageHandler?.(message);
    },
    providerClosed() {
      providerCloseHandler?.({ code: 1006, reason: "provider disconnected" });
    },
  };
}

export function createTestControlMessage(marker: string) {
  return JSON.stringify({
    type: "response.done",
    response: {
      id: `response-${marker}`,
      status: "completed",
      output: [{
        type: "function_call",
        call_id: `call-${marker}`,
        name: marker,
        arguments: "{}",
      }],
    },
  });
}

export function createHandoffExecutionHarness(input: {
  targetReady: Promise<void>;
  onObservedEvent?: ((event: { type: string; payload: Record<string, unknown> }) => void) | undefined;
  processProviderMessage: (
    rawProviderMessage: string,
    registered: ReturnType<typeof createHandoffRegisteredSession>,
  ) => Record<string, unknown>;
}) {
  const manifest = createPremiumManifest();
  const registered = createHandoffRegisteredSession(manifest);
  const connections: ReturnType<typeof createFakeProviderConnection>[] = [];
  const marks: string[] = [];
  const callerCloses: string[] = [];
  const lifecycleStages: string[] = [];
  const execution = new PstnPremiumCallExecution(
    {
      async loadPstnCallRuntimeContext() {
        return { outcome: "found", context: createPremiumCallRuntimeContext() };
      },
      async recordPstnPhoneTestCheckpoint() {},
      async recordPstnCallLifecycle(input: { stage: string }) {
        lifecycleStages.push(input.stage);
        return {
          outcome: "applied" as const,
          context: createPremiumCallRuntimeContext(),
        };
      },
      async applyCallRuntimePolicy() {
        return { session: { status: "active" as const } };
      },
    } as never,
    {
      async loadPremiumDispatchSnapshot() {
        return {
          outcome: "found",
          snapshot: createPremiumDispatchSnapshot(manifest),
        };
      },
    } as never,
    {
      async createRealtimeSessionFromSnapshot() { return registered.session; },
      getRegisteredSession() { return registered; },
      async processProviderMessage(message: { rawProviderMessage: string }) {
        return input.processProviderMessage(message.rawProviderMessage, registered);
      },
      updateRegisteredSession(update: {
        session?: typeof registered.session;
        activeAgentId?: string;
        packet?: typeof registered.packet;
        transcript?: string;
      }) {
        if (update.session !== undefined) registered.session = update.session;
        if (update.activeAgentId !== undefined) registered.activeAgentId = update.activeAgentId;
        if (update.packet !== undefined) registered.packet = update.packet;
        if (update.transcript !== undefined) registered.transcript = update.transcript;
      },
      terminateRealtimeSession() {},
    } as never,
    {
      async connect() {
        const connection = createFakeProviderConnection(
          connections.length === 0 ? Promise.resolve() : input.targetReady,
        );
        connections.push(connection);
        return connection;
      },
    },
    input.onObservedEvent === undefined
      ? undefined
      : {
          async recordPstnCall(observation: { events: Array<{ type: string; payload: Record<string, unknown> }> }) {
            for (const event of observation.events) input.onObservedEvent?.(event);
            return { exportedSpanCount: 0, langsmithExported: false, warnings: [], metrics: {
              langsmithExportFailureCount: 0, spanExportFailureCount: 0, droppedSpanCount: 0,
            } };
          },
        },
  );

  return {
    execution,
    connections,
    marks,
    callerCloses,
    lifecycleStages,
    start: () => execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
      output: {
        sendMedia() {},
        clearAudio() {},
        sendMark(name) { marks.push(name); },
        close(_code, reason) { callerCloses.push(reason); },
      },
    }),
  };
}

export function createHandoffRegisteredSession(manifest = createPremiumManifest()) {
  return {
    organizationId: "tenant-west-africa",
    workspaceId: "workspace-support",
    actorUserId: "pstn:CA-premium",
    session: {
      sessionId: "premium-session-handoff",
      runtime: "openai-realtime" as const,
      model: "gpt-realtime",
      providerConfig: openAiPstnProviderConfig("gpt-realtime"),
      activeAgentId: "agent-jane",
      expiresAt: "2099-07-11T12:00:00.000Z",
      toolDeclarations: [],
    },
    manifest,
    activeAgentId: "agent-jane",
    transcript: "Caller asked about billing.",
    packet: { packetId: "packet-handoff", events: [] },
  };
}

export function createFakeProviderConnection(ready: Promise<void>) {
  let messageHandler: ((message: string) => void) | undefined;
  let closeHandler: ((event: { code: number; reason: string }) => void) | undefined;
  const sent: Record<string, unknown>[] = [];
  const closedReasons: string[] = [];
  return {
    sent,
    closedReasons,
    waitUntilReady() { return ready; },
    getBufferedAmountBytes() { return 0; },
    send(message: Record<string, unknown>) { sent.push(message); },
    close(_code?: number, reason?: string) { closedReasons.push(reason ?? ""); },
    onMessage(handler: (message: string) => void) { messageHandler = handler; },
    onClose(handler: (event: { code: number; reason: string }) => void) { closeHandler = handler; },
    emitMessage(message: string) { messageHandler?.(message); },
    emitClose() { closeHandler?.({ code: 1006, reason: "stale source closed" }); },
  };
}

export function createOpenAiReplacementResult(
  registered: ReturnType<typeof createHandoffRegisteredSession>,
  suffix: string,
) {
  return {
    session: { ...registered.session, activeAgentId: "agent-james" },
    activeAgentId: "agent-james",
    packet: registered.packet,
    providerMessages: [],
    providerSessionTransition: {
      requiresReplacement: true,
      source: { agentId: "agent-jane", runtime: "openai-realtime" as const, model: "gpt-realtime" },
      target: {
        agentId: "agent-james",
        runtime: "openai-realtime" as const,
        model: "gpt-realtime",
        toolDeclarations: [],
      },
      transfer: {
        id: `transfer-${suffix}`,
        reason: "Caller needs billing support.",
        callerNeedSummary: "Caller needs billing support.",
      },
      continuation: { instruction: "Continue as James." },
    },
  };
}

export function premiumInboundFrame(sequence: number): PstnAudioFrame {
  return {
    callSessionId: "CA-premium:telephony",
    mediaStreamId: "MZ-premium-1",
    direction: "inbound",
    codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
    sequence,
    timestampMs: sequence * 20,
    payloadBase64: Buffer.alloc(160, 0xff).toString("base64"),
  };
}

export function openAiPstnProviderConfig(model: string) {
  return {
    provider: "openai-realtime" as const,
    model,
    mediaProfile: "pstn" as const,
    conversationPolicyVersion: 1,
    media: {
      input: { type: "audio/pcmu" as const },
      output: { type: "audio/pcmu" as const },
    },
    turnDetection: {
      type: "semantic_vad" as const,
      eagerness: "low" as const,
      createResponse: true,
      interruptResponse: true,
    },
  };
}

export function geminiPstnProviderConfig(model: string) {
  return {
    provider: "gemini-live" as const,
    model,
    mediaProfile: "pstn" as const,
    conversationPolicyVersion: 1,
    media: {
      input: { mimeType: "audio/pcm;rate=16000" as const },
      output: { mimeType: "audio/pcm;rate=24000" as const },
    },
    activityHandling: { type: "provider_native" as const },
  };
}

export function waitFor(predicate: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 2_000) {
        reject(new Error("Condition was not met before timeout."));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
