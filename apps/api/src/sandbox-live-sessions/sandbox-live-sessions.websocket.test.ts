import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingRule,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
  type VoiceAgentRole,
} from "@zara/core";
import WebSocket, { type RawData } from "ws";

import { SandboxLiveSessionsModule } from "./sandbox-live-sessions.module";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";

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

  beforeEach(() => {
    process.env.ZARA_INTEGRATION_STATE_DIR = join(
      tmpdir(),
      "zara-sandbox-tool-grants",
      randomUUID(),
    );
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
  });

  it("streams session events to a valid transport token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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

  it("turns typed websocket input into runtime transcript events", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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

    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "I need help with billing",
        callPhase: "discovery",
      }),
    );

    const transcriptEvent = await withTimeout(transcriptEventPromise, "typed transcript event");

    expect(transcriptEvent).toMatchObject({
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "I need help with billing",
      },
    });

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("runs a typed turn through routing, model, and audio events", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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

    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "I need help with billing",
        callPhase: "discovery",
      }),
    );

    const completedEvent = await withTimeout(completedEventPromise, "typed completed event");
    const latencyEvent = await withTimeout(latencyEventPromise, "typed latency event");
    const timestampEvent = await withTimeout(timestampEventPromise, "typed timestamp event");
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

  it("routes billing turns through condition and handoff nodes before responding", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createConditionHandoffManifest("workspace-operations"),
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
    const completedEventPromise = nextMatchingMessage(
      socket,
      (event) => event.type === "turn.completed",
    );

    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "Please route this to the right specialist.",
        callPhase: "discovery",
        intent: "billing",
      }),
    );

    const handoffEvent = await withTimeout(handoffEventPromise, "handoff event");
    await withTimeout(completedEventPromise, "handoff turn completed");

    expect(handoffEvent).toMatchObject({
      sessionId,
      type: "agent.handoff.completed",
      payload: {
        sourceRoleId: "agent-front-desk",
        targetRoleId: "agent-billing",
        targetRoleName: "Billing specialist",
      },
    });
    expect(modelInputs[0]?.activeRole.id).toBe("agent-billing");
    expect(modelInputs[0]?.agentContext?.transfer).toEqual({
      fromAgentName: "Front desk triage",
      reason: "Route invoice disputes to billing.",
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
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createDelayedAudioTtsProvider(secondAudioChunkGate))
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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

    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "I need help with billing",
        callPhase: "discovery",
      }),
    );

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
      .useValue(createFakeSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "voice",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "voice",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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

  it("persists streaming STT provider failures into the session event log", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createFailingStreamingSttProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createFakeTextModelProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createFakeTtsProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "voice",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-operations");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: manifest.publishedVersionId,
        roleId: "agent-front-desk",
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
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
        type: "input.text",
        transcript: "Please look up the customer profile before routing this billing call.",
        callPhase: "tool-use",
      }),
    );

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
        && (event.payload as Record<string, unknown>)["nodeId"] === "tool-customer-profile",
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

  it("executes one agent-requested tool call and returns safe results to the same agent", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryInput: Record<string, unknown> | undefined;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if (input.agentActionMode === true && (input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-customer-profile-1",
              toolAssignmentId: "tool-customer-profile",
              arguments: {
                customerId: "customer-123",
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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-operations");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: manifest.publishedVersionId,
        roleId: "agent-front-desk",
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
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
        type: "input.text",
        transcript: "Can you check my customer profile before billing helps me?",
        callPhase: "tool-use",
      }),
    );

    const completedEvent = await withTimeout(completedEventPromise, "agent-requested tool turn completed");
    await settle();
    unsubscribe();

    expect(registryInput).toMatchObject({
      toolCallId: "tool-call-customer-profile-1",
      arguments: {
        customerId: "customer-123",
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.requested",
        payload: expect.objectContaining({
          nodeId: "agent-front-desk",
          toolCallId: "tool-call-customer-profile-1",
          toolAssignmentId: "tool-customer-profile",
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
    expect(modelInputs[0]?.agentContext?.availableTools).toEqual([
      expect.objectContaining({
        toolAssignmentId: "tool-customer-profile",
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

  it("returns a structured skipped result when an agent-requested tool is missing required input", async () => {
    const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-missing-input",
              toolAssignmentId: "tool-customer-profile",
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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-operations");
    manifest.agentToolAssignments = manifest.agentToolAssignments.map((assignment) => ({
      ...assignment,
      inputSchema: {
        type: "object",
        required: ["customerId"],
      },
      requiredInputs: ["customerId"],
    }));
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
        type: "input.text",
        transcript: "Can you check my customer profile?",
        callPhase: "tool-use",
      }),
    );

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
          summary: "Missing required tool input: customerId.",
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
        summary: "Missing required tool input: customerId.",
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
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue({
        async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
          modelInputs.push(input);

          if ((input.agentContext?.toolResults.length ?? 0) === 0) {
            yield JSON.stringify({
              type: "call_tool",
              toolCallId: "tool-call-approval",
              toolAssignmentId: "tool-customer-profile",
              arguments: {
                customerId: "customer-123",
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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-operations");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: manifest.publishedVersionId,
        roleId: "agent-front-desk",
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
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
        type: "input.text",
        transcript: "Can you check my customer profile?",
        callPhase: "tool-use",
      }),
    );

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

  it("does not check grants for assigned tools until the agent requests a tool", async () => {
    let registryCalled = false;
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createToolExecutionManifest("workspace-operations"),
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
        type: "input.text",
        transcript: "Please look up the customer profile before routing this billing call.",
        callPhase: "tool-use",
      }),
    );

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

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const manifest = createToolExecutionManifest("workspace-operations");
    const grantResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/integrations/tool-grants")
      .send({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        workspaceId: "workspace-operations",
        workflowId: manifest.publishedVersionId,
        roleId: "agent-front-desk",
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
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
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
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
        type: "input.text",
        transcript: "Please look up the customer profile before routing this billing call.",
        callPhase: "tool-use",
      }),
    );

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
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
      });

    const sessionId = String(createResponse.body.session.sessionId);
    const token = String(createResponse.body.session.transportToken);
    const port = getListeningPort(app);
    const firstSocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
    );
    sockets.push(firstSocket);
    await withTimeout(nextOpen(firstSocket), "first websocket open");

    const replaySocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
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
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0);

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
        now: "2020-05-16T00:00:00.000Z",
        ttlMinutes: 0,
      });

    const sessionId = String(createResponse.body.session.sessionId);
    const token = String(createResponse.body.session.transportToken);
    const port = getListeningPort(app);
    const expiredSocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-operations&source=draft`,
    );
    sockets.push(expiredSocket);

    const expiredCloseEvent = await nextClose(expiredSocket);

    const freshResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
      });

    const freshSessionId = String(freshResponse.body.session.sessionId);
    const freshToken = String(freshResponse.body.session.transportToken);
    const workspaceMismatchSocket = new WebSocket(
      `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${freshSessionId}/stream?token=${encodeURIComponent(freshToken)}&workspaceId=workspace-sales&source=draft`,
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

function getListeningPort(app: INestApplication) {
  const address = app.getHttpServer().address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected sandbox websocket test server to listen on a TCP port.");
  }

  return address.port;
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
          reusableSpecialist: true,
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

function createConditionHandoffManifest(workspaceId: string): CompiledRuntimeManifest {
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
          reusableSpecialist: true,
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
              targetNodeId: "handoff-billing",
            },
          ],
          fallbackLabel: "Resolved",
          fallbackTargetNodeId: "end-resolved",
        },
      }),
      createHandoffNode({
        id: "handoff-billing",
        label: "Billing handoff",
        position: { x: 640, y: 24 },
        handoff: {
          targetRoleId: "agent-billing",
          targetRoleName: "Billing specialist",
          handoffReason: "Route invoice disputes to billing.",
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
          reusableSpecialist: true,
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
        targetNodeId: "handoff-billing",
      },
      {
        id: "edge-condition-fallback",
        sourceNodeId: "condition-route",
        targetNodeId: "end-resolved",
      },
      {
        id: "edge-handoff-billing-agent",
        sourceNodeId: "handoff-billing",
        targetNodeId: "agent-billing",
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

function createToolExecutionManifest(workspaceId: string): CompiledRuntimeManifest {
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
          reusableSpecialist: true,
        },
      }),
      createToolNode({
        id: "tool-customer-profile",
        label: "Customer profile API",
        position: { x: 420, y: 80 },
        toolId: "hubspot.profile.lookup",
        tool: {
          connector: "webhook",
          toolName: "Customer profile lookup",
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
      }),
    ],
    edges: [
      {
        id: "edge-entry-front-desk",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
      {
        id: "edge-front-desk-tool",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "tool-customer-profile",
        sourceHandleRole: "tool-call-source",
        targetHandleRole: "tool-call-target",
      },
      {
        id: "edge-tool-front-desk-return",
        sourceNodeId: "tool-customer-profile",
        targetNodeId: "agent-front-desk",
        kind: "return",
        sourceHandleRole: "tool-result-source",
        targetHandleRole: "tool-result-target",
        condition: "success",
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

function createFakeTextModelProvider(): SandwichTextModelProvider {
  return {
    async *streamText(input: {
      manifest: CompiledRuntimeManifest;
      activeRole: VoiceAgentRole;
      transcript: string;
      tier: "rules" | "cheap" | "standard" | "sota";
      context: ModelRoutingContext;
    }) {
      void input;
      yield "Billing support is ready to help with that request.";
    },
  };
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

function createStreamingFakeSttProvider() {
  return {
    availability: {
      configured: true,
      missingEnv: [],
    },
    createStreamingSession(input: {
      onPartial: (event: { transcript: string; confidence: number; language: string }) => void;
      onFinal: (event: { transcript: string; confidence: number; language: string }) => void;
    }) {
      let finalized = false;

      return {
        appendAudioFrame() {
          if (finalized) {
            return;
          }

          input.onPartial({
            transcript: "I need help",
            confidence: 0.88,
            language: "en",
          });
          input.onFinal({
            transcript: "I need help with billing",
            confidence: 0.93,
            language: "en",
          });
          finalized = true;
        },
        close() {},
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
        close() {},
      };
    },
    async transcribeTurn() {
      throw new Error("Legacy buffered transcription should not be used for streaming voice sessions.");
    },
  };
}
