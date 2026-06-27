import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingRule,
  type RuntimeAgentDefinition,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
} from "@zara/core";
import WebSocket, { type RawData } from "ws";

import { SandboxLiveSessionsModule } from "./sandbox-live-sessions.module";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { runtimeObservabilityRecorderToken } from "../runtime-observability/runtime-observability";
import { installTestTenantAuth } from "../testing/tenant-auth-request";
import { WorkspacesService } from "../workspaces/workspaces.service";

const routingRules: ModelRoutingRule[] = [
  {
    id: "route-greeting-cheap",
    priority: 10,
    when: {
      callPhase: "greeting",
      language: "en",
    },
    useTier: "cheap",
    reason: "Greeting turns can stay on the cheapest tier.",
  },
];

describe("Sandbox live session websocket stream", () => {
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

  it("streams session events to a valid transport token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider()).compile();

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
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const transcriptEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.transcribed",
    );

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "hello from the caller",
      },
    });

    const transcriptEvent = await withTimeout(transcriptEventPromise, "turn.transcribed event");

    expect(transcriptEvent).toMatchObject({
      type: "turn.transcribed",
      sessionId,
      payload: {
        transcript: "hello from the caller",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("rejects websocket connections with an invalid transport token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider()).compile();

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
    const port = getListeningPort(app);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=bad-token`,
    );
    sockets.push(socket);

    const closeEvent = await nextClose(socket);

    expect(closeEvent.code).toBe(4403);

    await app.close();
  }, 20_000);

  it("rejects retired typed websocket input", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider("fr"))
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
    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "I need help with billing",
        callPhase: "discovery",
      }),
    );

    await expect(withTimeout(nextClose(socket), "typed input rejection")).resolves.toEqual({
      code: 4400,
      reason: "unsupported_message_type",
    });

    await app.close();
  }, 20_000);

  it("runs a voice turn through routing, model, and audio events", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
    expect(modelInputs[0]?.activeAgent.modelProvider).toBe("google-gemini");
    expect(modelInputs[0]?.context.language).toBe("fr");
    expect(transcribedEvent).toMatchObject({
      payload: {
        language: "fr",
      },
    });
    expect(modelTelemetryEvent).toMatchObject({
      payload: {
        provider: "google-gemini",
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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

  it("blocks live voice sessions when the selected text model provider is not configured", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createTextModelProviderWithAvailability({
        "google-gemini": {
          configured: false,
          missingEnv: ["GEMINI_API_KEY"],
        },
      }))
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const manifest = withAgentRoleConfig(createCompiledManifest("workspace-default"), "agent-front-desk", {
      modelProvider: "google-gemini",
    });
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
    expect(createResponse.body.message).toContain("Gemini text model is not configured");
    expect(createResponse.body.message).toContain("GEMINI_API_KEY");

    await app.close();
  }, 60_000);

  it("keeps one streaming STT session open across follow-up caller turns after endpointing", async () => {
    const sttProvider = createStreamingFakeSttProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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
      imports: [SandboxLiveSessionsModule],
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

  it("does not execute assigned live tools unless the agent requests them", async () => {
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute(bindingInput: {
          binding: { nodeId: string; toolId: string; toolName: string };
          transcript: string;
        }) {
          registryCalled = true;
          return {
            summary: `Executed ${bindingInput.binding.toolName} for ${bindingInput.transcript}.`,
            output: {
              ok: true,
            },
            durationMs: 42,
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Please look up the customer profile before routing this billing call.", { callPhase: "tool-use" });

    await withTimeout(completedEventPromise, "tool turn completed");
    await settle();
    unsubscribe();

    expect(registryCalled).toBe(false);
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    expect(events.some((event) => event.type === "tool.requested")).toBe(false);
    expect(events.some((event) => event.type === "tool.completed")).toBe(false);
    expect(events.some((event) => event.type === "tool.failed")).toBe(false);
    expect(events.some((event) => event.type === "tool.approval_required")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn.cost.delta",
        payload: expect.objectContaining({
          currency: "USD",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider.telemetry",
        payload: expect.objectContaining({
          stage: "tts",
          provider: "cartesia-sonic-3",
        }),
      }),
    );
    const toolTransitionEvent = events.find(
      (event) =>
        event.type === "node.transition"
        && (event.payload as Record<string, unknown>)["nodeId"] === "agent-front-desk:customer-profile-lookup",
    );
    expect(toolTransitionEvent).toBeUndefined();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.selected",
        payload: expect.objectContaining({
          turnId: expect.any(String),
          activeAgentId: "agent-front-desk",
          packetSequence: expect.any(Number),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "routing.model_selected",
        payload: expect.objectContaining({
          turnId: expect.any(String),
          packetSequence: expect.any(Number),
        }),
      }),
    );

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("runs agents with an explicit empty toolbelt as normal response turns", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);
          yield "I can help with that request.";
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "Unexpected tool execution.",
            output: {
              ok: false,
            },
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createCompiledManifest("workspace-default");
    expect(manifest.agentToolAssignments).toEqual([]);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you answer this without looking anything up?", { callPhase: "greeting" });

    const completedEvent = await withTimeout(completedEventPromise, "empty toolbelt turn completed");
    await settle();
    unsubscribe();

    expect(registryCalled).toBe(false);
    expect(modelInputs).toHaveLength(1);
    expect(modelInputs[0]?.agentActionMode).toBe(false);
    expect(modelInputs[0]?.agentContext?.availableActions).toEqual([]);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "I can help with that request.",
      },
    });
    expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("hands off only when a handoff-capable agent emits a handoff action", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if (input.activeAgent.agentId === "agent-billing") {
            yield "Billing specialist can help with that invoice now.";
            return;
          }

          expect(input.agentActionMode).toBe(true);
          expect(input.agentContext?.availableActions).toEqual([
            expect.objectContaining({
              kind: "internal_handoff",
              targets: [
                expect.objectContaining({
                  targetAgentId: "agent-billing",
                  targetAgentName: "Billing specialist",
                }),
              ],
            }),
          ]);
          yield JSON.stringify({
            type: "handoff_to_agent",
            targetAgentId: "agent-billing",
            reason: "Caller needs invoice status support.",
            callerNeedSummary: "Caller wants the status of a pending invoice.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "Unexpected connector execution.",
            output: {},
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    ensureWorkspaceAccess(moduleRef.get(WorkspacesService));
    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createAgentRoutePolicyManifest("workspace-default");
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

    expect(createResponse.status).toBe(201);
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const firstCompletedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );
    const handoffEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "agent.handoff.completed",
    );

    sendVoiceTurn(socket, "My name is Francis. I need the status of a pending invoice.", { callPhase: "discovery" });

    const handoffEvent = await withTimeout(handoffEventPromise, "handoff action event");
    const firstCompletedEvent = await withTimeout(firstCompletedEventPromise, "handoff action completed");

    expect(firstCompletedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "I'll connect you with Billing specialist.",
      },
    });
    expect(handoffEvent).toMatchObject({
      type: "agent.handoff.completed",
      payload: {
        nodeId: "agent-front-desk",
        sourceAgentId: "agent-front-desk",
        targetAgentId: "agent-billing",
        targetAgentName: "Billing specialist",
      },
    });
    expect(registryCalled).toBe(false);
    expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);

    const secondCompletedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed"
        && typeof event.payload === "object"
        && event.payload !== null
        && (event.payload as { responseText?: unknown }).responseText
          === "Billing specialist can help with that invoice now.",
    );

    sendVoiceTurn(socket, "The invoice is INV-1042.", { callPhase: "tool-use" });

    const secondCompletedEvent = await withTimeout(secondCompletedEventPromise, "routed target turn completed");
    await settle();
    unsubscribe();

    expect(secondCompletedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "Billing specialist can help with that invoice now.",
      },
    });
    expect(modelInputs[0]?.activeAgent.agentId).toBe("agent-front-desk");
    expect(modelInputs[0]?.agentActionMode).toBe(true);
    expect(modelInputs[1]?.activeAgent.agentId).toBe("agent-billing");
    expect(modelInputs[1]?.agentActionMode).toBe(false);

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("executes one agent-requested tool call and returns safe results to the same agent", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryInput: Record<string, unknown> | undefined;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if (input.agentActionMode === true && (input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-customer-profile-1",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {
                customerId: "customer-123",
                email: "francis@example.com",
              },
              reason: "Caller asked for account context.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "Customer profile is active and billing support is ready to help.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute(input: Record<string, unknown>) {
          registryInput = input;
          return {
            summary: "Customer profile is active.",
            output: {
              status: "active",
              internalToken: "do-not-send",
            },
            safeOutput: {
              status: "active",
            },
            durationMs: 42,
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you check my customer profile before billing helps me?", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "agent-requested tool turn completed");
    await settle();
    unsubscribe();

    expect(registryInput).toMatchObject({
      toolCallId: "tool-call-customer-profile-1",
      arguments: {
        customerId: "customer-123",
        email: "francis@example.com",
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.requested",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          toolCallId: "tool-call-customer-profile-1",
          toolAssignmentId: "agent-front-desk:customer-profile-lookup",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.started",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          toolName: "Customer profile lookup",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          summary: "Customer profile is active.",
          safeOutput: {
            status: "active",
          },
          durationMs: 42,
        }),
      }),
    );
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "Customer profile is active and billing support is ready to help.",
      },
    });
    expect(modelInputs).toHaveLength(2);
    expect(modelInputs[0]?.agentContext?.availableActions).toEqual([
      expect.objectContaining({
        kind: "agent_tool",
        toolAssignmentId: "agent-front-desk:customer-profile-lookup",
        label: "Customer profile API",
      }),
    ]);
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      {
        toolName: "Customer profile lookup",
        status: "completed",
        summary: "Customer profile is active.",
        safeOutput: {
          status: "active",
        },
      },
    ]);
    expect(JSON.stringify(modelInputs[1]?.agentContext)).not.toContain("do-not-send");

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("answers closing turns naturally when action-mode output is empty structured JSON", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          expect(input.agentActionMode).toBe(true);
          yield "{";
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          throw new Error("Closing turn should not execute tools.");
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Thank you, that will be all.", { callPhase: "closing" });

    const completedEvent = await withTimeout(completedEventPromise, "closing turn completed");
    await settle();
    unsubscribe();

    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "You're welcome. Have a great day.",
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "quality.flagged",
        payload: expect.objectContaining({
          stage: "model",
          code: "agent_action.invalid_json",
        }),
      }),
    );
    expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("rejects unsupported structured agent commands instead of speaking raw JSON", async () => {
    const unsupportedCommand = JSON.stringify({
      type: "handoff",
      target: "agent-billing",
    });
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);
          yield unsupportedCommand;
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "Should not execute.",
            output: {},
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Please send me straight to billing.", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "invalid agent command completed");
    await settle();
    unsubscribe();

    const replayResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
    );

    expect(registryCalled).toBe(false);
    expect(modelInputs).toHaveLength(1);
    expect(modelInputs[0]?.agentActionMode).toBe(true);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "I'm sorry, I had trouble responding just now. Could you try that again?",
      },
    });
    expect(JSON.stringify(completedEvent)).not.toContain(unsupportedCommand);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "runtime.warning",
        payload: expect.objectContaining({
          code: "agent_action.invalid",
          recoverable: true,
          nodeId: "agent-front-desk",
          packetSequence: expect.any(Number),
        }),
      }),
    );
    expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);
    expect(JSON.stringify(replayResponse.body.events)).not.toContain(unsupportedCommand);

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("returns a structured skipped result when an agent-requested tool is missing required input", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-missing-input",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {},
              reason: "Caller asked for account context.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "Which customer ID should I use for the lookup?",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "Should not execute.",
            output: {},
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    manifest.agentToolAssignments = manifest.agentToolAssignments.map((assignment) => ({
      ...assignment,
      inputSchema: {
        type: "object",
        required: ["customerId", "email"],
      },
      requiredInputs: ["customerId", "email"],
    }));
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "missing-input tool turn completed");
    await settle();
    unsubscribe();

    expect(registryCalled).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          status: "skipped",
          summary: "Missing required tool input: customerId, email.",
          error: expect.objectContaining({
            code: "tool_input.missing_required",
            recoverable: true,
          }),
        }),
      }),
    );
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      expect.objectContaining({
        status: "skipped",
        summary: "Missing required tool input: customerId, email.",
      }),
    ]);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "Which customer ID should I use for the lookup?",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("returns approval-required results without executing agent-requested tools", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-approval",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {
                customerId: "customer-123",
                email: "francis@example.com",
              },
              reason: "Caller asked for account context.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "I need approval before I can run that lookup.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "Should not execute.",
            output: {},
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "high",
        approvalRequired: true,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "approval tool turn completed");
    await settle();
    unsubscribe();

    expect(registryCalled).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.approval_required",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          status: "approval_required",
          summary: "Tool 'Customer profile API' requires human approval before execution.",
          error: expect.objectContaining({
            code: "tool_approval.required",
            recoverable: true,
          }),
        }),
      }),
    );
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      expect.objectContaining({
        status: "approval_required",
        summary: "Tool 'Customer profile API' requires human approval before execution.",
      }),
    ]);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "I need approval before I can run that lookup.",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("returns a recoverable timeout failure when an agent-requested tool times out", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-timeout",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {
                customerId: "customer-123",
                email: "francis@example.com",
              },
              reason: "Caller asked for account context.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "The lookup timed out, so I can try again later or continue without it.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          throw new Error("Live sandbox tool 'hubspot.profile.lookup' timed out after 100ms.");
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "timeout tool turn completed");
    await settle();
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          status: "failed",
          summary: "Tool 'Customer profile API' timed out.",
          error: expect.objectContaining({
            code: "tool_execution.timeout",
            recoverable: true,
          }),
        }),
      }),
    );
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      expect.objectContaining({
        status: "failed",
        summary: "Tool 'Customer profile API' timed out.",
      }),
    ]);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "The lookup timed out, so I can try again later or continue without it.",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("publishes runtime failures after a streaming transcript instead of stalling silently", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFailingTextModelProvider())
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
    const transcribedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.transcribed",
    );
    const diagnosticEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "quality.flagged",
    );
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );
    const modelTelemetryEventPromise = nextMatchingMessage(
      socket,
      (event) => {
        const payload = event.payload as Record<string, unknown>;
        return event.type === "provider.telemetry" && payload.stage === "model";
      },
    );

    socket.send(
      JSON.stringify({
        type: "input.audio.append",
        audioBase64: Buffer.from("I need help with billing", "utf8").toString("base64"),
        sampleRateHz: 16000,
        callPhase: "discovery",
      }),
    );

    const transcribedEvent = await withTimeout(transcribedEventPromise, "streaming transcribed event");
    const diagnosticEvent = await withTimeout(diagnosticEventPromise, "streaming runtime failure event");
    const completedEvent = await withTimeout(completedEventPromise, "streaming degraded completion event");
    const modelTelemetryEvent = await withTimeout(modelTelemetryEventPromise, "streaming degraded model telemetry event");

    expect(transcribedEvent).toMatchObject({
      type: "turn.transcribed",
      payload: {
        transcript: "I need help with billing",
      },
    });
    expect(diagnosticEvent).toMatchObject({
      type: "quality.flagged",
      payload: {
        stage: "model",
        code: "failed",
        recoverable: true,
        message: "Live sandbox text model failed after transcription.",
      },
    });
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: expect.objectContaining({
        degraded: true,
        failureStage: "model",
      }),
    });
    expect(modelTelemetryEvent).toMatchObject({
      type: "provider.telemetry",
      payload: expect.objectContaining({
        stage: "model",
        degraded: true,
        failureStage: "model",
      }),
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("configures AssemblyAI streaming prompts and carries agent reply context into the next turn", async () => {
    const sttProvider = createStreamingFakeSttProvider();
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
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
        manifest: createToolExecutionManifestWithStaleEntrySnapshot("workspace-default", {
          toolName: "Zendesk ticket lookup",
          toolLabel: "Zendesk support ticket",
        }),
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
        audioBase64: Buffer.from("live-frame-1", "utf8").toString("base64"),
        sampleRateHz: 16000,
        callPhase: "discovery",
      }),
    );

    await withTimeout(completedEventPromise, "automatic voice completed event");

    expect(sttProvider.sessions[0]?.config).toMatchObject({
      languageCode: "fr",
      minTurnSilenceMs: 700,
      maxTurnSilenceMs: 2600,
      continuousPartials: true,
    });
    expect(sttProvider.sessions[0]?.config.keytermsPrompt).toEqual(
      expect.arrayContaining([
        "Front desk triage",
        "Tuzzy Labs",
        "Zendesk ticket lookup",
        "Zendesk support ticket",
      ]),
    );
    expect(sttProvider.sessions[0]?.config.keytermsPrompt).not.toContain("Stale Entry Snapshot");
    expect(sttProvider.sessions[0]?.updates.at(-1)).toMatchObject({
      agentContext: "Billing support is ready to help with that request.",
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("reports Cartesia Ink 2 in provider stack metadata when selected", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createCartesiaInkFakeSttProvider())
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

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.session.providerStack).toMatchObject({
      stt: "cartesia-ink-2",
      tts: "cartesia-sonic-3",
    });

    await app.close();
  }, 20_000);

  it("blocks non-English workflows when Cartesia Ink 2 STT is selected", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createCartesiaInkFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);
    const manifest = withAgentRoleConfig(createCompiledManifest("workspace-default"), "agent-front-desk", {
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en", "es"],
        allowMidCallSwitching: true,
      },
    });

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
    expect(JSON.stringify(createResponse.body)).toContain("Cartesia Ink 2 STT is English-only");

    await app.close();
  }, 20_000);

  it("marks post-send side-effect timeouts as unknown and blocks blind retry", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-ticket-create",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {
                contactId: "contact-123",
                body: "Follow up with Francis about the billing request.",
              },
              reason: "Caller needs a follow-up ticket.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "The ticket write may have reached the provider, so I will not retry it automatically.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          const error = new Error("Zendesk request timed out after provider accepted the write.");
          (error as Error & { sideEffectRequestSent?: boolean }).sideEffectRequestSent = true;
          throw error;
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default", {
      toolId: "hubspot.notes.create",
      toolLabel: "HubSpot note writer",
      toolName: "HubSpot note writer",
      connector: "hubspot",
    });
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.notes.create",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Please create a follow-up ticket.", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "unknown side-effect turn completed");
    await settle();
    unsubscribe();

    const sideEffectEvents = events.filter((event) => event.type === "integration.side_effect.recorded");
    expect(sideEffectEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "pending",
          provider: "hubspot",
          toolCallId: "tool-call-ticket-create",
          toolId: "hubspot.notes.create",
          integrationConnectionId: "hubspot-prod",
          retryPosture: "in_progress",
          idempotencyKey: expect.any(String),
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "unknown",
          provider: "hubspot",
          toolCallId: "tool-call-ticket-create",
          toolId: "hubspot.notes.create",
          integrationConnectionId: "hubspot-prod",
          retryPosture: "manual_review_required",
          idempotencyKey: expect.any(String),
        }),
      }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        payload: expect.objectContaining({
          status: "failed",
          summary: "Tool 'HubSpot note writer' has an unknown provider write outcome.",
          error: expect.objectContaining({
            code: "tool_execution.side_effect_unknown",
            recoverable: true,
          }),
        }),
      }),
    );
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      expect.objectContaining({
        status: "failed",
        summary: "Tool 'HubSpot note writer' has an unknown provider write outcome.",
      }),
    ]);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "The ticket write may have reached the provider, so I will not retry it automatically.",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("returns a recoverable rate-limit failure when an agent-requested tool is rate limited", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-rate-limit",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {
                customerId: "customer-123",
                email: "francis@example.com",
              },
              reason: "Caller asked for account context.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "The lookup is rate limited right now, so I can continue without it or retry later.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          throw new Error("Provider returned HTTP 429 rate limit.");
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "rate-limit tool turn completed");
    await settle();
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          status: "failed",
          summary: "Tool 'Customer profile API' was rate limited.",
          error: expect.objectContaining({
            code: "tool_execution.rate_limited",
            recoverable: true,
          }),
        }),
      }),
    );
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      expect.objectContaining({
        status: "failed",
        summary: "Tool 'Customer profile API' was rate limited.",
      }),
    ]);
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "The lookup is rate limited right now, so I can continue without it or retry later.",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("returns partial tool results with safe output to the same agent", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-partial",
              toolAssignmentId: "agent-front-desk:customer-profile-lookup",
              arguments: {
                customerId: "customer-123",
                email: "francis@example.com",
              },
              reason: "Caller asked for account context.",
            });
            return;
          }

          yield JSON.stringify({
            type: "respond",
            responseText: "I found the active profile, but billing history is unavailable right now.",
          });
        },
      } satisfies SandwichTextModelProvider)
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          return {
            status: "partial",
            summary: "Customer profile returned, but billing history was unavailable.",
            output: {
              status: "active",
              billingHistory: null,
              internalToken: "do-not-send",
            },
            safeOutput: {
              status: "active",
              warnings: ["billing_history_unavailable"],
            },
            durationMs: 55,
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "medium",
        approvalRequired: false,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Can you check my customer profile and billing history?", { callPhase: "tool-use" });

    const completedEvent = await withTimeout(completedEventPromise, "partial tool turn completed");
    await settle();
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          status: "partial",
          summary: "Customer profile returned, but billing history was unavailable.",
          safeOutput: {
            status: "active",
            warnings: ["billing_history_unavailable"],
          },
          durationMs: 55,
        }),
      }),
    );
    expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
      {
        toolName: "Customer profile lookup",
        status: "partial",
        summary: "Customer profile returned, but billing history was unavailable.",
        safeOutput: {
          status: "active",
          warnings: ["billing_history_unavailable"],
        },
      },
    ]);
    expect(JSON.stringify(modelInputs[1]?.agentContext)).not.toContain("do-not-send");
    expect(completedEvent).toMatchObject({
      type: "turn.completed",
      payload: {
        responseText: "I found the active profile, but billing history is unavailable right now.",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("does not check grants for assigned tools until the agent requests a tool", async () => {
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "This tool should not have run.",
            output: {
              ok: true,
            },
            durationMs: 12,
          };
        },
      })
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
        manifest: createToolExecutionManifest("workspace-default"),
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Please look up the customer profile before routing this billing call.", { callPhase: "tool-use" });

    await withTimeout(completedEventPromise, "toolbelt turn completed");
    await settle();
    unsubscribe();

    expect(registryCalled).toBe(false);
    expect(events.some((event) => event.type === "tool.failed")).toBe(false);
    expect(events.some((event) => event.type === "tool.approval_required")).toBe(false);
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
      }),
    );

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("does not request human approval for high-risk tools until the agent requests a tool", async () => {
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
      .useValue({
        async execute() {
          registryCalled = true;
          return {
            summary: "This high-risk tool should wait for approval.",
            output: {
              ok: true,
            },
            durationMs: 15,
          };
        },
      })
      .compile();

    const app: INestApplication = createTestingApplication(moduleRef);
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-default");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-default",
        workflowId: manifest.publishedVersionId,
        agentId: "agent-front-desk",
        toolId: "hubspot.profile.lookup",
        integrationConnectionId: "hubspot-prod",
        risk: "high",
        approvalRequired: true,
      });

    expect(grantResponse.status).toBe(201);

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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(socket);

    await withTimeout(nextOpen(socket), "websocket open");
    await settle();
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    sendVoiceTurn(socket, "Please look up the customer profile before routing this billing call.", { callPhase: "tool-use" });

    await withTimeout(completedEventPromise, "high-risk toolbelt turn completed");
    await settle();
    unsubscribe();

    expect(registryCalled).toBe(false);
    expect(events.some((event) => event.type === "tool.approval_required")).toBe(false);
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
      }),
    );

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("rejects replayed websocket transport tokens and audits the attempt", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider()).compile();

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
    const firstSocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(firstSocket);
    await withTimeout(nextOpen(firstSocket), "first websocket open");

    const replaySocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(replaySocket);

    const closeEvent = await nextClose(replaySocket);
    const audits = (service as unknown as {
      getTransportSecurityAudits(): Array<{ reason: string; sessionId: string }>;
    }).getTransportSecurityAudits();

    expect(closeEvent.code).toBe(4403);
    expect(audits).toContainEqual(
      expect.objectContaining({
        sessionId,
        reason: "token_replay",
      }),
    );

    firstSocket.close();
    await nextClose(firstSocket);
    await app.close();
  }, 20_000);

  it("rejects expired or cross-workspace websocket tokens and audits both attempts", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createStreamingFakeSttProvider()).compile();

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
        now: "2020-05-16T00:00:00.000Z",
        ttlMinutes: 0,
      });

    const sessionId = String(createResponse.body.session.sessionId);
    const token = String(createResponse.body.session.transportToken);
    const port = getListeningPort(app);
    const expiredSocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
    );
    sockets.push(expiredSocket);

    const expiredCloseEvent = await nextClose(expiredSocket);

    const freshResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    const freshSessionId = String(freshResponse.body.session.sessionId);
    const freshToken = String(freshResponse.body.session.transportToken);
    const workspaceMismatchSocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${freshSessionId}/stream?token=${encodeURIComponent(freshToken)}&workspaceId=workspace-other&source=draft`,
    );
    sockets.push(workspaceMismatchSocket);

    const mismatchCloseEvent = await nextClose(workspaceMismatchSocket);
    const audits = (service as unknown as {
      getTransportSecurityAudits(): Array<{ reason: string; sessionId: string }>;
    }).getTransportSecurityAudits();

    expect(expiredCloseEvent.code).toBe(4403);
    expect(mismatchCloseEvent.code).toBe(4403);
    expect(audits).toContainEqual(
      expect.objectContaining({
        sessionId,
        reason: "token_expired",
      }),
    );
    expect(audits).toContainEqual(
      expect.objectContaining({
        sessionId: freshSessionId,
        reason: "workspace_scope_mismatch",
      }),
    );

    await app.close();
  }, 20_000);
});

