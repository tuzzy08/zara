import { afterEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createHandoffNode,
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

  afterEach(() => {
    while (sockets.length > 0) {
      const socket = sockets.pop();
      socket?.close();
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

    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "I need help with billing",
        callPhase: "discovery",
      }),
    );

    const completedEvent = await withTimeout(completedEventPromise, "typed completed event");
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
    expect(replayResponse.status).toBe(200);

    socket.close();
    await nextClose(socket);
    await app.close();
  }, 20_000);

  it("routes billing turns through condition and handoff nodes before responding", async () => {
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

    socket.send(
      JSON.stringify({
        type: "input.text",
        transcript: "I need help with billing",
        callPhase: "discovery",
      }),
    );

    const handoffEvent = await withTimeout(handoffEventPromise, "handoff event");

    expect(handoffEvent).toMatchObject({
      sessionId,
      type: "agent.handoff.completed",
      payload: {
        targetRoleId: "agent-billing",
        targetRoleName: "Billing specialist",
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
        audio: (async function* () {
          yield "QmlsbGluZyBhdWRpbyBjaHVuaw==";
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
