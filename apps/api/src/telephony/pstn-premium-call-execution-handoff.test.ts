import { describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { createTestControlMessage, createHandoffExecutionHarness, createOpenAiReplacementResult, premiumInboundFrame, waitFor, deferred } from "./pstn-premium-call-execution.test-support";

describe("PstnPremiumCallExecution handoff", () => {
  it("waits for acknowledged source playback before replacing an immutable OpenAI voice session", async () => {
      const handoffLog = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const targetReady = deferred<void>();
      const harness = createHandoffExecutionHarness({
        targetReady: targetReady.promise,
        processProviderMessage(rawProviderMessage, registered) {
          if (rawProviderMessage !== createTestControlMessage("test.handoff")) {
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
        item_id: "assistant-item-source",
        content_index: 0,
        delta: Buffer.alloc(160, 0xff).toString("base64"),
      }));
      harness.connections[0]!.emitMessage(JSON.stringify({
        type: "response.output_audio.done",
        response_id: "response-source",
      }));
      await waitFor(() => harness.marks.length === 2);

      harness.connections[0]!.emitMessage(createTestControlMessage("test.handoff"));
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
      expect(harness.lifecycleStages).toEqual([
        "provider-ready",
        "active",
        "handoff",
        "active",
      ]);
      handoffLog.mockRestore();
    });

  it("buffers target-native caller media during an OpenAI to Gemini handoff and ignores stale source callbacks", async () => {
      const targetReady = deferred<void>();
      const observed: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const harness = createHandoffExecutionHarness({
        targetReady: targetReady.promise,
        onObservedEvent(event) { observed.push(event); },
        processProviderMessage(rawProviderMessage, registered) {
          if (rawProviderMessage !== createTestControlMessage("test.handoff.cross-provider")) {
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
      source.emitMessage(createTestControlMessage("test.handoff.cross-provider"));
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
        expect.objectContaining({
          type: "premium.handoff",
          payload: expect.objectContaining({ phase: "started" }),
        }),
        expect.objectContaining({
          type: "premium.handoff",
          payload: expect.objectContaining({
            phase: "completed",
            handoffDurationMs: expect.any(Number),
          }),
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
          if (rawProviderMessage !== createTestControlMessage("test.handoff.failure")) {
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
      harness.connections[0]!.emitMessage(createTestControlMessage("test.handoff.failure"));
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
            if (rawProviderMessage !== createTestControlMessage("test.handoff.timeout")) {
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
        harness.connections[0]!.emitMessage(createTestControlMessage("test.handoff.timeout"));
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
          return rawProviderMessage === createTestControlMessage("test.handoff.actor-overflow")
            ? createOpenAiReplacementResult(registered, "actor-overflow")
            : { packet: registered.packet, providerMessages: [] };
        },
      });
      await harness.start();
      harness.connections[0]!.emitMessage(createTestControlMessage("test.handoff.actor-overflow"));
      await waitFor(() => harness.connections.length === 2);

      for (let sequence = 1; sequence <= 262; sequence += 1) {
        await harness.execution.appendInboundFrame({
          callSessionId: "CA-premium:telephony",
          frame: premiumInboundFrame(sequence),
        });
      }
      await expect(harness.execution.appendInboundFrame({
        callSessionId: "CA-premium:telephony",
        frame: premiumInboundFrame(263),
      })).rejects.toThrow("premium_handoff_overflow");

      expect(harness.connections[1]!.closedReasons).toEqual(["provider_handoff_cancelled"]);
    });

  it("closes a pending replacement during application shutdown", async () => {
      const targetReady = deferred<void>();
      const harness = createHandoffExecutionHarness({
        targetReady: targetReady.promise,
        processProviderMessage(rawProviderMessage, registered) {
          return rawProviderMessage === createTestControlMessage("test.handoff.shutdown")
            ? createOpenAiReplacementResult(registered, "shutdown")
            : { packet: registered.packet, providerMessages: [] };
        },
      });
      await harness.start();
      harness.connections[0]!.emitMessage(createTestControlMessage("test.handoff.shutdown"));
      await waitFor(() => harness.connections.length === 2);

      await harness.execution.shutdown();

      expect(harness.connections[1]!.closedReasons).toEqual(["provider_handoff_cancelled"]);
    });
});