function createTestingApplication(moduleRef: { createNestApplication: () => INestApplication }) {
  const app = moduleRef.createNestApplication();
  installTestTenantAuth(app);
  return app;
}

function seedSandboxIntegrationState(directoryPath: string) {
  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(
    join(directoryPath, "tenant-west-africa.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        organizationId: "tenant-west-africa",
        pendingConnects: [],
        connections: [
          {
            id: "hubspot-prod",
            organizationId: "tenant-west-africa",
            provider: "hubspot",
            status: "connected",
            connectedBy: "user-ops-lead",
            scopes: ["crm.objects.contacts.read", "crm.objects.notes.write"],
            availability: { scope: "organization" },
            credentialReference: {
              id: "credential-hubspot-prod",
              provider: "hubspot",
              kind: "oauth-token",
              preview: "...prod",
            },
            accountLabel: "HubSpot Production",
            connectedAt: "2026-05-22T10:00:00.000Z",
            health: {
              status: "healthy",
              checkedAt: "2026-05-22T10:00:00.000Z",
              message: "Connector credentials are available.",
            },
            auditEvents: [],
          },
        ],
        credentials: [
          {
            connectionId: "hubspot-prod",
          },
        ],
        toolGrants: [],
        webhookTools: [],
        webhookToolSecrets: [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

function getListeningPort(app: INestApplication) {
  const address = app.getHttpServer().address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected sandbox websocket test server to listen on a TCP port.");
  }

  return address.port;
}

function readPayloadString(event: Record<string, unknown>, key: string) {
  const payload = event.payload;

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function nextMatchingMessage(
  socket: WebSocket,
  predicate: (event: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (buffer: RawData) => {
      try {
        const event = JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;

        if (!predicate(event)) {
          return;
        }

        cleanup();
        resolve(event);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Socket closed before matching message: ${code} ${reason.toString("utf8")}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

function nextOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("close", (code, reason) => {
      reject(new Error(`Socket closed before open: ${code} ${reason.toString("utf8")}`));
    });
    socket.once("error", reject);
  });
}

function settle() {
  return new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

function withTimeout<TValue>(promise: Promise<TValue>, label: string, timeoutMs = 3_000) {
  return Promise.race([
    promise,
    new Promise<TValue>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
    socket.once("error", reject);
  });
}

function sendVoiceTurn(
  socket: WebSocket,
  transcript: string,
  options: {
    callPhase?: string | undefined;
    intent?: string | undefined;
    sampleRateHz?: number | undefined;
  } = {},
) {
  socket.send(JSON.stringify({
    type: "input.audio.append",
    audioBase64: Buffer.from(transcript, "utf8").toString("base64"),
    sampleRateHz: options.sampleRateHz ?? 16_000,
    ...(options.callPhase !== undefined ? { callPhase: options.callPhase } : {}),
    ...(options.intent !== undefined ? { intent: options.intent } : {}),
  }));
}

function createCompiledManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-websocket-api",
    name: "Live sandbox websocket API",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 160, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller and route safely.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
        },
      }),
      createEndNode({
        id: "end-resolved",
        label: "Resolved exit",
        position: { x: 420, y: 140 },
        end: {
          outcome: "resolved",
          closingMessage: "Thanks for calling.",
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-end",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "end-resolved",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-live-sandbox-websocket-api",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

function createAgentRoutePolicyManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-agent-handoff-action",
    name: "Agent handoff action",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 180, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Clarify caller needs and hand off only when the next specialist is clear.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
          routePolicy: {
            type: "route_by_intent",
            trigger: "on_caller_turn_end",
            activation: "until_routed",
            classifier: {
              mode: "standard",
              modelAlias: "intent-classifier-fast",
              confidenceThreshold: 0.65,
            },
            inputWindow: {
              latestCallerTurn: true,
              recentTranscriptTurns: 6,
              includeConversationSummary: true,
              includePreviousAgentContext: true,
              includeRecentToolResults: true,
            },
            readiness: {
              mode: "agent_requested",
            },
            announcement: {
              mode: "template",
              text: "I'll connect you with {targetAgentName}.",
            },
            branches: [
              {
                id: "branch-billing",
                label: "Billing",
                intentKey: "billing",
                target: {
                  type: "agent",
                  agentId: "agent-billing",
                },
                transferInstructions: "Review invoice context before greeting the caller.",
              },
            ],
            fallback: {
              label: "Ask a clarifying question",
              target: {
                type: "clarify_source_agent",
              },
            },
          },
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 520, y: 80 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Handle invoice and payment questions.",
          defaultModelTier: "standard",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-agent-handoff-action",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

function ensureWorkspaceAccess(workspacesService: WorkspacesService) {
  const organizationId = "tenant-west-africa";
  const workspaceId = "workspace-default";
  const actorUserId = "user-ops-lead";
  const state = workspacesService.getWorkspaceState(organizationId);

  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    workspacesService.createWorkspace({
      organizationId,
      name: "Default workspace",
      actorUserId,
    });
  }

  const nextState = workspacesService.getWorkspaceState(organizationId);
  if (!nextState.memberships.some((membership) =>
    membership.workspaceId === workspaceId
    && membership.tenantId === organizationId
    && membership.userId === actorUserId
  )) {
    workspacesService.setMembershipRole({
      organizationId,
      workspaceId,
      userId: actorUserId,
      role: "admin",
      actorUserId,
    });
  }
}

function createConditionAgentRouteManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-graph-execution",
    name: "Live sandbox graph execution",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 180, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller and identify the lane.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
        },
      }),
      createConditionNode({
        id: "condition-route",
        label: "Intent route",
        position: { x: 420, y: 80 },
        condition: {
          branches: [
            {
              id: "branch-billing",
              label: "Billing",
              expression: 'intent == "billing"',
              targetNodeId: "agent-billing",
            },
          ],
          fallbackLabel: "Resolved",
          fallbackTargetNodeId: "end-resolved",
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 860, y: 24 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Handle billing questions clearly and directly.",
          defaultModelTier: "standard",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: false,
          },
        },
      }),
      createEndNode({
        id: "end-resolved",
        label: "Resolved exit",
        position: { x: 860, y: 180 },
        end: {
          outcome: "resolved",
          closingMessage: "Thanks for calling.",
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-condition",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "condition-route",
      },
      {
        id: "edge-condition-billing",
        sourceNodeId: "condition-route",
        targetNodeId: "agent-billing",
      },
      {
        id: "edge-condition-fallback",
        sourceNodeId: "condition-route",
        targetNodeId: "end-resolved",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-live-sandbox-graph-execution",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
  });
}

function createConditionAgentRouteManifestWithStaleBillingSnapshot(workspaceId: string): CompiledRuntimeManifest {
  const manifest = createConditionAgentRouteManifest(workspaceId);

  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== "agent-billing") {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const roleConfig = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          label: "Stale graph label",
          config: {
            ...config,
            role: {
              ...roleConfig,
              name: "Billing specialist",
              modelProvider: "google-gemini",
              languagePolicy: {
                defaultLanguage: "fr",
                supportedLanguages: ["fr"],
                allowMidCallSwitching: false,
              },
            },
          },
        };
      }),
    },
  };
}

