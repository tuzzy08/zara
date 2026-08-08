import { describe, expect, it, vi } from "vitest";
import type { CompiledRuntimeManifest, PstnAudioFrame } from "@zara/core";
import { Logger } from "@nestjs/common";
import type { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";
import { PstnPremiumCallActor } from "./pstn-premium-call-actor";
import {
  computeTelephonyPremiumDispatchSnapshotChecksum,
} from "./telephony-incremental.repository";
import {
  PstnPremiumCallExecution,
  type PstnPremiumCallOutput,
} from "./pstn-premium-call-execution";
import { createPremiumDispatchSnapshot, createPremiumManifest, createPremiumCallRuntimeContext, createMinimalExecutionHarness, createTestControlMessage, createHandoffExecutionHarness, createHandoffRegisteredSession, createFakeProviderConnection, createOpenAiReplacementResult, premiumInboundFrame, openAiPstnProviderConfig, geminiPstnProviderConfig, waitFor, deferred } from "./pstn-premium-call-execution.test-support";

describe("PstnPremiumCallExecution media-provider", () => {
  it("streams Twilio mu-law media through the OpenAI premium session and returns PSTN-ready audio", async () => {
      const manifest = createPremiumManifest();
      const sentProviderMessages: Record<string, unknown>[] = [];
      const outboundFrames: PstnAudioFrame[] = [];
      const playbackMarks: string[] = [];
      const checkpoints: string[] = [];
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      let providerMessageHandler: ((message: string) => void) | undefined;
      let providerCloseHandler: ((event: { code: number; reason: string }) => void) | undefined;
      let connectedMediaProfile: string | undefined;
      let cleared = 0;
      let providerClosed = false;
      let terminatedRuntimeSessionId: string | undefined;
      const capacityEvents: string[] = [];
      const providerReady = deferred<void>();
      const registered = {
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-support",
        actorUserId: "pstn:CA-premium",
        session: {
          sessionId: "premium-session-1",
          runtime: "openai-realtime",
          model: "gpt-realtime",
          providerConfig: openAiPstnProviderConfig("gpt-realtime"),
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
          async loadPstnCallRuntimeContext() {
            return {
              outcome: "found",
              context: createPremiumCallRuntimeContext(),
            };
          },
          async recordPstnPhoneTestCheckpoint(input: { checkpoint: string }) {
            checkpoints.push(input.checkpoint);
          },
          async recordPstnCallLifecycle() {
            return {
              outcome: "applied" as const,
              context: createPremiumCallRuntimeContext(),
            };
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
          async createRealtimeSession() {
            throw new Error("Mutable runtime policy must not be read by a PSTN worker.");
          },
          async createRealtimeSessionFromSnapshot() {
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
            connectedMediaProfile = input.session.providerConfig.mediaProfile;
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
        {
          async recordPstnCall(input: { events: Array<{ type: string; payload: Record<string, unknown> }> }) {
            observed.push(...input.events);
            return { exportedSpanCount: 0, langsmithExported: false, warnings: [], metrics: {} };
          },
        } as never,
        {
          trackCall(input: { state: string }) { capacityEvents.push(`call:${input.state}`); },
          endCall(input: { outcome: string }) { capacityEvents.push(`end:${input.outcome}`); },
          openSocket(input: { leg: string }) { capacityEvents.push(`socket:${input.leg}`); },
          updateSocketContext() {},
          recordSocketHandshake(input: { outcome: string }) {
            capacityEvents.push(`handshake:${input.outcome}`);
          },
          recordSocketTraffic() {},
          recordSocketBuffered() {},
          closeSocket() {},
          recordQueue(input: { queue: string }) { capacityEvents.push(`queue:${input.queue}`); },
          recordQueueDrop() {},
          clearCallQueues() {},
        } as never,
      );

      await execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
        item_id: "assistant-item-1",
        content_index: 0,
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
      execution.acknowledgePlaybackMark({
        callSessionId: "CA-premium:telephony",
        name: playbackMarks[0]!,
      });

      providerMessageHandler?.(JSON.stringify({
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 20,
      }));
      providerMessageHandler?.(JSON.stringify({
        type: "response.cancelled",
        response: { id: "response-1", status: "cancelled" },
      }));
      await waitFor(() => cleared === 1);
      expect(sentProviderMessages.at(-1)).toEqual({
        type: "conversation.item.truncate",
        item_id: "assistant-item-1",
        content_index: 0,
        audio_end_ms: 20,
      });
      await waitFor(() => observed.some((event) => event.type === "premium.interruption"));
      expect(observed.find((event) => event.type === "premium.interruption")?.payload).toMatchObject({
        playbackCleared: true,
        truncationCount: 1,
        acknowledgedAudioMs: 20,
      });

      providerMessageHandler?.(JSON.stringify({
        type: "response.created",
        response: { id: "response-2", status: "in_progress" },
      }));
      providerMessageHandler?.(JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-1",
        item_id: "assistant-item-1",
        content_index: 0,
        delta: Buffer.alloc(160, 0xee).toString("base64"),
      }));
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(outboundFrames).toHaveLength(1);

      providerMessageHandler?.(JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-2",
        item_id: "assistant-item-2",
        content_index: 0,
        delta: Buffer.alloc(160, 0xdd).toString("base64"),
      }));
      await waitFor(() => outboundFrames.length === 2);
      expect(outboundFrames[1]!.payloadBase64).toBe(Buffer.alloc(160, 0xdd).toString("base64"));

      await execution.stop({ callSessionId: "CA-premium:telephony" });
      expect(providerClosed).toBe(true);
      expect(terminatedRuntimeSessionId).toBe("premium-session-1");
      expect(capacityEvents).toEqual(expect.arrayContaining([
        "call:starting",
        "socket:provider",
        "handshake:accepted",
        "call:active",
        "queue:provider_output",
        "queue:twilio_playback",
        "call:draining",
        "end:completed",
      ]));
      providerCloseHandler?.({ code: 1000, reason: "done" });
    });

  it("uses Gemini Live audio framing when platform policy selects Gemini", async () => {
      const { execution, sentProviderMessages } = createMinimalExecutionHarness("gemini-live");
      await execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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

  it("attaches the redacted resolved premium session contract to observability events", async () => {
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onObservedEvent(event) { observed.push(event); },
      });

      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });
      await waitFor(() => observed.some((event) => event.type === "premium.readiness"));

      expect(observed.find((event) => event.type === "premium.readiness")?.payload).toMatchObject({
        realtimeProvider: "openai-realtime",
        realtimeModel: "gpt-realtime",
        conversationPolicyVersion: 1,
        mediaProfile: "pstn",
      });
      expect(JSON.stringify(observed)).not.toMatch(/prompt|transcript|credential|token|apiKey/i);
      await waitFor(() => harness.lifecycleStages.length === 2);
      expect(harness.lifecycleStages).toEqual(["provider-ready", "active"]);

      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
      expect(harness.lifecycleStages).toEqual([
        "provider-ready",
        "active",
        "draining",
        "completed",
      ]);
    });

  it("accounts for the actual resident Gemini provider payload while startup is pending", async () => {
      const ready = deferred<void>();
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const harness = createMinimalExecutionHarness("gemini-live", {
        providerReady: ready.promise,
        onObservedEvent(event) { observed.push(event); },
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });

      await harness.execution.appendInboundFrame({
        callSessionId: "CA-premium:telephony",
        frame: premiumInboundFrame(1),
      });
      const pressure = observed.find((event) => event.type === "premium.pressure");
      const residentBytes = pressure?.payload["ingressDepthBytes"];
      expect(residentBytes).toEqual(expect.any(Number));
      expect(residentBytes).toBeGreaterThan(160);

      ready.resolve();
      await waitFor(() => harness.sentProviderMessages.length >= 1);
      expect(residentBytes).toBe(Buffer.byteLength(
        JSON.stringify(harness.sentProviderMessages[0]),
        "utf8",
      ));
    });

  it("ignores later Twilio media after terminal cleanup without repeating failure work", async () => {
      const harness = createMinimalExecutionHarness("openai-realtime");
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });
      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });

      await expect(harness.execution.appendInboundFrame({
        callSessionId: "CA-premium:telephony",
        frame: premiumInboundFrame(2),
      })).resolves.toEqual({ accepted: false, reason: "terminal" });
      await expect(harness.execution.appendInboundFrame({
        callSessionId: "CA-premium:telephony",
        frame: premiumInboundFrame(3),
      })).resolves.toEqual({ accepted: false, reason: "terminal" });
    });

  it("fails closed when Gemini emits audio outside its declared PCM contract", async () => {
      const harness = createMinimalExecutionHarness("gemini-live");
      const callerCloses: string[] = [];
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
      const failedHandshakes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        connectError: new Error("provider unavailable"),
        onTerminate(sessionId) {
          terminatedSessionIds.push(sessionId);
        },
        capacityObservability: {
          recordSocketHandshakeAttempt(input: { outcome: string }) {
            failedHandshakes.push(input.outcome);
          },
        },
      });

      await expect(harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      })).rejects.toThrow("provider unavailable");
      expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
      expect(failedHandshakes).toEqual(["failed"]);
      expect(harness.lifecycleStages).toEqual(["failed"]);
    });
});
