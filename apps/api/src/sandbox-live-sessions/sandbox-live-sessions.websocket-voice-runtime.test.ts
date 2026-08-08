import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { type SandwichTextModelProvider } from "@zara/core";
import WebSocket from "ws";
import { IntegrationsModule } from "../integrations/integrations.module";
import { SandboxLiveSessionsModule } from "./sandbox-live-sessions.module";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { runtimeObservabilityRecorderToken } from "../runtime-observability/runtime-observability";
import { createTestingApplication, seedSandboxIntegrationState, getListeningPort, readPayloadString, nextMatchingMessage, nextOpen, settle, withTimeout, nextClose, sendVoiceTurn, createCompiledManifest, createConditionAgentRouteManifestWithStaleBillingSnapshot, createFakeTextModelProvider, createTextModelProviderWithAvailability, createFakeTtsProvider, createDelayedAudioTtsProvider, createFakeSttProvider, createStreamingFakeSttProvider, createDuplicateFinalStreamingSttProvider, createScriptedStreamingSttProvider, createFailingStreamingSttProvider, createCartesiaLifecycleStreamingSttProvider } from "./sandbox-live-sessions.websocket.test-support";

describe("Sandbox live session websocket voice-runtime", () => {
  const sockets: WebSocket[] = [];

  const originalIntegrationStateDir = process.env.ZARA_INTEGRATION_STATE_DIR;

  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  const originalAssemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY;

  const originalCartesiaApiKey = process.env.CARTESIA_API_KEY;

  beforeEach(() => {
      const integrationStateDir = join(
        tmpdir(),
        "zara-sandbox-tool-grants",
        randomUUID(),
      );
      process.env.ZARA_INTEGRATION_STATE_DIR = integrationStateDir;
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.ASSEMBLYAI_API_KEY = "test-assemblyai-key";
      process.env.CARTESIA_API_KEY = "test-cartesia-key";
      seedSandboxIntegrationState(integrationStateDir);
    });

  afterEach(() => {
      while (sockets.length > 0) {
        const socket = sockets.pop();
        socket?.close();
      }

      if (originalIntegrationStateDir === undefined) {
        delete process.env.ZARA_INTEGRATION_STATE_DIR;
      } else {
        process.env.ZARA_INTEGRATION_STATE_DIR = originalIntegrationStateDir;
      }

      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }

      if (originalAssemblyAiApiKey === undefined) {
        delete process.env.ASSEMBLYAI_API_KEY;
      } else {
        process.env.ASSEMBLYAI_API_KEY = originalAssemblyAiApiKey;
      }

      if (originalCartesiaApiKey === undefined) {
        delete process.env.CARTESIA_API_KEY;
      } else {
        process.env.CARTESIA_API_KEY = originalCartesiaApiKey;
      }
    });

  it("runs a voice turn through routing, model, and audio events", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );
      const latencyEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.latency.measured",
      );
      const timestampEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.audio.timestamps",
      );

      sendVoiceTurn(socket, "I need help with billing", { callPhase: "discovery" });

      const completedEvent = await withTimeout(completedEventPromise, "voice completed event");
      const latencyEvent = await withTimeout(latencyEventPromise, "voice latency event");
      const timestampEvent = await withTimeout(timestampEventPromise, "voice timestamp event");
      const replayResponse = await request(app.getHttpServer())
        .get(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}`);

      expect(completedEvent).toMatchObject({
        sessionId,
        type: "turn.completed",
        payload: {
          transcript: "I need help with billing",
          responseText: "Billing support is ready to help with that request.",
        },
      });
      expect(timestampEvent).toMatchObject({
        sessionId,
        type: "turn.audio.timestamps",
        payload: {
          wordTimestamps: [
            {
              word: "Billing",
              start: 0,
              end: 0.4,
            },
          ],
        },
      });
      expect(latencyEvent).toMatchObject({
        sessionId,
        type: "turn.latency.measured",
        payload: {
          stage: "first_audio",
        },
      });
      const latencyPayload = latencyEvent.payload as Record<string, unknown>;
      expect(typeof latencyPayload.totalLatencyMs).toBe("number");
      expect(latencyPayload.totalLatencyMs).toBeGreaterThanOrEqual(0);
      expect(latencyPayload.ttsFirstByteLatencyMs).toBe(120);
      expect(replayResponse.status).toBe(200);

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("records runtime observability without failing the turn when LangSmith export fails", async () => {
      let observedTurn: Record<string, unknown> | undefined;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider(runtimeObservabilityRecorderToken)
        .useValue({
          async recordTurn(input: Record<string, unknown>) {
            observedTurn = input;
            return {
              exportedSpanCount: 12,
              langsmithExported: false,
              warnings: [
                {
                  code: "langsmith.export_failed",
                  message: "LangSmith unavailable",
                  recoverable: true,
                },
              ],
              metrics: {
                langsmithExportFailureCount: 1,
                spanExportFailureCount: 0,
                droppedSpanCount: 0,
              },
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );
      const warningEventPromise = nextMatchingMessage(
        socket,
        (event) =>
          event.type === "runtime.warning"
          && (event.payload as Record<string, unknown>).code === "langsmith.export_failed",
      );
      const metricsEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "runtime.observability",
      );

      sendVoiceTurn(socket, "I need help with billing", { callPhase: "discovery" });

      const completedEvent = await withTimeout(completedEventPromise, "observed voice completed event");
      const warningEvent = await withTimeout(warningEventPromise, "observability warning event");
      const metricsEvent = await withTimeout(metricsEventPromise, "observability metrics event");

      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "Billing support is ready to help with that request.",
        },
      });
      expect(observedTurn).toMatchObject({
        traceId: expect.stringContaining(sessionId),
        manifest: expect.objectContaining({
          manifestId: expect.any(String),
        }),
        packet: expect.objectContaining({
          ids: expect.objectContaining({
            callSessionId: sessionId,
          }),
        }),
        model: expect.objectContaining({
          provider: "openai-chat",
          tier: "cheap",
        }),
        tts: expect.objectContaining({
          provider: "cartesia-sonic-3",
        }),
      });
      expect(warningEvent).toMatchObject({
        type: "runtime.warning",
        payload: expect.objectContaining({
          code: "langsmith.export_failed",
          recoverable: true,
        }),
      });
      expect(metricsEvent).toMatchObject({
        type: "runtime.observability",
        payload: expect.objectContaining({
          exportedSpanCount: 12,
          langsmithExported: false,
          metrics: {
            langsmithExportFailureCount: 1,
            spanExportFailureCount: 0,
            droppedSpanCount: 0,
          },
        }),
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("routes billing turns through condition routes before responding with the target agent", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider("fr"))
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);
            yield "Billing support is ready to help with that request.";
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createConditionAgentRouteManifestWithStaleBillingSnapshot("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const handoffEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "agent.handoff.completed",
      );
      const transcribedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.transcribed",
      );
      const modelTelemetryEventPromise = nextMatchingMessage(
        socket,
        (event) => {
          const payload = event.payload as Record<string, unknown>;
          return event.type === "provider.telemetry" && payload.stage === "model";
        },
      );
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Please route this to the right specialist.", { callPhase: "discovery", intent: "billing" });

      const handoffEvent = await withTimeout(handoffEventPromise, "handoff event");
      const transcribedEvent = await withTimeout(transcribedEventPromise, "handoff transcribed event");
      const modelTelemetryEvent = await withTimeout(modelTelemetryEventPromise, "handoff model telemetry event");
      await withTimeout(completedEventPromise, "handoff turn completed");

      expect(handoffEvent).toMatchObject({
        sessionId,
        type: "agent.handoff.completed",
        payload: {
          sourceAgentId: "agent-front-desk",
          targetAgentId: "agent-billing",
          targetAgentName: "Billing specialist",
        },
      });
      expect(modelInputs[0]?.activeAgent.agentId).toBe("agent-billing");
      expect(modelInputs[0]?.activeAgent.modelProvider).toBe("openai");
      expect(modelInputs[0]?.context.language).toBe("fr");
      expect(transcribedEvent).toMatchObject({
        payload: {
          language: "fr",
        },
      });
      expect(modelTelemetryEvent).toMatchObject({
        payload: {
          provider: "openai-chat",
        },
      });
      expect(modelInputs[0]?.agentContext?.transfer).toEqual({
        fromAgentName: "Front desk triage",
        reason: "Direct route from Front desk triage to Billing specialist.",
        callerNeedSummary: "Please route this to the right specialist.",
      });
      expect(modelInputs[0]?.agentContext?.intent).toMatchObject({
        intentKey: "billing",
        label: "Billing",
        confidence: 1,
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("streams audio chunks to the websocket before the full TTS stream completes", async () => {
      let releaseSecondAudioChunk = () => {};
      const secondAudioChunkGate = new Promise<void>((resolve) => {
        releaseSecondAudioChunk = resolve;
      });
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createDelayedAudioTtsProvider(secondAudioChunkGate))
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const firstChunkPromise = nextMatchingMessage(
        socket,
        (event) =>
          event.type === "turn.audio.chunk"
          && (event.payload as Record<string, unknown>).chunkIndex === 0,
      );
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "I need help with billing", { callPhase: "discovery" });

      const chunkBeforeCompletion = await Promise.race([
        firstChunkPromise.then(() => "chunk"),
        new Promise<"missing">((resolve) => setTimeout(() => resolve("missing"), 50)),
      ]);
      expect(chunkBeforeCompletion).toBe("chunk");

      const completedBeforeRelease = await Promise.race([
        completedEventPromise.then(() => "completed"),
        new Promise<"still-running">((resolve) => setTimeout(() => resolve("still-running"), 0)),
      ]);
      expect(completedBeforeRelease).toBe("still-running");

      releaseSecondAudioChunk();
      const completedEvent = await withTimeout(completedEventPromise, "delayed audio completed event");

      expect(completedEvent).toMatchObject({
        sessionId,
        type: "turn.completed",
        payload: {
          audioChunkCount: 2,
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("turns committed voice audio into transcript and response events", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("voice-frame-1", "utf8").toString("base64"),
        }),
      );
      socket.send(
        JSON.stringify({
          type: "input.audio.commit",
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const completedEvent = await withTimeout(completedEventPromise, "voice completed event");

      expect(completedEvent).toMatchObject({
        sessionId,
        type: "turn.completed",
        payload: {
          transcript: "I need help with billing",
          responseText: "Billing support is ready to help with that request.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("runs a voice turn automatically when streaming STT detects the end of a caller turn", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("I need help with billing", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const completedEvent = await withTimeout(completedEventPromise, "automatic voice completed event");

      expect(completedEvent).toMatchObject({
        sessionId,
        type: "turn.completed",
        payload: {
          transcript: "I need help with billing",
          responseText: "Billing support is ready to help with that request.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("blocks live voice sessions when the platform default text model provider is not configured", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createTextModelProviderWithAvailability({
          openai: {
            configured: false,
            missingEnv: ["OPENAI_API_KEY"],
          },
        }))
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const manifest = createCompiledManifest("workspace-default");
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      expect(createResponse.status).toBe(409);
      expect(createResponse.body.message).toContain("OpenAI text model is not configured");
      expect(createResponse.body.message).toContain("OPENAI_API_KEY");

      await app.close();
    }, 60_000);

  it("keeps one streaming STT session open across follow-up caller turns after endpointing", async () => {
      const sttProvider = createStreamingFakeSttProvider();
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(sttProvider)
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const firstCompletedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("I need help with billing", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      await withTimeout(firstCompletedEventPromise, "first automatic voice completed event");
      expect(sttProvider.sessions).toHaveLength(1);
      const secondCompletedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed" && typeof event.sequence === "number" && event.sequence > 1,
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("I need help with billing", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const secondCompletedEvent = await withTimeout(
        secondCompletedEventPromise,
        "second automatic voice completed event",
      );

      expect(secondCompletedEvent).toMatchObject({
        sessionId,
        type: "turn.completed",
        payload: {
          transcript: "I need help with billing",
        },
      });
      const secondPayload = secondCompletedEvent.payload as Record<string, unknown>;
      expect(typeof secondPayload.responseText).toBe("string");
      expect(String(secondPayload.responseText).length).toBeGreaterThan(0);
      expect(sttProvider.sessions).toHaveLength(1);
      expect(sttProvider.sessions[0]?.forceEndpointCount).toBe(0);
      expect(sttProvider.sessions[0]?.terminateCount).toBe(0);

      socket.close();
      await nextClose(socket);
      await settle();
      expect(sttProvider.sessions[0]?.terminateCount).toBe(1);
      await app.close();
    }, 20_000);

  it("ignores duplicate streaming STT finals while a voice turn is already in flight", async () => {
      const sttProvider = createDuplicateFinalStreamingSttProvider();
      let modelCallCount = 0;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(sttProvider)
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText() {
            modelCallCount += 1;
            await settle();
            yield "I found the first transcript and will respond once.";
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("duplicate-final-frame", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      await withTimeout(completedEventPromise, "deduplicated voice completed event");
      await settle();
      unsubscribe();

      expect(modelCallCount).toBe(1);
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "provider.telemetry",
          payload: expect.objectContaining({
            stage: "stt",
            event: "final_ignored_in_flight",
          }),
        }),
      );

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("trusts AssemblyAI provider finals without local phrase deferral", async () => {
      const sttProvider = createScriptedStreamingSttProvider([
        {
          partial: "I have a pending ticket with regards to",
          final: "I have a pending ticket with regards to",
        },
      ]);
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(sttProvider)
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);
            yield "I can help with your account activation ticket.";
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();

      const completedEventPromise = nextMatchingMessage(socket, (event) => event.type === "turn.completed");
      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("assemblyai-final-frame", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const completedEvent = await withTimeout(
        completedEventPromise,
        "AssemblyAI provider-final turn completed",
      );
      await settle();
      unsubscribe();

      expect(modelInputs).toHaveLength(1);
      expect(modelInputs[0]?.transcript).toBe("I have a pending ticket with regards to");
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          transcript: "I have a pending ticket with regards to",
          responseText: "I can help with your account activation ticket.",
        },
      });
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "provider.telemetry",
          payload: expect.objectContaining({
            event: "final_deferred",
          }),
        }),
      );

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("trusts Cartesia turn.end after eager endpoint resume before starting the model", async () => {
      const sttProvider = createCartesiaLifecycleStreamingSttProvider();
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(sttProvider)
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);
            yield "I will handle that provider-final turn once.";
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("cartesia-eager-frame", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );
      await settle();

      expect(modelInputs).toHaveLength(0);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "provider.telemetry",
          payload: expect.objectContaining({
            stage: "stt",
            provider: "cartesia-ink-2",
            event: "turn.eager_end",
            transcript: "I need help with regards to",
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "provider.telemetry",
          payload: expect.objectContaining({
            stage: "stt",
            provider: "cartesia-ink-2",
            event: "turn.resume",
          }),
        }),
      );

      sttProvider.sessions[0]?.endTurn();

      await withTimeout(
        nextMatchingMessage(socket, (event) => event.type === "turn.completed"),
        "Cartesia provider-final turn completed",
      );
      await settle();
      unsubscribe();

      expect(modelInputs).toHaveLength(1);
      expect(modelInputs[0]?.transcript).toBe("I need help with regards to");
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "provider.telemetry",
          payload: expect.objectContaining({
            event: "final_deferred",
          }),
        }),
      );

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("emits STT lifecycle milestones before the first voice response", async () => {
      const sttProvider = createStreamingFakeSttProvider();
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(sttProvider)
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const openedPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "provider.telemetry"
          && readPayloadString(event, "stage") === "stt"
          && readPayloadString(event, "event") === "session_opened",
      );
      const firstFramePromise = nextMatchingMessage(
        socket,
        (event) => event.type === "provider.telemetry"
          && readPayloadString(event, "stage") === "stt"
          && readPayloadString(event, "event") === "audio_first_frame",
      );
      const finalPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "provider.telemetry"
          && readPayloadString(event, "stage") === "stt"
          && readPayloadString(event, "event") === "final",
      );
      const transcribedPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.transcribed",
      );
      const completedPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("I need help with billing", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const opened = await withTimeout(openedPromise, "STT session opened");
      const firstFrame = await withTimeout(firstFramePromise, "STT first audio frame");
      const final = await withTimeout(finalPromise, "STT final");
      const transcribed = await withTimeout(transcribedPromise, "turn transcribed");
      const completed = await withTimeout(completedPromise, "turn completed");

      expect(Number(opened.sequence)).toBeLessThan(Number(firstFrame.sequence));
      expect(Number(firstFrame.sequence)).toBeLessThan(Number(final.sequence));
      expect(Number(final.sequence)).toBeLessThan(Number(transcribed.sequence));
      expect(Number(transcribed.sequence)).toBeLessThan(Number(completed.sequence));
      expect(final.payload).toMatchObject({
        stage: "stt",
        provider: "assemblyai-streaming",
        event: "final",
      });
      expect(typeof (final.payload as Record<string, unknown>).latencyMs).toBe("number");
      expect(typeof (final.payload as Record<string, unknown>).listeningMs).toBe("number");
      expect(typeof (final.payload as Record<string, unknown>).speechMs).toBe("number");
      expect(typeof (final.payload as Record<string, unknown>).endpointMs).toBe("number");

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("persists streaming STT provider failures into the session event log", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createFailingStreamingSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const failedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "call.failed",
      );
      const diagnosticEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "provider.diagnostic",
      );
      const providerCloseTelemetryPromise = nextMatchingMessage(
        socket,
        (event) => {
          const payload = event.payload as Record<string, unknown>;
          return event.type === "provider.telemetry" && payload.event === "provider_close";
        },
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("bad-live-frame", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const failedEvent = await withTimeout(failedEventPromise, "stt failed event");
      const diagnosticEvent = await withTimeout(diagnosticEventPromise, "provider diagnostic event");
      const providerCloseTelemetry = await withTimeout(
        providerCloseTelemetryPromise,
        "provider close telemetry event",
      );
      const replayResponse = await request(app.getHttpServer()).get(
        `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
      );

      expect(failedEvent).toMatchObject({
        type: "call.failed",
        payload: {
          stage: "stt",
          provider: "assemblyai-streaming",
          message: "AssemblyAI streaming session failed with close code 3006: Invalid Message Type.",
        },
      });
      expect(diagnosticEvent).toMatchObject({
        type: "provider.diagnostic",
        payload: {
          stage: "stt",
          provider: "assemblyai-streaming",
          severity: "error",
          closeCode: 3006,
        },
      });
      expect(providerCloseTelemetry).toMatchObject({
        type: "provider.telemetry",
        payload: {
          stage: "stt",
          provider: "assemblyai-streaming",
          event: "provider_close",
          closeCode: 3006,
        },
      });
      expect(JSON.stringify(replayResponse.body.events)).toContain("Invalid Message Type");

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);
});