function withAgentRoleConfig(
  manifest: CompiledRuntimeManifest,
  agentId: string,
  overrides: Record<string, unknown>,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== agentId) {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const roleConfig = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          config: {
            ...config,
            role: {
              ...roleConfig,
              ...overrides,
            },
          },
        };
      }),
    },
  };
}

function createToolExecutionManifest(
  workspaceId: string,
  input: {
    toolId?: string | undefined;
    toolLabel?: string | undefined;
    toolName?: string | undefined;
    connector?: "zendesk" | "hubspot" | "google-workspace" | "notion" | "webhook" | "internal" | undefined;
  } = {},
): CompiledRuntimeManifest {
  const toolId = input.toolId ?? "hubspot.profile.lookup";
  const toolLabel = input.toolLabel ?? "Customer profile API";
  const toolName = input.toolName ?? "Customer profile lookup";
  const connector = input.connector ?? "webhook";
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-tool-execution",
    name: "Live sandbox tool execution",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 0 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 180, y: 80 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller, use tools when needed, then continue safely.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en"],
            allowMidCallSwitching: true,
          },
          toolbeltAssignments: [
            {
              id: "customer-profile-lookup",
              toolId,
              label: toolLabel,
              description: toolName,
              whenToUse: `Use when Front desk triage needs ${toolName}.`,
              connector,
              toolName,
              integrationConnectionId: "hubspot-prod",
              integrationLabel: "HubSpot - Production",
              connectionStatus: "connected",
              risk: "medium",
              requiresAuthorization: false,
              requiresHumanApproval: false,
              request: {
                method: "POST",
                url: "https://sandbox.example.test/customer-profile",
                authToken: "sandbox-tool-token",
                headers: [
                  { name: "content-type", value: "application/json" },
                ],
                bodyTemplate: "{\"transcript\":\"{{turn.transcript}}\"}",
              },
            },
          ],
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-live-sandbox-tool-execution",
      tenantId: "tenant-west-africa",
      workspaceId,
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: "sandwich-pipeline",
      runtimeProfile: "cost-optimized",
      telephonyProvider: "browser-webrtc",
      memory: {
        mode: "scoped",
        retrievalScopes: ["session"],
        approvalRequired: true,
      },
      budget: {
        monthlyCapUsd: 1200,
        currentSpendUsd: 420,
        projectedCostPerMinuteUsd: 0.34,
        blockOnLimit: true,
      },
    }),
    modelRouting: routingRules,
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    availableIntegrationConnectionIds: ["hubspot-prod"],
  });
}

