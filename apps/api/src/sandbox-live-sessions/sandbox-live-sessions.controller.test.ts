import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createEndNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type CompiledRuntimeManifest,
  type ModelRoutingRule,
} from "@zara/core";

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

describe("SandboxLiveSessionsController", () => {
  it("creates a workspace-scoped live sandbox session with a transport token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-operations",
        source: "draft",
        inputMode: "voice",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
      });

    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
      source: "draft",
      inputMode: "voice",
      status: "ready",
      providerStack: {
        stt: "assemblyai-streaming",
        tts: "cartesia-sonic-3",
      },
    });
    expect(response.body.session.transportToken).toMatch(/[A-Za-z0-9_-]{20,}/);
    expect(response.body.session.transportUrl).toContain(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${String(response.body.session.sessionId)}/stream`,
    );

    const getResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${String(response.body.session.sessionId)}`,
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.session.transportToken).toBeUndefined();
    expect(getResponse.body.session.status).toBe("ready");

    await app.close();
  }, 15_000);

  it("rejects live sandbox session creation when the actor cannot access the workspace", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-finance",
        workspaceId: "workspace-operations",
        source: "published",
        inputMode: "typed",
        entryRoleId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-operations"),
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "User 'user-finance' does not have access to workspace 'workspace-operations'.",
    );

    await app.close();
  }, 15_000);

  it("ends a live sandbox session and revokes its transport token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

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
    const transportToken = String(createResponse.body.session.transportToken);

    expect(service.validateTransportToken({
      organizationId: "tenant-west-africa",
      sessionId,
      token: transportToken,
    })).toBe(true);

    const endResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/end`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(endResponse.status).toBe(200);
    expect(endResponse.body.session.status).toBe("ended");
    expect(service.validateTransportToken({
      organizationId: "tenant-west-africa",
      sessionId,
      token: transportToken,
    })).toBe(false);

    await app.close();
  }, 15_000);
});

function createCompiledManifest(workspaceId: string): CompiledRuntimeManifest {
  const graph = createWorkflowGraph({
    id: "workflow-live-sandbox-session-api",
    name: "Live sandbox session API",
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
            supportedLanguages: ["en", "fr"],
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
      workflowId: "workflow-live-sandbox-session-api",
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
