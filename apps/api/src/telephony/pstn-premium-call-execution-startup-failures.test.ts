import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { PstnPremiumCallActor } from "./pstn-premium-call-actor";
import { createMinimalExecutionHarness, waitFor } from "./pstn-premium-call-execution.test-support";

describe("PstnPremiumCallExecution startup-failures", () => {
  it("does not end capacity when installed startup terminal persistence fails", async () => {
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
      const actorStart = vi.spyOn(PstnPremiumCallActor.prototype, "start")
        .mockImplementation(function startWithReadinessFailure(this: PstnPremiumCallActor) {
          this.fail("premium_provider_readiness_failed");
          return Promise.reject(new Error("provider readiness failed"));
        });

      try {
        await expect(harness.execution.start({
          organizationId: "tenant-west-africa",
          dispatchId: "dispatch-premium-1",
          callSessionId: "CA-premium:telephony",
          streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
          output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
        })).rejects.toThrow("terminal lifecycle unavailable");

        expect(terminalAttempts).toBe(1);
        expect(capacityOutcomes).toEqual([]);

        await harness.execution.stop({
          callSessionId: "CA-premium:telephony",
          outcome: "failed",
          reasonCode: "premium_provider_readiness_failed",
        });

        expect(terminalAttempts).toBe(2);
        expect(capacityOutcomes).toEqual(["failed"]);
      } finally {
        actorStart.mockRestore();
      }
    });

  it("retries pre-install terminal persistence through stop without ending capacity early", async () => {
      let terminalAttempts = 0;
      const capacityOutcomes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        connectError: new Error("provider unavailable"),
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
      const startInput = {
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      };

      await expect(harness.execution.start(startInput))
        .rejects.toThrow("terminal lifecycle unavailable");
      expect(terminalAttempts).toBe(1);
      expect(capacityOutcomes).toEqual([]);

      await harness.execution.stop({
        callSessionId: startInput.callSessionId,
        outcome: "failed",
        reasonCode: "premium_provider_start_failed",
      });

      expect(terminalAttempts).toBe(2);
      expect(capacityOutcomes).toEqual(["failed"]);

      await harness.execution.stop({
        callSessionId: startInput.callSessionId,
        outcome: "failed",
        reasonCode: "premium_provider_start_failed",
      });

      expect(terminalAttempts).toBe(2);
      expect(capacityOutcomes).toEqual(["failed"]);
    });

  it("retries pre-install terminal persistence during shutdown", async () => {
      let terminalAttempts = 0;
      const capacityOutcomes: string[] = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        connectError: new Error("provider unavailable"),
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

      await expect(harness.execution.start({
        organizationId: "tenant-west-africa",
        dispatchId: "dispatch-premium-1",
        callSessionId: "CA-premium:telephony",
        streamSid: "MZ-premium-1",
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      })).rejects.toThrow("terminal lifecycle unavailable");

      expect(terminalAttempts).toBe(1);
      expect(capacityOutcomes).toEqual([]);

      await harness.execution.shutdown();

      expect(terminalAttempts).toBe(2);
      expect(capacityOutcomes).toEqual(["failed"]);
    });

  it("rejects stop for a call that was never started", async () => {
      const harness = createMinimalExecutionHarness("openai-realtime");

      await expect(harness.execution.stop({
        callSessionId: "CA-unknown:telephony",
      })).rejects.toThrow(
        "Premium PSTN execution 'CA-unknown:telephony' is not active.",
      );
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
        ownership: { workerId: "premium-worker-a", ownerEpoch: 1 },
        output: { sendMedia() {}, clearAudio() {}, sendMark() {}, close() {} },
      })).rejects.toThrow(sensitive);

      expect(log.mock.calls.flat().join(" ")).not.toContain(sensitive);
      expect(log.mock.calls.flat().join(" ")).toContain("premium_provider_start_failed");
      log.mockRestore();
    });

  it("observes privacy-safe normalized OpenAI turn lifecycle events without provider-controlled content", async () => {
      const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const sensitive = "raw caller transcript and provider secret";
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
      harness.emitProviderMessage(JSON.stringify({
        type: "input_audio_buffer.speech_started",
        transcript: sensitive,
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "error",
        error: { message: sensitive },
      }));

      await waitFor(() => observed.some((event) => event.type === "premium.interruption"));
      expect(observed.find((event) => event.type === "premium.interruption")?.payload).toMatchObject({
        realtimeProvider: "openai-realtime",
        realtimeModel: "gpt-realtime",
        conversationPolicyVersion: 1,
        mediaProfile: "pstn",
        playbackCleared: false,
        truncationCount: 0,
        acknowledgedAudioMs: 0,
      });
      expect(JSON.stringify({ observed, logs: log.mock.calls })).not.toContain(sensitive);

      await harness.execution.stop({ callSessionId: "CA-premium:telephony" });
      log.mockRestore();
    });

  it("fails both call legs when OpenAI emits a protocol error", async () => {
      const sensitive = "caller transcript and provider secret";
      const logs = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const terminatedSessionIds: string[] = [];
      const providerCloses: string[] = [];
      const callerCloses: string[] = [];
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const harness = createMinimalExecutionHarness("openai-realtime", {
        onTerminate: (sessionId) => terminatedSessionIds.push(sessionId),
        onProviderClose: (reason) => providerCloses.push(reason),
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
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "invalid_value",
          message: sensitive,
          param: "response.instructions",
          event_id: "zara_response_create_initial_greeting",
        },
      }));

      await waitFor(() => callerCloses.length === 1);
      expect(terminatedSessionIds).toEqual(["premium-session-minimal"]);
      expect(providerCloses).toEqual(["premium_provider_protocol_error"]);
      expect(callerCloses).toEqual(["premium_provider_protocol_error"]);
      expect(observed).toContainEqual(expect.objectContaining({
        type: "provider.failure",
        payload: expect.objectContaining({
          code: "premium_provider_protocol_error",
          providerErrorCode: "invalid_value",
          providerErrorType: "invalid_request_error",
          providerErrorParam: "response.instructions",
          providerEventId: "zara_response_create_initial_greeting",
          recoverable: false,
        }),
      }));
      expect(JSON.stringify({ logs: logs.mock.calls, observed })).not.toContain(sensitive);
      logs.mockRestore();
    });

  it("fails both call legs when an OpenAI response terminates as failed", async () => {
      const callerCloses: string[] = [];
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
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
        type: "response.created",
        response: { id: "response-failed-1" },
      }));
      harness.emitProviderMessage(JSON.stringify({
        type: "response.done",
        response: {
          id: "response-failed-1",
          status: "failed",
          status_details: {
            type: "failed",
            error: { type: "server_error", code: "provider_overloaded", message: "sensitive" },
          },
        },
      }));

      await waitFor(() => callerCloses.length === 1);
      expect(callerCloses).toEqual(["premium_provider_response_failed"]);
      expect(observed).toContainEqual(expect.objectContaining({
        type: "provider.failure",
        payload: expect.objectContaining({
          code: "premium_provider_response_failed",
          providerErrorCode: "provider_overloaded",
          providerErrorType: "server_error",
        }),
      }));
      expect(JSON.stringify(observed)).not.toContain("sensitive");
    });
});