function createToolExecutionManifestWithStaleEntrySnapshot(
  workspaceId: string,
  input: Parameters<typeof createToolExecutionManifest>[1] = {},
): CompiledRuntimeManifest {
  const manifest = createToolExecutionManifest(workspaceId, input);

  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.map((graphNode) => {
        if (graphNode.id !== "agent-front-desk") {
          return graphNode;
        }

        const config = graphNode.config as Record<string, unknown>;
        const roleConfig = config["role"] as Record<string, unknown>;

        return {
          ...graphNode,
          config: {
            ...config,
            role: {
              ...roleConfig,
              name: "Front desk triage",
              languagePolicy: {
                defaultLanguage: "fr",
                supportedLanguages: ["fr"],
                allowMidCallSwitching: false,
              },
            },
          },
        };
      }),
    },
  };
}

function createFakeTextModelProvider(): SandwichTextModelProvider {
  return {
    async *streamText(input: {
      manifest: CompiledRuntimeManifest;
      activeAgent: RuntimeAgentDefinition;
      transcript: string;
      tier: "rules" | "cheap" | "standard" | "sota";
      context: ModelRoutingContext;
    }) {
      void input;
      yield "Billing support is ready to help with that request.";
    },
  };
}

function createFailingTextModelProvider(): SandwichTextModelProvider {
  return {
    streamText() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error("Live sandbox text model failed after transcription."));
            },
          };
        },
      };
    },
  };
}

