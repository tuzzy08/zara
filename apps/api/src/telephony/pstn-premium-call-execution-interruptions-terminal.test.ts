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

describe("PstnPremiumCallExecution interruptions-terminal", () => {
  it("processes caller interruption without waiting for connector work", async () => {
      const connectorGate = deferred<void>();
      let clearCount = 0;
      let outputFrameCount = 0;
      const harness = createMinimalExecutionHarness("openai-realtime", {
        processProviderGate: (rawProviderMessage) => rawProviderMessage.includes("zendesk_search")
          ? connectorGate.promise
          : Promise.resolve(),
      });

      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() { outputFrameCount += 1; },
          clearAudio() { clearCount += 1; },
          sendMark() {},
          close() {},
        },
      });
      harness.emitProviderMessage(JSON.stringify({
        type: "response.created",
        response: { id: "response-before-tool" },
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-before-tool",
        item_id: "item-before-tool",
        content_index: 0,
        delta: Buffer.alloc(160, 0xff).toString("base64"),
      }));
      await waitFor(() => outputFrameCount === 1);
      harness.emitProviderMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "tool-response-1",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "provider-call-1",
            name: "zendesk_search",
            arguments: "{}",
          }],
        },
      }));
      harness.emitProviderMessage(JSON.stringify({ type: "input_audio_buffer.speech_started" }));

      await waitFor(() => clearCount === 1);
      connectorGate.resolve();
      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
    });

  it("keeps delayed response media ordered ahead of a later caller interruption", async () => {
      const connectorGate = deferred<void>();
      let clearCount = 0;
      let outputFrameCount = 0;
      const harness = createMinimalExecutionHarness("openai-realtime", {
        processProviderGate: (rawProviderMessage) => rawProviderMessage.includes("zendesk_search")
          ? connectorGate.promise
          : Promise.resolve(),
      });

      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() { outputFrameCount += 1; },
          clearAudio() { clearCount += 1; },
          sendMark() {},
          close() {},
        },
      });
      harness.emitProviderMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "tool-response-1",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "provider-call-1",
            name: "zendesk_search",
            arguments: "{}",
          }],
        },
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.created",
        response: { id: "response-before-interruption" },
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-before-interruption",
        item_id: "item-before-interruption",
        content_index: 0,
        delta: Buffer.alloc(160, 0xff).toString("base64"),
      }));
      harness.emitProviderMessage(JSON.stringify({ type: "input_audio_buffer.speech_started" }));

      await waitFor(() => outputFrameCount === 1 && clearCount === 1);
      connectorGate.resolve();
      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
      expect(outputFrameCount).toBe(1);
    });

  it("logs privacy-safe provider and Twilio media milestones once", async () => {
      const logs = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const marks: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime");

      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() {}, clearAudio() {}, sendMark(name) { marks.push(name); }, close() {},
        },
      });
      await waitFor(() => harness.sentProviderMessages.some((message) => message.type === "response.create"));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.created",
        response: { id: "response-1" },
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-1",
        item_id: "item-1",
        content_index: 0,
        delta: Buffer.alloc(160, 0xff).toString("base64"),
      }));
      await waitFor(() => marks.length > 0);
      harness.execution.acknowledgePlaybackMark({
        callSessionId: "CA-premium:telephony",
        name: marks[0]!,
      });

      await waitFor(() => {
        const text = logs.mock.calls.flat().join(" ");
        return text.includes('"milestone":"provider_ready"')
          && text.includes('"milestone":"response_started"')
          && text.includes('"milestone":"provider_audio_received"')
          && text.includes('"milestone":"twilio_media_sent"')
          && text.includes('"milestone":"twilio_mark_acknowledged"');
      });
      const text = logs.mock.calls.flat().join(" ");
      for (const milestone of [
        "provider_ready",
        "response_started",
        "provider_audio_received",
        "twilio_media_sent",
        "twilio_mark_acknowledged",
      ]) {
        expect(text.match(new RegExp(`\\"milestone\\":\\"${milestone}\\"`, "g"))).toHaveLength(1);
      }
      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
      logs.mockRestore();
    });

  it("fails a stalled initial response without issuing a duplicate response request", async () => {
      vi.useFakeTimers();
      const providerCloses: string[] = [];
      const callerCloses: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onProviderClose: (reason) => providerCloses.push(reason),
      });

      try {
        await harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: {
            sendMedia() {}, clearAudio() {}, sendMark() {},
            close(_code, reason) { callerCloses.push(reason); },
          },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(harness.sentProviderMessages.filter((message) => message.type === "response.create")).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(8_000);
        expect(harness.sentProviderMessages.filter((message) => message.type === "response.create")).toHaveLength(1);
        expect(providerCloses).toEqual(["premium_provider_response_timeout"]);
        expect(callerCloses).toEqual(["premium_provider_response_timeout"]);
      } finally {
        vi.useRealTimers();
      }
    });

  it("does not treat response allocation without audio as response progress", async () => {
      vi.useFakeTimers();
      const callerCloses: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime");

      try {
        await harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: {
            sendMedia() {}, clearAudio() {}, sendMark() {},
            close(_code, reason) { callerCloses.push(reason); },
          },
        });
        await vi.advanceTimersByTimeAsync(0);
        harness.emitProviderMessage(JSON.stringify({
          type: "response.created",
          response: { id: "response-without-audio" },
        }));
        await vi.advanceTimersByTimeAsync(0);

        await vi.advanceTimersByTimeAsync(8_000);
        expect(callerCloses).toEqual(["premium_provider_response_timeout"]);
      } finally {
        vi.useRealTimers();
      }
    });

  it("preserves the structured reason when an OpenAI response is incomplete", async () => {
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const callerCloses: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onObservedEvent: (event) => observed.push(event),
      });

      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() {}, clearAudio() {}, sendMark() {},
          close(_code, reason) { callerCloses.push(reason); },
        },
      });
      harness.emitProviderMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "response-incomplete-1",
          status: "incomplete",
          status_details: { type: "incomplete", reason: "max_output_tokens" },
        },
      }));

      await waitFor(() => callerCloses.length === 1);
      expect(callerCloses).toEqual(["premium_provider_response_incomplete"]);
      expect(observed).toContainEqual(expect.objectContaining({
        type: "provider.failure",
        payload: expect.objectContaining({
          code: "premium_provider_response_incomplete",
          providerErrorType: "incomplete",
          providerErrorReason: "max_output_tokens",
        }),
      }));
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
      await waitFor(() => harness.lifecycleStages.length === 3);
      expect(harness.lifecycleStages).toEqual(["provider-ready", "active", "failed"]);
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() {}, clearAudio() {}, sendMark() {},
          close(_code, reason) { callerCloses.push(reason); },
        },
      });

      await harness.execution.shutdown();
      await harness.execution.shutdown();

      expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
      expect(callerCloses).toEqual(["app_shutdown"]);
      expect(providerCloses).toEqual(["app_shutdown"]);
      expect(harness.lifecycleStages).toEqual(["provider-ready", "active", "failed"]);
    });

  it("uses the drain deadline reason when forced to stop an active actor", async () => {
      const providerCloses: string[] = [];
      const callerCloses: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onProviderClose: (reason) => providerCloses.push(reason),
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() {}, clearAudio() {}, sendMark() {},
          close(_code, reason) { callerCloses.push(reason); },
        },
      });

      await harness.execution.shutdown({
        reasonCode: "worker_drain_deadline",
        forcedCallCount: 1,
      });

      expect(callerCloses).toEqual(["worker_drain_deadline"]);
      expect(providerCloses).toEqual(["worker_drain_deadline"]);
      expect(harness.lifecycleStages).toEqual(["provider-ready", "active", "failed"]);
    });
});
