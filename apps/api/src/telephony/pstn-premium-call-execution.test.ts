import { describe, expect, it } from "vitest";
import type { CompiledRuntimeManifest, PstnAudioFrame } from "@zara/core";

import {
  PstnPremiumCallExecution,
  type PstnPremiumCallOutput,
} from "./pstn-premium-call-execution";

describe("PstnPremiumCallExecution", () => {
  it("streams Twilio mu-law media through the OpenAI premium session and returns PSTN-ready audio", async () => {
    const manifest = createPremiumManifest();
    const sentProviderMessages: Record<string, unknown>[] = [];
    const outboundFrames: PstnAudioFrame[] = [];
    const playbackMarks: string[] = [];
    const checkpoints: string[] = [];
    let providerMessageHandler: ((message: string) => void) | undefined;
    let providerCloseHandler: ((event: { code: number; reason: string }) => void) | undefined;
    let connectedMediaProfile: string | undefined;
    let cleared = 0;
    let providerClosed = false;
    let terminatedRuntimeSessionId: string | undefined;
    const providerReady = deferred<void>();
    const registered = {
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-support",
      actorUserId: "pstn:CA-premium",
      session: {
        sessionId: "premium-session-1",
        runtime: "openai-realtime",
        model: "gpt-realtime",
        activeAgentId: "agent-jane",
        expiresAt: "2026-07-11T12:00:00.000Z",
        toolDeclarations: [],
      },
      manifest,
      activeAgentId: "agent-jane",
      transcript: "",
      packet: { packetId: "packet-1", events: [] },
    };
    const output: PstnPremiumCallOutput = {
      sendMedia(frame) {
        outboundFrames.push(frame);
      },
      clearAudio() {
        cleared += 1;
      },
      sendMark(name) { playbackMarks.push(name); },
      close() {},
    };
    const execution = new PstnPremiumCallExecution(
      {
        async getState() {
          return {
            organizationId: "tenant-west-africa",
            connections: [],
            phoneNumbers: [],
            healthChecks: [],
            providerHeartbeats: [],
            dispatches: [
              {
                id: "dispatch-premium-1",
                tenantId: "tenant-west-africa",
                direction: "inbound",
                disposition: "routed",
                reason: "Live premium route.",
                callSessionId: "CA-premium:telephony",
                connectionId: "connection-1",
                publishedVersionId: "workflow-premium-v1",
                workspaceId: "workspace-support",
                workflowLabel: "Premium support",
                runtimeProfile: "premium-realtime",
                runtimePath: "pstn-premium-realtime",
                recording: { enabled: false, consentMode: "disabled", consentMessage: "" },
                recordingConsent: {
                  state: "not-required",
                  consentMode: "disabled",
                  message: "",
                  noticeRequired: false,
                  updatedAt: "2026-07-11T10:00:00.000Z",
                },
                toPhoneNumber: "+14155557890",
                fromPhoneNumber: "+233201110001",
                createdAt: "2026-07-11T10:00:00.000Z",
                source: "webhook",
              },
            ],
            executionSessions: [],
            executionCommands: [],
            webhookEvents: [],
            callControlEvents: [],
          };
        },
        async recordPstnPhoneTestCheckpoint(input: { checkpoint: string }) {
          checkpoints.push(input.checkpoint);
        },
      } as never,
      {
        async getPublishedManifest() {
          return manifest;
        },
      } as never,
      {
        async createRealtimeSession() {
          return registered.session;
        },
        getRegisteredSession() {
          return registered;
        },
        async processProviderMessage() {
          return { packet: registered.packet, providerMessages: [] };
        },
        updateRegisteredSession() {},
        terminateRealtimeSession(sessionId: string) {
          terminatedRuntimeSessionId = sessionId;
        },
      } as never,
      {
        async connect(input) {
          connectedMediaProfile = input.mediaProfile;
          return {
            waitUntilReady() {
              return providerReady.promise;
            },
            getBufferedAmountBytes() {
              return 0;
            },
            send(message: Record<string, unknown>) {
              sentProviderMessages.push(message);
              return 0;
            },
            close() {
              providerClosed = true;
            },
            onMessage(handler: (message: string) => void) {
              providerMessageHandler = handler;
            },
            onClose(handler: (event: { code: number; reason: string }) => void) {
              providerCloseHandler = handler;
            },
          };
        },
      },
    );

    await execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output,
    });
    await execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: {
        callSessionId: "CA-premium:telephony",
        mediaStreamId: "MZ-premium-1",
        direction: "inbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
        sequence: 1,
        timestampMs: 20,
        payloadBase64: Buffer.alloc(160, 0xff).toString("base64"),
      },
    });

    expect(sentProviderMessages).toEqual([]);
    providerReady.resolve();
    await waitFor(() => sentProviderMessages.length === 1);
    expect(sentProviderMessages[0]).toMatchObject({ type: "input_audio_buffer.append" });
    expect(Buffer.from(String(sentProviderMessages[0]?.audio), "base64")).toHaveLength(960);
    expect(connectedMediaProfile).toBe("pstn");

    providerMessageHandler?.(JSON.stringify({
      type: "response.created",
      response: { id: "response-1", status: "in_progress" },
    }));
    providerMessageHandler?.(JSON.stringify({
      type: "response.output_audio.delta",
      response_id: "response-1",
      delta: Buffer.alloc(160, 0xff).toString("base64"),
    }));
    await waitFor(() => outboundFrames.length === 1);
    expect(outboundFrames[0]).toMatchObject({
      callSessionId: "CA-premium:telephony",
      mediaStreamId: "MZ-premium-1",
      direction: "outbound",
      codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
    });
    expect(Buffer.from(outboundFrames[0]!.payloadBase64, "base64")).toHaveLength(160);
    expect(outboundFrames[0]!.payloadBase64).toBe(Buffer.alloc(160, 0xff).toString("base64"));
    expect(checkpoints).not.toContain("outboundAudioSent");

    providerMessageHandler?.(JSON.stringify({
      type: "response.output_audio_transcript.done",
      response_id: "response-1",
      transcript: "This transcript does not own playback completion.",
    }));
    providerMessageHandler?.(JSON.stringify({
      type: "response.output_audio.done",
      response_id: "response-1",
    }));
    await waitFor(() => playbackMarks.length === 2);
    expect(playbackMarks).toHaveLength(2);

    providerMessageHandler?.(JSON.stringify({
      type: "input_audio_buffer.speech_started",
      audio_start_ms: 20,
    }));
    providerMessageHandler?.(JSON.stringify({
      type: "response.cancelled",
      response: { id: "response-1", status: "cancelled" },
    }));
    await waitFor(() => cleared === 1);

    providerMessageHandler?.(JSON.stringify({
      type: "response.created",
      response: { id: "response-2", status: "in_progress" },
    }));
    providerMessageHandler?.(JSON.stringify({
      type: "response.output_audio.delta",
      response_id: "response-1",
      delta: Buffer.alloc(160, 0xee).toString("base64"),
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(outboundFrames).toHaveLength(1);

    providerMessageHandler?.(JSON.stringify({
      type: "response.output_audio.delta",
      response_id: "response-2",
      delta: Buffer.alloc(160, 0xdd).toString("base64"),
    }));
    await waitFor(() => outboundFrames.length === 2);
    expect(outboundFrames[1]!.payloadBase64).toBe(Buffer.alloc(160, 0xdd).toString("base64"));

    await execution.stop({ callSessionId: "CA-premium:telephony" });
    expect(providerClosed).toBe(true);
    expect(terminatedRuntimeSessionId).toBe("premium-session-1");
    providerCloseHandler?.({ code: 1000, reason: "done" });
  });

  it("uses Gemini Live audio framing when platform policy selects Gemini", async () => {
    const { execution, sentProviderMessages } = createMinimalExecutionHarness("gemini-live");
    await execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {},
        clearAudio() {},
        sendMark() {},
        close() {},
      },
    });
    await execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: {
        callSessionId: "CA-premium:telephony",
        mediaStreamId: "MZ-premium-1",
        direction: "inbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
        sequence: 1,
        timestampMs: 20,
        payloadBase64: Buffer.alloc(160, 0xff).toString("base64"),
      },
    });

    await waitFor(() => sentProviderMessages.length === 1);
    expect(sentProviderMessages[0]).toMatchObject({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
    const audio = (sentProviderMessages[0]?.realtimeInput as { audio: { data: string } }).audio.data;
    expect(Buffer.from(audio, "base64")).toHaveLength(640);
  });

  it("removes the runtime session when the provider connection cannot start", async () => {
    const terminatedSessionIds: string[] = [];
    const { execution } = createMinimalExecutionHarness("openai-realtime", {
      connectError: new Error("provider unavailable"),
      onTerminate(sessionId) {
        terminatedSessionIds.push(sessionId);
      },
    });

    await expect(execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    })).rejects.toThrow("provider unavailable");
    expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
  });

  it("fails once and cleans both legs when the provider closes", async () => {
    const terminatedSessionIds: string[] = [];
    const providerCloses: string[] = [];
    const callerCloses: string[] = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
      onProviderClose: (reason) => providerCloses.push(reason),
    });
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {}, clearAudio() {}, sendMark() {},
        close(_code, reason) { callerCloses.push(reason); },
      },
    });

    harness.providerClosed();
    harness.providerClosed();
    await harness.execution.stop({ callSessionId: "CA-premium:telephony" });

    expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
    expect(callerCloses).toEqual(["premium_provider_closed"]);
    expect(providerCloses).toEqual(["premium_provider_closed"]);
  });

  it("stops every active actor once during application shutdown", async () => {
    const terminatedSessionIds: string[] = [];
    const providerCloses: string[] = [];
    const callerCloses: string[] = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
      onProviderClose: (reason) => providerCloses.push(reason),
    });
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {}, clearAudio() {}, sendMark() {},
        close(_code, reason) { callerCloses.push(reason); },
      },
    });

    await harness.execution.onApplicationShutdown();
    await harness.execution.onApplicationShutdown();

    expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
    expect(callerCloses).toEqual(["app_shutdown"]);
    expect(providerCloses).toEqual(["app_shutdown"]);
  });

  it("does not install an execution when Twilio closes during provider startup", async () => {
    const connectGate = deferred<void>();
    const terminatedSessionIds: string[] = [];
    const providerCloses: string[] = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      connectGate: connectGate.promise,
      onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
      onProviderClose: (reason) => providerCloses.push(reason),
    });
    const starting = harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    });
    await Promise.resolve();

    await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
    connectGate.resolve();
    await starting;

    expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
    expect(providerCloses).toEqual(["pstn_stream_stopped"]);
    await expect(harness.execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: {
        callSessionId: "CA-premium:telephony",
        mediaStreamId: "MZ-premium-1",
        direction: "inbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
        sequence: 1,
        timestampMs: 20,
        payloadBase64: Buffer.alloc(160, 0xff).toString("base64"),
      },
    })).rejects.toThrow("is not active");
  });

  it("does not install an execution when application shutdown starts during provider startup", async () => {
    const connectGate = deferred<void>();
    const terminatedSessionIds: string[] = [];
    const providerCloses: string[] = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      connectGate: connectGate.promise,
      onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
      onProviderClose: (reason) => providerCloses.push(reason),
    });
    const starting = harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    });
    await Promise.resolve();

    await harness.execution.onApplicationShutdown();
    connectGate.resolve();
    await starting;

    expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
    expect(providerCloses).toEqual(["app_shutdown"]);
    await expect(harness.execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: {
        callSessionId: "CA-premium:telephony",
        mediaStreamId: "MZ-premium-1",
        direction: "inbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
        sequence: 1,
        timestampMs: 20,
        payloadBase64: Buffer.alloc(160, 0xff).toString("base64"),
      },
    })).rejects.toThrow("is not active");
  });

  it("removes a failed execution when provider readiness rejects without a close event", async () => {
    const providerReady = deferred<void>();
    const terminatedSessionIds: string[] = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      providerReady: providerReady.promise,
      onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
    });
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    });

    providerReady.reject(new Error("provider setup failed"));
    await waitFor(() => terminatedSessionIds.length === 1);

    await expect(harness.execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: {
        callSessionId: "CA-premium:telephony",
        mediaStreamId: "MZ-premium-1",
        direction: "inbound",
        codec: { name: "g711_mulaw", sampleRateHz: 8000, channels: 1 },
        sequence: 1,
        timestampMs: 20,
        payloadBase64: Buffer.alloc(160, 0xff).toString("base64"),
      },
    })).rejects.toThrow("Premium PSTN execution 'CA-premium:telephony' is not active.");
  });

  it("fails when serialized provider output exceeds its bounded ingress ledger", async () => {
    const processGate = deferred<void>();
    const terminations: string[] = [];
    const providerCloses: string[] = [];
    let updates = 0;
    const harness = createMinimalExecutionHarness("openai-realtime", {
      processProviderGate: processGate.promise,
      onTerminate: (sessionId) => terminations.push(sessionId),
      onProviderClose: (reason) => providerCloses.push(reason),
      onUpdate: () => { updates += 1; },
    });
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    });
    const message = JSON.stringify({ type: "provider.noop", padding: "x".repeat(1_024) });

    harness.emitProviderMessage(message);
    await Promise.resolve();
    for (let index = 1; index < 70; index += 1) {
      harness.emitProviderMessage(message);
    }
    await waitFor(() => terminations.length === 1);

    expect(providerCloses).toEqual(["premium_provider_output_overflow"]);
    processGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(updates).toBe(0);
  });
});

