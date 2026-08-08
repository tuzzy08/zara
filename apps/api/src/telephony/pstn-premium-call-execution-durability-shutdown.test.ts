import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { createPremiumCallRuntimeContext, createMinimalExecutionHarness, premiumInboundFrame, waitFor, deferred } from "./pstn-premium-call-execution.test-support";

describe("PstnPremiumCallExecution durability-shutdown", () => {
  it("carries the immutable worker ownership fence through every lifecycle mutation", async () => {
      const lifecycleMutations: Array<{
        stage: string;
        ownership?: { workerId: string; ownerEpoch: number };
      }> = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        async recordLifecycle(_stage, input) {
          lifecycleMutations.push(input);
        },
      });

      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });
      await harness.execution.stop({
        callSessionId: "CA-premium:telephony",
        outcome: "completed",
        reasonCode: "twilio_stop",
      });

      expect(lifecycleMutations.length).toBeGreaterThan(0);
      expect(lifecycleMutations).toEqual(
        lifecycleMutations.map((mutation) => ({
          ...mutation,
          ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        })),
      );
    });

  it("keeps a completed execution retryable until its terminal lifecycle is durable", async () => {
      let terminalAttempts = 0;
      const capacityOutcomes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        async recordLifecycle(stage) {
          if (stage !== "completed") return;
          terminalAttempts += 1;
          if (terminalAttempts === 1) {
            throw new Error("terminal lifecycle unavailable");
          }
        },
        capacityObservability: {
          endCall(input) { capacityOutcomes.push(input.outcome); },
        },
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });

      await expect(harness.execution.stop({
        callSessionId: "CA-premium:telephony",
      })).rejects.toThrow("terminal lifecycle unavailable");

      expect(terminalAttempts).toBe(1);
      expect(capacityOutcomes).toEqual([]);

      await harness.execution.stop({
        callSessionId: "CA-premium:telephony",
      });

      expect(terminalAttempts).toBe(2);
      expect(harness.lifecycleStages).toEqual([
        "provider-ready",
        "active",
        "draining",
        "completed",
        "completed",
      ]);
      expect(capacityOutcomes).toEqual(["completed"]);
      await expect(harness.execution.appendInboundFrame({
        callSessionId: "CA-premium:telephony",
        frame: premiumInboundFrame(1),
      })).resolves.toEqual({ accepted: false, reason: "terminal" });
    });

  it("retries terminal lifecycle persistence without another caller action", async () => {
      vi.useFakeTimers();
      try {
        let terminalAttempts = 0;
        const finalizationOutcomes: string[] = [];
        const harness = createMinimalExecutionHarness("openai-realtime", {
          async recordLifecycle(stage) {
            if (stage !== "completed") return;
            terminalAttempts += 1;
            if (terminalAttempts === 1) {
              throw new Error("terminal lifecycle unavailable");
            }
          },
          capacityObservability: {
            recordFinalization(input) {
              finalizationOutcomes.push(input.outcome);
            },
          },
        });
        await harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
          ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
        });

        await expect(harness.execution.stop({
          callSessionId: "CA-premium:telephony",
        })).rejects.toThrow("terminal lifecycle unavailable");

        expect(terminalAttempts).toBe(1);
        expect(finalizationOutcomes).toEqual(["retry_scheduled"]);

        await vi.advanceTimersByTimeAsync(1_000);

        expect(terminalAttempts).toBe(2);
        expect(finalizationOutcomes).toEqual(["retry_scheduled", "persisted"]);
        await expect(harness.execution.appendInboundFrame({
          callSessionId: "CA-premium:telephony",
          frame: premiumInboundFrame(1),
        })).resolves.toEqual({ accepted: false, reason: "terminal" });
      } finally {
        vi.useRealTimers();
      }
    });

  it("bounds terminal persistence retries and reports exhaustion", async () => {
      vi.useFakeTimers();
      try {
        let terminalAttempts = 0;
        const finalizationOutcomes: string[] = [];
        const harness = createMinimalExecutionHarness("openai-realtime", {
          async recordLifecycle(stage) {
            if (stage !== "failed") return;
            terminalAttempts += 1;
            throw new Error("terminal lifecycle unavailable");
          },
          capacityObservability: {
            recordFinalization(input) {
              finalizationOutcomes.push(input.outcome);
            },
          },
        });
        await harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
          ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
        });

        await expect(harness.execution.stop({
          callSessionId: "CA-premium:telephony",
          outcome: "failed",
          reasonCode: "provider_failed",
        })).rejects.toThrow("terminal lifecycle unavailable");

        await vi.advanceTimersByTimeAsync(3_000);

        expect(terminalAttempts).toBe(3);
        expect(finalizationOutcomes).toEqual([
          "retry_scheduled",
          "retry_scheduled",
          "exhausted",
        ]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(terminalAttempts).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

  it("does not report a non-terminal ignored lifecycle result as persisted", async () => {
      vi.useFakeTimers();
      try {
        let terminalAttempts = 0;
        const finalizationOutcomes: string[] = [];
        const capacityOutcomes: string[] = [];
        const harness = createMinimalExecutionHarness("openai-realtime", {
          async recordLifecycle(stage) {
            if (stage !== "failed") return;
            terminalAttempts += 1;
            return {
              outcome: "ignored" as const,
              context: createPremiumCallRuntimeContext(),
            };
          },
          capacityObservability: {
            endCall(input) {
              capacityOutcomes.push(input.outcome);
            },
            recordFinalization(input) {
              finalizationOutcomes.push(input.outcome);
            },
          },
        });
        await harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
          ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
        });

        await expect(harness.execution.stop({
          callSessionId: "CA-premium:telephony",
          outcome: "failed",
          reasonCode: "provider_failed",
        })).rejects.toThrow("did not persist a terminal lifecycle");
        await vi.advanceTimersByTimeAsync(3_000);

        expect(terminalAttempts).toBe(3);
        expect(finalizationOutcomes).toEqual([
          "retry_scheduled",
          "retry_scheduled",
          "exhausted",
        ]);
        expect(capacityOutcomes).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

  it("accepts an already-terminal ignored lifecycle result as durable", async () => {
      const capacityOutcomes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        async recordLifecycle(stage) {
          if (stage !== "completed") return;
          return {
            outcome: "ignored" as const,
            context: {
              ...createPremiumCallRuntimeContext(),
              status: "terminated" as const,
              lifecycleState: {
                stage: "failed" as const,
                observedAt: "2026-07-26T20:00:00.000Z",
                reasonCode: "provider_failed",
              },
            },
          };
        },
        capacityObservability: {
          endCall(input) {
            capacityOutcomes.push(input.outcome);
          },
        },
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });

      await harness.execution.stop({
        callSessionId: "CA-premium:telephony",
      });

      expect(capacityOutcomes).toEqual(["failed"]);
    });

  it("retries terminal persistence before worker shutdown returns", async () => {
      vi.useFakeTimers();
      try {
        let terminalAttempts = 0;
        const capacityOutcomes: string[] = [];
        const harness = createMinimalExecutionHarness("openai-realtime", {
          async recordLifecycle(stage) {
            if (stage !== "failed") return;
            terminalAttempts += 1;
            if (terminalAttempts === 1) {
              throw new Error("terminal lifecycle unavailable");
            }
          },
          capacityObservability: {
            endCall(input) { capacityOutcomes.push(input.outcome); },
          },
        });
        await harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
          ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
        });

        const shutdown = harness.execution.shutdown();
        await vi.advanceTimersByTimeAsync(1_000);
        await shutdown;

        expect(terminalAttempts).toBe(2);
        expect(harness.lifecycleStages).toEqual([
          "provider-ready",
          "active",
          "failed",
          "failed",
        ]);
        expect(capacityOutcomes).toEqual(["failed"]);
      } finally {
        vi.useRealTimers();
      }
    });

  it("classifies an abnormal Twilio media close as failed", async () => {
      const harness = createMinimalExecutionHarness("openai-realtime");
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });

      await harness.execution.stop({
        callSessionId: "CA-premium:telephony",
        outcome: "failed",
        reasonCode: "twilio_media_socket_closed_1006",
      });

      expect(harness.lifecycleStages).toEqual(["provider-ready", "active", "failed"]);
    });

  it("does not install an execution when Twilio closes during provider startup", async () => {
      const connectGate = deferred<void>();
      const terminatedSessionIds: string[] = [];
      const providerCloses: string[] = [];
      const capacityOutcomes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        connectGate: connectGate.promise,
        onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
        onProviderClose: (reason) => {
          providerCloses.push(reason);
          throw new Error("provider close failed");
        },
        capacityObservability: {
          endCall(input) { capacityOutcomes.push(input.outcome); },
        },
      });
      const starting = harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });
      await Promise.resolve();

      let stopResolved = false;
      const stopping = harness.execution
        .stop({ callSessionId: "CA-premium:telephony" })
        .then(() => {
          stopResolved = true;
        });
      await Promise.resolve();

      expect(stopResolved).toBe(false);
      connectGate.resolve();
      await Promise.all([starting, stopping]);

      expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
      expect(providerCloses).toEqual(["pstn_stream_stopped"]);
      expect(harness.lifecycleStages).toEqual(["completed"]);
      expect(capacityOutcomes).toEqual(["completed"]);
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
      })).resolves.toEqual({ accepted: false, reason: "terminal" });
    });

  it("does not install an execution when application shutdown starts during provider startup", async () => {
      const connectGate = deferred<void>();
      const terminatedSessionIds: string[] = [];
      const providerCloses: string[] = [];
      const capacityOutcomes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        connectGate: connectGate.promise,
        onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
        onProviderClose: (reason) => providerCloses.push(reason),
        capacityObservability: {
          endCall(input) { capacityOutcomes.push(input.outcome); },
        },
      });
      const starting = harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });
      await Promise.resolve();

      let shutdownResolved = false;
      const shuttingDown = harness.execution.shutdown().then(() => {
        shutdownResolved = true;
      });
      await Promise.resolve();

      expect(shutdownResolved).toBe(false);
      connectGate.resolve();
      await Promise.all([starting, shuttingDown]);

      expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
      expect(providerCloses).toEqual(["app_shutdown"]);
      expect(harness.lifecycleStages).toEqual(["failed"]);
      expect(capacityOutcomes).toEqual(["failed"]);
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
      })).resolves.toEqual({ accepted: false, reason: "terminal" });
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
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
      })).resolves.toEqual({ accepted: false, reason: "terminal" });
    });

  it("fails when serialized provider output exceeds its bounded ingress ledger", async () => {
      const processGate = deferred<void>();
      const terminations: string[] = [];
      const providerCloses: string[] = [];
      let updates = 0;
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const queueDrops: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        processProviderGate: processGate.promise,
        onTerminate: (sessionId) => terminations.push(sessionId),
        onProviderClose: (reason) => providerCloses.push(reason),
        onUpdate: () => { updates += 1; },
        onObservedEvent: (event) => observed.push(event),
        capacityObservability: {
          recordQueueDrop(input: { queue: string; reason: string }) {
            queueDrops.push(`${input.queue}:${input.reason}`);
          },
        },
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });
      const message = JSON.stringify({
        type: "response.done",
        padding: "x".repeat(1_024),
        response: { id: "response-control-pressure", status: "completed", output: [] },
      });

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
      expect(queueDrops).toContain("tool_handoff:overflow");
      processGate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(updates).toBe(0);
    });

  it("keeps realtime audio off the tool and handoff control queue", async () => {
      const processGate = deferred<void>();
      const processedMessages: string[] = [];
      const terminations: string[] = [];
      const providerCloses: string[] = [];
      let sentMediaFrames = 0;
      const harness = createMinimalExecutionHarness("openai-realtime", {
        processProviderGate: async (rawProviderMessage) => {
          processedMessages.push(rawProviderMessage);
          await processGate.promise;
        },
        onTerminate: (sessionId) => terminations.push(sessionId),
        onProviderClose: (reason) => providerCloses.push(reason),
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() { sentMediaFrames += 1; },
          clearAudio() {},
          sendMark() {},
          close() {},
        },
      });

      const responseCreated = JSON.stringify({
        type: "response.created",
        response: { id: "response-audio-burst", status: "in_progress" },
      });
      harness.emitProviderMessage(responseCreated);
      await waitFor(() => processedMessages.length === 1);

      for (let index = 0; index < 70; index += 1) {
        harness.emitProviderMessage(JSON.stringify({
          type: "response.output_audio.delta",
          response_id: "response-audio-burst",
          item_id: "assistant-item-audio-burst",
          content_index: 0,
          delta: Buffer.alloc(1_024, index).toString("base64"),
        }));
      }

      await waitFor(() => sentMediaFrames > 0);
      await new Promise((resolve) => setTimeout(resolve, 25));
      processGate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(terminations).toEqual([]);
      expect(providerCloses).toEqual([]);
      expect(processedMessages).toEqual([responseCreated]);

      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
    });

  it("retries phone-test checkpoints without terminating or blocking premium media", async () => {
      const terminations: string[] = [];
      const providerCloses: string[] = [];
      const checkpointAttempts: string[] = [];
      let sentMediaFrames = 0;
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onTerminate: (sessionId) => terminations.push(sessionId),
        onProviderClose: (reason) => providerCloses.push(reason),
        async recordCheckpoint(checkpoint) {
          checkpointAttempts.push(checkpoint);
          if (checkpointAttempts.length === 1) {
            throw new Error("checkpoint database temporarily unavailable");
          }
        },
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: {
          sendMedia() { sentMediaFrames += 1; },
          clearAudio() {},
          sendMark() {},
          close() {},
        },
      });

      harness.emitProviderMessage(JSON.stringify({
        type: "response.created",
        response: { id: "response-checkpoint", status: "in_progress" },
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.output_audio.delta",
        response_id: "response-checkpoint",
        item_id: "assistant-item-checkpoint",
        content_index: 0,
        delta: Buffer.alloc(160, 0xff).toString("base64"),
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.output_audio_transcript.done",
        response_id: "response-checkpoint",
        transcript: "Hello from the configured assistant.",
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.output_audio_transcript.done",
        response_id: "response-checkpoint",
        transcript: "Hello from the configured assistant.",
      }));

      await waitFor(() => checkpointAttempts.length === 2);

      expect(sentMediaFrames).toBe(1);
      expect(checkpointAttempts).toEqual([
        "agentResponseGenerated",
        "agentResponseGenerated",
      ]);
      expect(terminations).toEqual([]);
      expect(providerCloses).toEqual([]);

      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
    });

  it("includes the terminal failure code in premium cleanup logs", async () => {
      const cleanupLog = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const terminations: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onTerminate: (sessionId) => terminations.push(sessionId),
      });
      await harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      });

      harness.providerClosed();
      await waitFor(() => terminations.length === 1);
      await waitFor(() => cleanupLog.mock.calls.some(([message]) =>
        typeof message === "string" && message.includes("premium_cleanup"),
      ));

      expect(cleanupLog).toHaveBeenCalledWith(expect.stringMatching(
        /premium_cleanup .*"reason":"failed".*"failureCode":"premium_provider_closed"/,
      ));
    });
});