function createTextModelProviderWithAvailability(
  availabilityByProvider: Partial<Record<"openai" | "google-gemini", { configured: boolean; missingEnv: string[] }>>,
): SandwichTextModelProvider {
  return {
    getProviderAvailability(providerId: "openai" | "google-gemini") {
      return availabilityByProvider[providerId] ?? {
        configured: true,
        missingEnv: [],
      };
    },
    async *streamText() {
      yield "This provider should not run when preflight fails.";
    },
  } as SandwichTextModelProvider;
}

function createFakeTtsProvider(): SandwichTtsProvider {
  return {
    async synthesize() {
      return {
        firstByteLatencyMs: 120,
        wordTimestamps: [
          {
            word: "Billing",
            start: 0,
            end: 0.4,
          },
        ],
        audio: (async function* () {
          yield "QmlsbGluZyBhdWRpbyBjaHVuaw==";
        })(),
      };
    },
  };
}

function createDelayedAudioTtsProvider(secondAudioChunkGate: Promise<void>): SandwichTtsProvider {
  return {
    async synthesize() {
      return {
        firstByteLatencyMs: 120,
        audio: (async function* () {
          yield "QmlsbGluZyBhdWRpbyBjaHVuay0x";
          await secondAudioChunkGate;
          yield "QmlsbGluZyBhdWRpbyBjaHVuay0y";
        })(),
      };
    },
  };
}

