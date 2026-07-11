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
    const checkpoints: string[] = [];
    let providerMessageHandler: ((message: string) => void) | undefined;
    let providerCloseHandler: ((event: { code: number; reason: string }) => void) | undefined;
    let connectedMediaProfile: string | undefined;
    let cleared = 0;
    let providerClosed = false;
    let terminatedRuntimeSessionId: string | undefined;
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
      sendMark() {},
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
            send(message: Record<string, unknown>) {
              sentProviderMessages.push(message);
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

    expect(sentProviderMessages[0]).toMatchObject({ type: "input_audio_buffer.append" });
    expect(Buffer.from(String(sentProviderMessages[0]?.audio), "base64")).toHaveLength(960);
    expect(connectedMediaProfile).toBe("pstn");

    providerMessageHandler?.(JSON.stringify({
      type: "response.output_audio.delta",
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
      type: "input_audio_buffer.speech_started",
      audio_start_ms: 20,
    }));
    await waitFor(() => cleared === 1);

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
      async processProviderMessage() { return { packet: registered.packet, providerMessages: [] }; },
      updateRegisteredSession() {},
      terminateRealtimeSession(sessionId: string) { options.onTerminate?.(sessionId); },
    } as never,
    {
      async connect() {
        if (options.connectError !== undefined) {
          throw options.connectError;
        }
        return {
          send(message: Record<string, unknown>) { sentProviderMessages.push(message); },
          close() {},
          onMessage() {},
          onClose() {},
        };
      },
    },
  );
  return { execution, sentProviderMessages };
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