function createPremiumManifest() {
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
    graph: { nodes: [] },
    budget: { monthlyCapUsd: 100, currentSpendUsd: 0 },
    toolBindings: [],
    agentToolAssignments: [],
  } as unknown as CompiledRuntimeManifest;
}

function createMinimalExecutionHarness(
  runtime: "openai-realtime" | "gemini-live",
  options: {
    connectError?: Error | undefined;
    onTerminate?: ((sessionId: string) => void) | undefined;
    onProviderClose?: ((reason: string) => void) | undefined;
    connectGate?: Promise<void> | undefined;
    providerReady?: Promise<void> | undefined;
    processProviderGate?: Promise<void> | undefined;
    onUpdate?: (() => void) | undefined;
  } = {},
) {
  const manifest = createPremiumManifest();
  const sentProviderMessages: Record<string, unknown>[] = [];
  const registered = {
    organizationId: "tenant-west-africa",
    workspaceId: "workspace-support",
    actorUserId: "pstn:CA-premium",
    session: {
      sessionId: "premium-session-minimal",
      runtime,
      model: runtime === "gemini-live" ? "gemini-live-default" : "gpt-realtime",
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
  const execution = new PstnPremiumCallExecution(
    {
      async getState() {
        return {
          organizationId: "tenant-west-africa",
          connections: [], phoneNumbers: [], healthChecks: [], providerHeartbeats: [],
          dispatches: [{
            id: "dispatch-premium-1",
            tenantId: "tenant-west-africa",
            direction: "inbound",
            disposition: "routed",
            reason: "Live premium route.",
            callSessionId: "CA-premium:telephony",
            publishedVersionId: "workflow-premium-v1",
            workspaceId: "workspace-support",
            runtimeProfile: "premium-realtime",
            runtimePath: "pstn-premium-realtime",
            recording: { enabled: false, consentMode: "disabled", consentMessage: "" },
            recordingConsent: {
              state: "not-required", consentMode: "disabled", message: "",
              noticeRequired: false, updatedAt: "2026-07-11T10:00:00.000Z",
            },
            toPhoneNumber: "+14155557890",
            fromPhoneNumber: "+233201110001",
            createdAt: "2026-07-11T10:00:00.000Z",
            source: "webhook",
          }],
          executionSessions: [], executionCommands: [], webhookEvents: [], callControlEvents: [],
        };
      },
      async recordPstnPhoneTestCheckpoint() {},
    } as never,
    { async getPublishedManifest() { return manifest; } } as never,
    {
      async createRealtimeSession() { return registered.session; },
      getRegisteredSession() { return registered; },
      async processProviderMessage() {
        await options.processProviderGate;
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
  );
  return {
    execution,
    sentProviderMessages,
    emitProviderMessage(message: string) {
      providerMessageHandler?.(message);
    },
    providerClosed() {
      providerCloseHandler?.({ code: 1006, reason: "provider disconnected" });
    },
  };
}

function waitFor(predicate: () => boolean) {
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