function createFakeSttProvider() {
  return {
    async transcribeTurn() {
      return {
        transcript: "I need help with billing",
        confidence: 0.93,
        language: "en",
      };
    },
  };
}

function createStreamingFakeSttProvider(language = "en") {
  const sessions: Array<{
    appendCount: number;
    forceEndpointCount: number;
    terminateCount: number;
    config: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
  }> = [];

  return {
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      config?: Record<string, unknown> | undefined;
    }) {
      const session = {
        appendCount: 0,
        forceEndpointCount: 0,
        terminateCount: 0,
        config: input.config ?? {},
        updates: [] as Array<Record<string, unknown>>,
      };
      sessions.push(session);

      return {
        appendAudioFrame(audioBase64: string) {
          session.appendCount += 1;
          const transcript = Buffer.from(audioBase64, "base64").toString("utf8")
            || "I need help with billing";
          const partialTranscript = transcript.split(/\s+/).slice(0, 3).join(" ") || transcript;

          input.onPartial({
            transcript: partialTranscript,
            confidence: 0.88,
            language,
          });
          input.onFinal({
            transcript,
            confidence: 0.93,
            language,
          });
        },
        forceEndpoint() {
          session.forceEndpointCount += 1;
        },
        terminate() {
          session.terminateCount += 1;
        },
        updateConfiguration(update: Record<string, unknown>) {
          session.updates.push(update);
        },
        close() {
          session.terminateCount += 1;
        },
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

function createDuplicateFinalStreamingSttProvider() {
  const sessions: Array<{
    appendCount: number;
    forceEndpointCount: number;
    terminateCount: number;
    config: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
  }> = [];

  return {
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      config?: Record<string, unknown> | undefined;
    }) {
      const session = {
        appendCount: 0,
        forceEndpointCount: 0,
        terminateCount: 0,
        config: input.config ?? {},
        updates: [] as Array<Record<string, unknown>>,
      };
      sessions.push(session);

      return {
        appendAudioFrame() {
          session.appendCount += 1;

          input.onPartial({
            transcript: "The email address is",
            confidence: 0.88,
            language: "en",
          });
          input.onFinal({
            transcript: "The email address is francis@example.com.",
            confidence: 0.91,
            language: "en",
          });
          input.onFinal({
            transcript: "francis@example.com.",
            confidence: 0.87,
            language: "en",
          });
        },
        forceEndpoint() {
          session.forceEndpointCount += 1;
        },
        terminate() {
          session.terminateCount += 1;
        },
        updateConfiguration(update: Record<string, unknown>) {
          session.updates.push(update);
        },
        close() {
          session.terminateCount += 1;
        },
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

function createScriptedStreamingSttProvider(
  turns: Array<{
    partial: string;
    final: string;
  }>,
) {
  const sessions: Array<{
    appendCount: number;
    forceEndpointCount: number;
    terminateCount: number;
    config: Record<string, unknown>;
    updates: Array<Record<string, unknown>>;
  }> = [];

  return {
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      config?: Record<string, unknown> | undefined;
    }) {
      const session = {
        appendCount: 0,
        forceEndpointCount: 0,
        terminateCount: 0,
        config: input.config ?? {},
        updates: [] as Array<Record<string, unknown>>,
      };
      sessions.push(session);

      return {
        appendAudioFrame() {
          const turn = turns[session.appendCount];
          session.appendCount += 1;

          if (turn === undefined) {
            return;
          }

          input.onPartial({
            transcript: turn.partial,
            confidence: 0.9,
            language: "en",
          });
          input.onFinal({
            transcript: turn.final,
            confidence: 0.95,
            language: "en",
          });
        },
        forceEndpoint() {
          session.forceEndpointCount += 1;
        },
        terminate() {
          session.terminateCount += 1;
        },
        updateConfiguration(update: Record<string, unknown>) {
          session.updates.push(update);
        },
        close() {
          session.terminateCount += 1;
        },
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

function createFailingStreamingSttProvider() {
  return {
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onError: (error: Error & { closeCode?: number | undefined; closeReason?: string | undefined }) => void;
    }) {
      return {
        appendAudioFrame() {
          const error = new Error("AssemblyAI streaming session failed with close code 3006: Invalid Message Type.") as Error & {
            closeCode?: number;
            closeReason?: string;
          };
          error.closeCode = 3006;
          error.closeReason = "Invalid Message Type";
          input.onError(error);
        },
        forceEndpoint() {},
        terminate() {},
        updateConfiguration() {},
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}

function createCartesiaLifecycleStreamingSttProvider() {
  const sessions: Array<{
    endTurn: () => void;
  }> = [];

  return {
    providerId: "cartesia-ink-2" as const,
    sessions,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial?: ((event: { transcript: string; confidence: number; language: string }) => void) | undefined;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
      onTelemetry?: ((event: {
        event: "turn.start" | "turn.update" | "turn.eager_end" | "turn.resume" | "turn.end";
        transcript?: string | undefined;
        requestId?: string | undefined;
      }) => void) | undefined;
    }) {
      const session = {
        endTurn() {
          input.onTelemetry?.({
            event: "turn.end",
            transcript: "I need help with regards to",
            requestId: "req-cartesia-1",
          });
          input.onFinal({
            transcript: "I need help with regards to",
            confidence: 1,
            language: "en",
          });
        },
      };
      sessions.push(session);

      return {
        appendAudioFrame() {
          input.onTelemetry?.({
            event: "turn.start",
            requestId: "req-cartesia-1",
          });
          input.onPartial?.({
            transcript: "I need help",
            confidence: 1,
            language: "en",
          });
          input.onTelemetry?.({
            event: "turn.update",
            transcript: "I need help",
            requestId: "req-cartesia-1",
          });
          input.onTelemetry?.({
            event: "turn.eager_end",
            transcript: "I need help with regards to",
            requestId: "req-cartesia-1",
          });
          input.onTelemetry?.({
            event: "turn.resume",
            requestId: "req-cartesia-1",
          });
        },
        forceEndpoint() {},
        terminate() {},
        updateConfiguration() {},
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Cartesia Ink 2 buffered transcription should not be used.");
    },
  };
}

function createCartesiaInkFakeSttProvider() {
  return {
    providerId: "cartesia-ink-2" as const,
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession() {
      return {
        appendAudioFrame() {},
        forceEndpoint() {},
        terminate() {},
        updateConfiguration() {},
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Cartesia Ink 2 buffered transcription should not be used.");
    },
  };
}
