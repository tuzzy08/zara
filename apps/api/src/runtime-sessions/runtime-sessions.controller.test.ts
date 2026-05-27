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
  type ModelRoutingRule,
} from "@zara/core";

import { RuntimeSessionsModule } from "./runtime-sessions.module";

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

describe("RuntimeSessionsController", () => {
  it("creates a premium realtime session server-side", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/runtime/realtime/sessions")
      .send({
        manifest: createCompiledManifest({
          runtime: "openai-realtime",
          runtimeProfile: "premium-realtime",
          billingRuntimeProfileOverride: "premium-realtime",
        }),
        activeRoleId: "agent-billing",
        budgetAllowed: true,
        now: "2026-05-14T11:00:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({
      runtime: "openai-realtime",
      policy: "premium-realtime",
      activeRoleId: "agent-billing",
    });

    await app.close();
  }, 15_000);

  it("rejects premium session creation when the active role is not opted into premium policy", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/runtime/realtime/sessions")
      .send({
        manifest: createCompiledManifest(),
        activeRoleId: "agent-front-desk",
        budgetAllowed: true,
        now: "2026-05-14T11:00:00.000Z",
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("Premium realtime is not enabled for role 'agent-front-desk'.");

    await app.close();
  }, 15_000);

  it("creates Gemini Live realtime sessions with the server-configured model", async () => {
    const previousGeminiLiveModel = process.env.GEMINI_LIVE_MODEL;
    process.env.GEMINI_LIVE_MODEL = "gemini-live-low-latency-preview";

    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .post("/runtime/realtime/sessions")
        .send({
          manifest: createCompiledManifest({
            runtime: "openai-realtime",
            runtimeProfile: "premium-realtime",
            billingRuntimeProfileOverride: "premium-realtime",
            billingRealtimeProvider: "gemini-live",
          }),
          activeRoleId: "agent-billing",
          budgetAllowed: true,
          now: "2026-05-14T11:00:00.000Z",
        });

      expect(response.status).toBe(201);
      expect(response.body.session).toMatchObject({
        runtime: "gemini-live",
        model: "gemini-live-low-latency-preview",
        activeRoleId: "agent-billing",
      });
      expect(response.body.session.transportUrl).toMatch(/^\/runtime\/realtime\/sessions\//);
      expect(response.body.session.transportUrl).not.toContain("generativelanguage.googleapis.com");
    } finally {
      if (previousGeminiLiveModel === undefined) {
        delete process.env.GEMINI_LIVE_MODEL;
      } else {
        process.env.GEMINI_LIVE_MODEL = previousGeminiLiveModel;
      }

      await app.close();
    }
  }, 15_000);
});

function createCompiledManifest(input?: {
  runtime?: "sandwich-pipeline" | "openai-realtime";
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime";
  billingRuntimeProfileOverride?: "balanced" | "premium-realtime";
  billingRealtimeProvider?: "openai-realtime" | "gemini-live";
}) {
  const graph = createWorkflowGraph({
    id: "workflow-runtime-session-api",
    name: "Runtime session API",
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
            supportedLanguages: ["en", "fr"],
            allowMidCallSwitching: true,
          },
          reusableSpecialist: true,
        },
      }),
      createAgentRoleNode({
        id: "agent-billing",
        label: "Billing specialist",
        position: { x: 380, y: 120 },
        role: {
          kind: "billing",
          name: "Billing specialist",
          businessName: "Tuzzy Labs",
          instructions: "Handle billing disputes.",
          defaultModelTier: "standard",
          runtimeProfileOverride: input?.billingRuntimeProfileOverride,
          ...(input?.billingRealtimeProvider !== undefined
            ? { realtimeProvider: input.billingRealtimeProvider }
            : {}),
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
        position: { x: 620, y: 140 },
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
        id: "edge-front-desk-billing",
        sourceNodeId: "agent-front-desk",
        targetNodeId: "agent-billing",
      },
      {
        id: "edge-billing-end",
        sourceNodeId: "agent-billing",
        targetNodeId: "end-resolved",
      },
    ],
  });

  return compileRuntimeManifest({
    publishedVersion: publishWorkflowVersion({
      workflowId: "workflow-runtime-session-api",
      tenantId: "tenant-west-africa",
      environment: "production",
      createdBy: "ops-lead",
      graph,
      existingVersions: [],
      runtime: input?.runtime ?? "sandwich-pipeline",
      runtimeProfile: input?.runtimeProfile,
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
