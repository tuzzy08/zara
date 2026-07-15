import { describe, expect, it, vi } from "vitest";
import type { CompiledRuntimeManifest, PstnAudioFrame } from "@zara/core";
import { Logger } from "@nestjs/common";

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
    await waitFor(() => sentProviderMessages.length === 2);
    expect(sentProviderMessages[0]).toMatchObject({ type: "input_audio_buffer.append" });
    expect(sentProviderMessages[0]?.audio).toBe(Buffer.alloc(160, 0xff).toString("base64"));
    expect(sentProviderMessages[1]).toMatchObject({
      type: "response.create",
      response: {
        instructions: expect.stringContaining(
          'Begin with exactly: "Hello, this is Jane from Tuzzy Labs. How may I help you today?"',
        ),
      },
    });
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

    await waitFor(() => sentProviderMessages.length === 2);
    const audioMessage = sentProviderMessages.find((message) =>
      (message.realtimeInput as { audio?: unknown } | undefined)?.audio !== undefined);
    const greetingMessage = sentProviderMessages.find((message) =>
      (message.realtimeInput as { text?: unknown } | undefined)?.text !== undefined);
    expect(audioMessage).toMatchObject({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
    const audio = (audioMessage?.realtimeInput as { audio: { data: string } }).audio.data;
    expect(Buffer.from(audio, "base64")).toHaveLength(640);
    expect(greetingMessage).toMatchObject({
      realtimeInput: {
        text: expect.stringContaining(
          'Begin with exactly: "Hello, this is Jane from Tuzzy Labs. How may I help you today?"',
        ),
      },
    });
  });

  it("fails closed instead of using a fallback when the initial agent identity is unavailable", async () => {
    const callerCloses: string[] = [];
    const invalidManifest = {
      ...createPremiumManifest(),
      graph: { id: "workflow-premium", name: "Premium support", nodes: [], edges: [] },
    } as CompiledRuntimeManifest;
    const { execution } = createMinimalExecutionHarness("openai-realtime", {
      manifest: invalidManifest,
    });

    await execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {},
        clearAudio() {},
        sendMark() {},
        close(_code, reason) { callerCloses.push(reason); },
      },
    });

    await waitFor(() => callerCloses.length === 1);
    expect(callerCloses).toEqual(["premium_initial_agent_identity_unavailable"]);
  });

  it("fails both call legs when the initial greeting cannot be sent", async () => {
    const callerCloses: string[] = [];
    const providerCloses: string[] = [];
    const terminatedSessions: string[] = [];
    const { execution } = createMinimalExecutionHarness("openai-realtime", {
      sendError: new Error("provider socket write failed"),
      onProviderClose: (reason) => providerCloses.push(reason),
      onTerminate: (sessionId) => terminatedSessions.push(sessionId),
    });

    await execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {},
        clearAudio() {},
        sendMark() {},
        close(_code, reason) { callerCloses.push(reason); },
      },
    });

    await waitFor(() => callerCloses.length === 1);
    expect(callerCloses).toEqual(["premium_provider_send_failed"]);
    expect(providerCloses).toEqual(["premium_provider_send_failed"]);
    expect(terminatedSessions).toEqual(["premium-session-minimal"]);
  });

  it("frames Gemini 24 kHz PCM output into deterministic Twilio PCMU playback", async () => {
    const harness = createMinimalExecutionHarness("gemini-live");
    const outboundFrames: PstnAudioFrame[] = [];
    const marks: string[] = [];
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia(frame) { outboundFrames.push(frame); },
        clearAudio() {},
        sendMark(name) { marks.push(name); },
        close() {},
      },
    });

    harness.emitProviderMessage(JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [{
            inlineData: {
              data: Buffer.alloc(1_920, 0).toString("base64"),
              mimeType: "audio/pcm;rate=24000",
            },
          }],
        },
      },
    }));
    await waitFor(() => outboundFrames.length === 2);

    expect(outboundFrames.map((frame) => Buffer.from(frame.payloadBase64, "base64").length))
      .toEqual([160, 160]);
    expect(outboundFrames.map((frame) => frame.timestampMs)).toEqual([20, 40]);
    expect(marks).toHaveLength(2);

    harness.emitProviderMessage(JSON.stringify({
      serverContent: { turnComplete: true },
    }));
    await waitFor(() => marks.length === 3);
    expect(marks[2]).toContain("boundary");
  });

  it("uses shared playback interruption ownership for Gemini turns", async () => {
    const harness = createMinimalExecutionHarness("gemini-live");
    const outboundFrames: PstnAudioFrame[] = [];
    const marks: string[] = [];
    let clears = 0;
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia(frame) { outboundFrames.push(frame); },
        clearAudio() { clears += 1; },
        sendMark(name) { marks.push(name); },
        close() {},
      },
    });
    const audioMessage = JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [{
            inlineData: {
              data: Buffer.alloc(960, 0).toString("base64"),
              mimeType: "audio/pcm;rate=24000",
            },
          }],
        },
      },
    });

    harness.emitProviderMessage(audioMessage);
    await waitFor(() => outboundFrames.length === 1);
    const staleMark = marks[0]!;
    harness.emitProviderMessage(JSON.stringify({ serverContent: { interrupted: true } }));
    await waitFor(() => clears === 1);
    harness.execution.acknowledgePlaybackMark({
      callSessionId: "CA-premium:telephony",
      name: staleMark,
    });

    harness.emitProviderMessage(audioMessage);
    harness.emitProviderMessage(JSON.stringify({ serverContent: { turnComplete: true } }));
    await waitFor(() => outboundFrames.length === 2 && marks.length === 3);
    expect(clears).toBe(1);
    expect(marks[2]).toContain("boundary");
  });

  it("fails closed when Gemini emits audio outside its declared PCM contract", async () => {
    const harness = createMinimalExecutionHarness("gemini-live");
    const callerCloses: string[] = [];
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {},
        clearAudio() {},
        sendMark() {},
        close(_code, reason) { callerCloses.push(reason); },
      },
    });

    harness.emitProviderMessage(JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [{
            inlineData: {
              data: Buffer.alloc(960, 0).toString("base64"),
              mimeType: "audio/mpeg",
            },
          }],
        },
      },
    }));

    await waitFor(() => callerCloses.length === 1);
    expect(callerCloses).toEqual(["premium_gemini_output_format_invalid"]);
  });

  it("emits redacted bounded premium readiness pressure playback interruption and cleanup facts", async () => {
    const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const harness = createMinimalExecutionHarness("gemini-live", {
      onObservedEvent(event) { observed.push(event); },
    });
    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    });
    await harness.execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: premiumInboundFrame(1),
    });
    harness.emitProviderMessage(JSON.stringify({
      serverContent: {
        modelTurn: { parts: [{ inlineData: {
          data: Buffer.alloc(960, 0).toString("base64"), mimeType: "audio/pcm;rate=24000",
        } }] },
      },
    }));
    harness.emitProviderMessage(JSON.stringify({ serverContent: { interrupted: true } }));
    await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
    await waitFor(() => observed.some((event) => event.type === "premium.cleanup"));

    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "premium.readiness", payload: expect.objectContaining({ provider: "gemini-live" }) }),
      expect.objectContaining({ type: "premium.pressure", payload: expect.objectContaining({ ingressDepthBytes: expect.any(Number) }) }),
      expect.objectContaining({ type: "premium.playback", payload: expect.objectContaining({
        outstandingPlaybackMarks: expect.any(Number),
        outboundQueuedFrames: expect.any(Number),
        playbackGeneration: expect.any(Number),
        playbackLagMs: expect.any(Number),
        acknowledgedBoundaries: expect.any(Number),
      }) }),
      expect.objectContaining({ type: "premium.interruption", payload: expect.objectContaining({ playbackCleared: true }) }),
      expect.objectContaining({ type: "premium.cleanup" }),
    ]));
    const interruption = observed.find((event) => event.type === "premium.interruption");
    expect(interruption?.payload["staleGenerationDiscarded"]).not.toBe(true);
    expect(JSON.stringify(observed)).not.toContain("Caller asked about billing");
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

  it("never writes provider-controlled startup error text to logs", async () => {
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const sensitive = "wss://provider.example?api_key=secret raw caller payload";
    const { execution } = createMinimalExecutionHarness("openai-realtime", {
      connectError: new Error(sensitive),
    });

    await expect(execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    })).rejects.toThrow(sensitive);

    expect(log.mock.calls.flat().join(" ")).not.toContain(sensitive);
    expect(log.mock.calls.flat().join(" ")).toContain("premium_provider_start_failed");
    log.mockRestore();
  });

  it("logs privacy-safe OpenAI turn lifecycle events without provider-controlled content", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const sensitive = "raw caller transcript and provider secret";
    const harness = createMinimalExecutionHarness("openai-realtime");

    await harness.execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
    });
    harness.emitProviderMessage(JSON.stringify({
      type: "input_audio_buffer.speech_stopped",
      transcript: sensitive,
    }));
    harness.emitProviderMessage(JSON.stringify({
      type: "error",
      error: { message: sensitive },
    }));

    await waitFor(() => log.mock.calls.flat().join(" ").includes("premium_provider_turn_event"));
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain("input_audio_buffer.speech_stopped");
    expect(output).toContain('"eventType":"error"');
    expect(output).toContain('"callSessionId":"CA-premium:telephony"');
    expect(output).not.toContain(sensitive);

    await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
    log.mockRestore();
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
    const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      providerReady: providerReady.promise,
      onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
      onObservedEvent: (event) => observed.push(event),
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

    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "premium.readiness",
        payload: expect.objectContaining({
          ready: false,
          readinessLatencyMs: expect.any(Number),
          code: "premium_provider_readiness_failed",
        }),
      }),
      expect.objectContaining({
        type: "provider.failure",
        payload: expect.objectContaining({ code: "premium_provider_readiness_failed" }),
      }),
    ]));

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
    const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const harness = createMinimalExecutionHarness("openai-realtime", {
      processProviderGate: processGate.promise,
      onTerminate: (sessionId) => terminations.push(sessionId),
      onProviderClose: (reason) => providerCloses.push(reason),
      onUpdate: () => { updates += 1; },
      onObservedEvent: (event) => observed.push(event),
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

    expect(observed.filter((event) => event.type === "premium.pressure")).toEqual(
      expect.arrayContaining([expect.objectContaining({ payload: expect.objectContaining({
        providerOutputDepthBytes: expect.any(Number),
        providerOutputDepthCount: expect.any(Number),
      }) })]),
    );

    expect(providerCloses).toEqual(["premium_provider_output_overflow"]);
    processGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(updates).toBe(0);
  });

  it("waits for acknowledged source playback before replacing an immutable OpenAI voice session", async () => {
    const handoffLog = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const targetReady = deferred<void>();
    const harness = createHandoffExecutionHarness({
      targetReady: targetReady.promise,
      processProviderMessage(rawProviderMessage, registered) {
        if (rawProviderMessage !== JSON.stringify({ type: "test.handoff" })) {
          return { packet: registered.packet, providerMessages: [] };
        }
        const targetSession = {
          ...registered.session,
          activeAgentId: "agent-james",
          toolDeclarations: [],
        };
        return {
          session: targetSession,
          activeAgentId: "agent-james",
          packet: registered.packet,
          providerMessages: [],
          providerSessionTransition: {
            requiresReplacement: true,
            sourceResponseId: "response-source",
            source: {
              agentId: "agent-jane",
              runtime: "openai-realtime",
              model: "gpt-realtime",
              realtimeVoiceConfig: { provider: "openai-realtime", voice: "marin" },
            },
            target: {
              agentId: "agent-james",
              runtime: "openai-realtime",
              model: "gpt-realtime",
              realtimeVoiceConfig: { provider: "openai-realtime", voice: "cedar" },
              toolDeclarations: [],
            },
            transfer: {
              id: "transfer-voice",
              reason: "Caller needs billing support.",
              callerNeedSummary: "Caller needs billing support.",
            },
            continuation: { instruction: "Continue as James without repeating the handoff announcement." },
          },
        };
      },
    });
    await harness.start();
    harness.connections[0]!.emitMessage(JSON.stringify({
      type: "response.created",
      response: { id: "response-source", status: "in_progress" },
    }));
    harness.connections[0]!.emitMessage(JSON.stringify({
      type: "response.output_audio.delta",
      response_id: "response-source",
      delta: Buffer.alloc(160, 0xff).toString("base64"),
    }));
    harness.connections[0]!.emitMessage(JSON.stringify({
      type: "response.output_audio.done",
      response_id: "response-source",
    }));
    await waitFor(() => harness.marks.length === 2);

    harness.connections[0]!.emitMessage(JSON.stringify({ type: "test.handoff" }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(harness.connections).toHaveLength(1);

    for (const mark of [...harness.marks]) {
      harness.execution.acknowledgePlaybackMark({
        callSessionId: "CA-premium:telephony",
        name: mark,
      });
    }
    await waitFor(() => harness.connections.length === 2);
    expect(harness.connections[0]!.closedReasons).toEqual([]);

    targetReady.resolve();
    await waitFor(() => harness.connections[1]!.sent.length === 1);
    expect(harness.connections[1]!.sent).toEqual([
      {
        type: "response.create",
        response: { instructions: "Continue as James without repeating the handoff announcement." },
      },
    ]);
    expect(harness.connections[0]!.closedReasons).toEqual(["provider_agent_handoff"]);
    expect(handoffLog).toHaveBeenCalledWith(expect.stringContaining("agent.handoff.completed"));
    handoffLog.mockRestore();
  });

  it("buffers target-native caller media during an OpenAI to Gemini handoff and ignores stale source callbacks", async () => {
    const targetReady = deferred<void>();
    const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const harness = createHandoffExecutionHarness({
      targetReady: targetReady.promise,
      onObservedEvent(event) { observed.push(event); },
      processProviderMessage(rawProviderMessage, registered) {
        if (rawProviderMessage !== JSON.stringify({ type: "test.handoff.cross-provider" })) {
          return { packet: registered.packet, providerMessages: [] };
        }
        const targetSession = {
          ...registered.session,
          runtime: "gemini-live" as const,
          model: "gemini-live-billing",
          activeAgentId: "agent-james",
          toolDeclarations: [],
        };
        return {
          session: targetSession,
          activeAgentId: "agent-james",
          packet: registered.packet,
          providerMessages: [],
          providerSessionTransition: {
            requiresReplacement: true,
            source: { agentId: "agent-jane", runtime: "openai-realtime", model: "gpt-realtime" },
            target: {
              agentId: "agent-james",
              runtime: "gemini-live",
              model: "gemini-live-billing",
              toolDeclarations: [],
            },
            transfer: {
              id: "transfer-provider",
              reason: "Caller needs billing support.",
              callerNeedSummary: "Caller needs billing support.",
            },
            continuation: { instruction: "Continue as James with the transferred caller context." },
          },
        };
      },
    });
    await harness.start();
    const source = harness.connections[0]!;
    source.emitMessage(JSON.stringify({ type: "test.handoff.cross-provider" }));
    await waitFor(() => harness.connections.length === 2);

    await harness.execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: premiumInboundFrame(1),
    });
    expect(source.sent).toEqual([
      expect.objectContaining({ type: "response.create" }),
    ]);
    expect(harness.connections[1]!.sent).toEqual([]);

    targetReady.resolve();
    await waitFor(() => harness.connections[1]!.sent.length === 2);
    expect(harness.connections[1]!.sent[0]).toEqual({
      realtimeInput: { text: "Continue as James with the transferred caller context." },
    });
    expect(harness.connections[1]!.sent[1]).toMatchObject({
      realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000" } },
    });
    expect(JSON.stringify(harness.connections[1]!.sent)).not.toContain("function_call_output");

    source.emitMessage(JSON.stringify({
      type: "response.created",
      response: { id: "stale-response", status: "in_progress" },
    }));
    source.emitClose();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(harness.callerCloses).toEqual([]);
    expect(harness.connections).toHaveLength(2);
    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "premium.handoff", payload: { phase: "started" } }),
      expect.objectContaining({
        type: "premium.handoff",
        payload: { phase: "completed", handoffDurationMs: expect.any(Number) },
      }),
    ]));
  });

  it("fails closed when a replacement provider session never becomes ready", async () => {
    const targetReady = deferred<void>();
    const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const harness = createHandoffExecutionHarness({
      targetReady: targetReady.promise,
      onObservedEvent: (event) => observed.push(event),
      processProviderMessage(rawProviderMessage, registered) {
        if (rawProviderMessage !== JSON.stringify({ type: "test.handoff.failure" })) {
          return { packet: registered.packet, providerMessages: [] };
        }
        const targetSession = {
          ...registered.session,
          activeAgentId: "agent-james",
        };
        return {
          session: targetSession,
          activeAgentId: "agent-james",
          packet: registered.packet,
          providerMessages: [],
          providerSessionTransition: {
            requiresReplacement: true,
            source: { agentId: "agent-jane", runtime: "openai-realtime", model: "gpt-realtime" },
            target: {
              agentId: "agent-james",
              runtime: "openai-realtime",
              model: "gpt-realtime",
              toolDeclarations: [],
            },
            transfer: {
              id: "transfer-failure",
              reason: "Caller needs billing support.",
              callerNeedSummary: "Caller needs billing support.",
            },
            continuation: { instruction: "Continue as James." },
          },
        };
      },
    });
    await harness.start();
    harness.connections[0]!.emitMessage(JSON.stringify({ type: "test.handoff.failure" }));
    await waitFor(() => harness.connections.length === 2);

    targetReady.reject(new Error("target setup failed"));
    await waitFor(() => harness.callerCloses.length === 1);

    expect(harness.callerCloses).toEqual(["premium_provider_handoff_failed"]);
    expect(harness.connections[1]!.closedReasons).toEqual(["premium_provider_handoff_failed"]);
    expect(harness.connections).toHaveLength(2);
    expect(observed).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "premium.handoff",
      payload: expect.objectContaining({
        phase: "failed",
        code: "premium_provider_handoff_failed",
        handoffDurationMs: expect.any(Number),
      }),
    })]));
  });

  it("fails a provider transition that exceeds its bounded deadline", async () => {
    vi.useFakeTimers();
    try {
      const targetReady = deferred<void>();
      const harness = createHandoffExecutionHarness({
        targetReady: targetReady.promise,
        processProviderMessage(rawProviderMessage, registered) {
          if (rawProviderMessage !== JSON.stringify({ type: "test.handoff.timeout" })) {
            return { packet: registered.packet, providerMessages: [] };
          }
          return {
            session: { ...registered.session, activeAgentId: "agent-james" },
            activeAgentId: "agent-james",
            packet: registered.packet,
            providerMessages: [],
            providerSessionTransition: {
              requiresReplacement: true,
              source: { agentId: "agent-jane", runtime: "openai-realtime", model: "gpt-realtime" },
              target: {
                agentId: "agent-james",
                runtime: "openai-realtime",
                model: "gpt-realtime",
                toolDeclarations: [],
              },
              transfer: {
                id: "transfer-timeout",
                reason: "Caller needs billing support.",
                callerNeedSummary: "Caller needs billing support.",
              },
              continuation: { instruction: "Continue as James." },
            },
          };
        },
      });
      await harness.start();
      harness.connections[0]!.emitMessage(JSON.stringify({ type: "test.handoff.timeout" }));
      await Promise.resolve();
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(5_001);

      expect(harness.callerCloses).toEqual(["premium_provider_handoff_timeout"]);
      expect(harness.connections[1]!.closedReasons).toEqual(["premium_provider_handoff_timeout"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a pending replacement when handoff media overflows inside the actor", async () => {
    const targetReady = deferred<void>();
    const harness = createHandoffExecutionHarness({
      targetReady: targetReady.promise,
      processProviderMessage(rawProviderMessage, registered) {
        return rawProviderMessage === JSON.stringify({ type: "test.handoff.actor-overflow" })
          ? createOpenAiReplacementResult(registered, "actor-overflow")
          : { packet: registered.packet, providerMessages: [] };
      },
    });
    await harness.start();
    harness.connections[0]!.emitMessage(JSON.stringify({ type: "test.handoff.actor-overflow" }));
    await waitFor(() => harness.connections.length === 2);

    for (let sequence = 1; sequence <= 50; sequence += 1) {
      await harness.execution.appendInboundFrame({
        callSessionId: "CA-premium:telephony",
        frame: premiumInboundFrame(sequence),
      });
    }
    await expect(harness.execution.appendInboundFrame({
      callSessionId: "CA-premium:telephony",
      frame: premiumInboundFrame(51),
    })).rejects.toThrow("premium_handoff_overflow");

    expect(harness.connections[1]!.closedReasons).toEqual(["provider_handoff_cancelled"]);
  });

  it("closes a pending replacement during application shutdown", async () => {
    const targetReady = deferred<void>();
    const harness = createHandoffExecutionHarness({
      targetReady: targetReady.promise,
      processProviderMessage(rawProviderMessage, registered) {
        return rawProviderMessage === JSON.stringify({ type: "test.handoff.shutdown" })
          ? createOpenAiReplacementResult(registered, "shutdown")
          : { packet: registered.packet, providerMessages: [] };
      },
    });
    await harness.start();
    harness.connections[0]!.emitMessage(JSON.stringify({ type: "test.handoff.shutdown" }));
    await waitFor(() => harness.connections.length === 2);

    await harness.execution.onApplicationShutdown();

    expect(harness.connections[1]!.closedReasons).toEqual(["provider_handoff_cancelled"]);
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

function createMinimalExecutionHarness(
  runtime: "openai-realtime" | "gemini-live",
  options: {
    connectError?: Error | undefined;
    onTerminate?: ((sessionId: string) => void) | undefined;
    onProviderClose?: ((reason: string) => void) | undefined;
    connectGate?: Promise<void> | undefined;
    providerReady?: Promise<void> | undefined;
    processProviderGate?: Promise<void> | undefined;
    sendError?: Error | undefined;
    manifest?: CompiledRuntimeManifest | undefined;
    onUpdate?: (() => void) | undefined;
    onObservedEvent?: ((event: { type: string; payload: Record<string, unknown> }) => void) | undefined;
  } = {},
) {
  const manifest = options.manifest ?? createPremiumManifest();
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

function createHandoffExecutionHarness(input: {
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
    start: () => execution.start({
      organizationId: "tenant-west-africa",
      dispatchId: "dispatch-premium-1",
      callSessionId: "CA-premium:telephony",
      streamSid: "MZ-premium-1",
      output: {
        sendMedia() {},
        clearAudio() {},
        sendMark(name) { marks.push(name); },
        close(_code, reason) { callerCloses.push(reason); },
      },
    }),
  };
}

function createHandoffRegisteredSession(manifest = createPremiumManifest()) {
  return {
    organizationId: "tenant-west-africa",
    workspaceId: "workspace-support",
    actorUserId: "pstn:CA-premium",
    session: {
      sessionId: "premium-session-handoff",
      runtime: "openai-realtime" as const,
      model: "gpt-realtime",
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

function createFakeProviderConnection(ready: Promise<void>) {
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

function createOpenAiReplacementResult(
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

function premiumInboundFrame(sequence: number): PstnAudioFrame {
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
