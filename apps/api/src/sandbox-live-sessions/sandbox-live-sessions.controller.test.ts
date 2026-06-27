import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createEndNode,
  createToolNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type CompiledRuntimeManifest,
  type ModelRoutingRule,
  type SandwichTextModelProvider,
  type TextModelProviderId,
} from "@zara/core";

import { installTestTenantAuth, withTestTenantAuth } from "../testing/tenant-auth-request";
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

const originalIntegrationStateDirectory = process.env.ZARA_INTEGRATION_STATE_DIR;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalAssemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY;
const originalCartesiaApiKey = process.env.CARTESIA_API_KEY;
let tempIntegrationStateDirectory = "";

describe("SandboxLiveSessionsController", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.ASSEMBLYAI_API_KEY = "test-assemblyai-key";
    process.env.CARTESIA_API_KEY = "test-cartesia-key";
  });

  afterEach(() => {
    if (tempIntegrationStateDirectory.length > 0) {
      rmSync(tempIntegrationStateDirectory, { recursive: true, force: true });
      tempIntegrationStateDirectory = "";
    }

    if (originalIntegrationStateDirectory === undefined) {
      delete process.env.ZARA_INTEGRATION_STATE_DIR;
    } else {
      process.env.ZARA_INTEGRATION_STATE_DIR = originalIntegrationStateDirectory;
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

  it("requires tenant membership for tenant live sandbox routes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createConfiguredProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    expect(response.status).toBe(401);

    await app.close();
  }, 15_000);

  it("creates a workspace-scoped live sandbox session with a transport token", async () => {
    const warmTtsProvider = {
      ...createConfiguredProvider(),
      warm: vi.fn(async () => {}),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(warmTtsProvider)
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      source: "draft",
      inputMode: "voice",
      entryAgentId: "agent-front-desk",
      status: "ready",
      providerStack: {
        stt: "assemblyai-streaming",
        tts: "cartesia-sonic-3",
      },
    });
    expect(response.body.session.entryRoleId).toBeUndefined();
    expect(response.body.session.transportToken).toMatch(/[A-Za-z0-9_-]{20,}/);
    expect(response.body.session.transportUrl).toContain(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${String(response.body.session.sessionId)}/stream`,
    );
    expect(warmTtsProvider.warm).toHaveBeenCalledOnce();

    const getResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${String(response.body.session.sessionId)}`,
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.session.transportToken).toBeUndefined();
    expect(getResponse.body.session.status).toBe("ready");

    await app.close();
  }, 15_000);

  it("rejects retired typed live sandbox session creation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createConfiguredProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "typed",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Live sandbox sessions are voice-only.");

    await app.close();
  }, 15_000);

  it("rejects voice sandbox session creation when provider credentials are missing", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    delete process.env.CARTESIA_API_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      "Live voice sandbox requires provider credentials before recording can start. Missing: ASSEMBLYAI_API_KEY, CARTESIA_API_KEY.",
    );

    await app.close();
  }, 15_000);

  it("starts a cost optimized voice sandbox when speech providers are configured without OpenAI", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(createConfiguredProvider())
      .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
      .useValue(createConfiguredProvider())
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({
      inputMode: "voice",
      runtimeProfile: "cost-optimized",
      status: "ready",
    });

    await app.close();
  }, 15_000);

  it("checks the concrete entry agent text provider before stale role snapshots", async () => {
    const textModelProvider = createTextModelProviderAvailabilityProbe({
      "google-gemini": {
        configured: false,
        missingEnv: ["GEMINI_API_KEY"],
      },
      openai: {
        configured: true,
        missingEnv: [],
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(textModelProvider)
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createConcreteEntryModelProviderManifest("workspace-default"),
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      "Gemini text model is not configured. Missing: GEMINI_API_KEY.",
    );
    expect(textModelProvider.getProviderAvailability).toHaveBeenCalledWith("google-gemini");

    await app.close();
  }, 15_000);

  it("rejects stale role snapshots when the concrete entry agent is missing", async () => {
    const textModelProvider = createTextModelProviderAvailabilityProbe({
      "google-gemini": {
        configured: false,
        missingEnv: ["GEMINI_API_KEY"],
      },
      openai: {
        configured: true,
        missingEnv: [],
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    })
      .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
      .useValue(textModelProvider)
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "draft",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: withoutGraphAgent(
          createConcreteEntryModelProviderManifest("workspace-default"),
          "agent-front-desk",
        ),
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("has no concrete entry agent 'agent-front-desk'");
    expect(textModelProvider.getProviderAvailability).not.toHaveBeenCalled();

    await app.close();
  }, 15_000);

  it("rejects published live sandbox sessions when integration tool grants are incomplete", async () => {
    tempIntegrationStateDirectory = mkdtempSync(join(tmpdir(), "zara-sandbox-publish-grants-"));
    process.env.ZARA_INTEGRATION_STATE_DIR = tempIntegrationStateDirectory;
    seedSandboxIntegrationState(tempIntegrationStateDirectory);
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default", undefined, {
          hubSpotConnectionId: "hubspot-prod",
        }),
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      message: "Workflow cannot be published because integration tool permissions are incomplete.",
      errors: [
        expect.objectContaining({
          code: "tool_permission_denied",
          nodeId: "tool-customer-profile",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: "hubspot-prod",
        }),
      ],
    });

    await app.close();
  }, 15_000);

  it("rejects live sandbox session creation when the actor cannot access the workspace", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const response = await withTestTenantAuth(
      request(app.getHttpServer()).post("/organizations/tenant-west-africa/sandbox/live-sessions"),
      { userId: "user-finance" },
    )
      .send({
        actorUserId: "user-finance",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "User 'user-finance' does not have access to workspace 'workspace-default'.",
    );

    await app.close();
  }, 15_000);

  it("ends a live sandbox session and revokes its transport token", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

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
    const transportToken = String(createResponse.body.session.transportToken);

    expect(service.authorizeTransportConnection({
      organizationId: "tenant-west-africa",
      sessionId,
      token: transportToken,
      workspaceId: "workspace-default",
      source: "draft",
    })).toBe(true);

    const endResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/end`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(endResponse.status).toBe(200);
    expect(endResponse.body.session.status).toBe("ended");
    expect(service.authorizeTransportConnection({
      organizationId: "tenant-west-africa",
      sessionId,
      token: transportToken,
      workspaceId: "workspace-default",
      source: "draft",
    })).toBe(false);

    await app.close();
  }, 15_000);

  it("lists active sessions, replays events, and issues reconnect tokens", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

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
    const transportToken = String(createResponse.body.session.transportToken);

    expect(service.authorizeTransportConnection({
      organizationId: "tenant-west-africa",
      sessionId,
      token: transportToken,
      workspaceId: "workspace-default",
      source: "draft",
    })).toBe(true);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "Call me at +14155557890",
      },
      at: "2026-05-16T09:00:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "routing.model_selected",
      payload: {
        tier: "standard",
        source: "rule",
        reason: "Billing discovery needs a stronger reasoning tier.",
      },
      at: "2026-05-16T09:00:01.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "agent.handoff.completed",
      payload: {
        targetAgentId: "agent-billing",
        targetAgentName: "Billing specialist",
      },
      at: "2026-05-16T09:00:02.000Z",
    });

    const listResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/sandbox/live-sessions?workspaceId=workspace-default&includeEnded=true",
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.sessions[0]).toMatchObject({
      sessionId,
      status: "active",
      activeAgentName: "Billing specialist",
      runtimeTier: "standard",
      eventCount: 3,
    });
    expect(listResponse.body.sessions[0].activeRoleName).toBeUndefined();

    const eventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events?afterSequence=1`,
    );

    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.body.events).toHaveLength(2);
    expect(eventsResponse.body.events[0]).toMatchObject({
      type: "routing.model_selected",
    });

    const reconnectResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/reconnect`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(reconnectResponse.status).toBe(200);
    expect(reconnectResponse.body.session.transportToken).toMatch(/[A-Za-z0-9_-]{20,}/);
    expect(service.authorizeTransportConnection({
      organizationId: "tenant-west-africa",
      sessionId,
      token: String(reconnectResponse.body.session.transportToken),
      workspaceId: "workspace-default",
      source: "draft",
    })).toBe(true);

    await app.close();
  }, 15_000);

  it("keeps session memory through interruption and reconnect, then summarizes it on end", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

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
    const transportToken = String(createResponse.body.session.transportToken);

    expect(service.authorizeTransportConnection({
      organizationId: "tenant-west-africa",
      sessionId,
      token: transportToken,
      workspaceId: "workspace-default",
      source: "draft",
    })).toBe(true);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "My name is Ada and I need help with invoice INV-204.",
        source: "voice",
        callPhase: "discovery",
      },
      at: "2026-05-17T11:00:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "input.audio.buffered",
      payload: {
        chunkCount: 1,
      },
      at: "2026-05-17T11:00:01.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "Sorry, I got interrupted. The invoice is for the Lagos workspace.",
        source: "voice",
        callPhase: "discovery",
      },
      at: "2026-05-17T11:00:02.000Z",
    });

    const memoryResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/memory`,
    );

    expect(memoryResponse.status).toBe(200);
    expect(memoryResponse.body.memory).toMatchObject({
      status: "active",
      entryCount: 2,
      entries: [
        expect.objectContaining({
          sourceEventType: "turn.transcribed",
          text: "My name is Ada and I need help with invoice INV-204.",
        }),
        expect.objectContaining({
          sourceEventType: "turn.transcribed",
          text: "Sorry, I got interrupted. The invoice is for the Lagos workspace.",
        }),
      ],
    });

    const reconnectResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/reconnect`)
      .send({
        actorUserId: "user-ops-lead",
      });
    expect(reconnectResponse.status).toBe(200);

    const resumedMemoryResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/memory`,
    );

    expect(resumedMemoryResponse.status).toBe(200);
    expect(resumedMemoryResponse.body.memory.entryCount).toBe(2);
    expect(JSON.stringify(resumedMemoryResponse.body.memory)).not.toContain("audioBase64");

    const endResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/end`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-17T11:05:00.000Z",
      });

    expect(endResponse.status).toBe(200);
    expect(endResponse.body.session.memory).toMatchObject({
      status: "summarized",
      entryCount: 0,
      summary: expect.stringContaining("invoice INV-204"),
    });

    const endedMemoryResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/memory`,
    );

    expect(endedMemoryResponse.status).toBe(200);
    expect(endedMemoryResponse.body.memory).toMatchObject({
      status: "summarized",
      entryCount: 0,
      entries: [],
      summary: expect.stringContaining("Lagos workspace"),
    });

    await app.close();
  }, 15_000);

  it("aggregates model tool latency and cost telemetry by tenant and call with missing usage data", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const firstResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const secondResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    await request(app.getHttpServer())
      .post("/organizations/tenant-east-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });

    const firstSessionId = String(firstResponse.body.session.sessionId);
    const secondSessionId = String(secondResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId: firstSessionId,
      type: "provider.telemetry",
      payload: {
        stage: "model",
        provider: "openai-chat",
        latencyMs: 240,
        tier: "standard",
      },
      at: "2026-05-19T14:00:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId: firstSessionId,
      type: "provider.telemetry",
      payload: {
        stage: "tts",
        provider: "cartesia-sonic-3",
        latencyMs: 110,
      },
      at: "2026-05-19T14:00:01.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId: firstSessionId,
      type: "tool.completed",
      payload: {
        toolId: "hubspot.profile.lookup",
        toolName: "Customer profile lookup",
        durationMs: 42,
      },
      at: "2026-05-19T14:00:02.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId: firstSessionId,
      type: "turn.cost.delta",
      payload: {
        currency: "USD",
        totalUsd: 0.0123,
        usage: {
          callMinutes: 0.08,
          sttMinutes: 0.08,
          modelInputTokens: 120,
          modelOutputTokens: 45,
          ttsCharacters: 180,
          storageMb: 0.03,
        },
        modelTier: "standard",
      },
      at: "2026-05-19T14:00:03.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId: secondSessionId,
      type: "provider.telemetry",
      payload: {
        stage: "model",
        provider: "openai-chat",
        latencyMs: 90,
        tier: "cheap",
      },
      at: "2026-05-19T14:01:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId: secondSessionId,
      type: "turn.cost.delta",
      payload: {
        currency: "USD",
        totalUsd: 0.004,
        modelTier: "cheap",
      },
      at: "2026-05-19T14:01:01.000Z",
    });

    const telemetryResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/sandbox/live-sessions/telemetry?workspaceId=workspace-default",
    );

    expect(telemetryResponse.status).toBe(200);
    expect(telemetryResponse.body.telemetry).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      callCount: 2,
      totals: {
        costUsd: 0.0163,
        modelLatencyMs: 330,
        ttsLatencyMs: 110,
        toolDurationMs: 42,
        toolCount: 1,
        modelInputTokens: 120,
        modelOutputTokens: 45,
        ttsCharacters: 180,
        missingUsageEventCount: 1,
      },
    });
    expect(
      telemetryResponse.body.telemetry.calls.map(
        (call: { sessionId: string; costUsd: number; missingUsageData: boolean; toolDurationMs: number }) => ({
          sessionId: call.sessionId,
          costUsd: call.costUsd,
          missingUsageData: call.missingUsageData,
          toolDurationMs: call.toolDurationMs,
        }),
      ),
    ).toEqual([
      {
        sessionId: secondSessionId,
        costUsd: 0.004,
        missingUsageData: true,
        toolDurationMs: 0,
      },
      {
        sessionId: firstSessionId,
        costUsd: 0.0123,
        missingUsageData: false,
        toolDurationMs: 42,
      },
    ]);

    await app.close();
  }, 15_000);

  it("queues escalation requests with SLA handling and agent decisions", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "escalation.requested",
      payload: {
        nodeId: "human-escalation-billing",
        queueId: "billing-ops",
        queueName: "Billing managers",
        reason: "Caller asked for a billing supervisor.",
        slaSeconds: 60,
        fallbackMode: "callback",
        fallbackMessage: "No billing manager is free, so we will schedule a callback.",
      },
      at: "2026-05-19T15:00:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "escalation.requested",
      payload: {
        nodeId: "human-escalation-billing",
        queueId: "billing-ops",
        queueName: "Billing managers",
        reason: "Duplicate escalation should not create a second queue item.",
        slaSeconds: 60,
        fallbackMode: "callback",
        fallbackMessage: "No billing manager is free, so we will schedule a callback.",
      },
      at: "2026-05-19T15:00:05.000Z",
    });

    const listResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/sandbox/live-sessions/escalations?workspaceId=workspace-default&now=2026-05-19T15:00:30.000Z",
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.escalations).toHaveLength(1);
    expect(listResponse.body.escalations[0]).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      sessionId,
      nodeId: "human-escalation-billing",
      queueId: "billing-ops",
      queueName: "Billing managers",
      reason: "Caller asked for a billing supervisor.",
      status: "pending",
      requestedAt: "2026-05-19T15:00:00.000Z",
      slaDeadlineAt: "2026-05-19T15:01:00.000Z",
      fallbackMode: "callback",
    });
    const acceptedEscalationId = String(listResponse.body.escalations[0].escalationId);

    const acceptResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/escalations/${acceptedEscalationId}/accept`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T15:00:40.000Z",
      });

    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.escalation).toMatchObject({
      escalationId: acceptedEscalationId,
      status: "accepted",
      acceptedByUserId: "user-ops-lead",
      resolvedAt: "2026-05-19T15:00:40.000Z",
    });

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "escalation.requested",
      payload: {
        nodeId: "human-escalation-after-hours",
        queueId: "after-hours",
        queueName: "After hours desk",
        reason: "Caller needs after-hours help.",
        slaSeconds: 120,
        fallbackMode: "ticket",
        fallbackMessage: "We will open a ticket for the after-hours team.",
      },
      at: "2026-05-19T15:02:00.000Z",
    });
    const declineListResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/sandbox/live-sessions/escalations?workspaceId=workspace-default&now=2026-05-19T15:02:10.000Z",
    );
    const declinedEscalationId = String(
      declineListResponse.body.escalations.find(
        (escalation: { nodeId: string }) => escalation.nodeId === "human-escalation-after-hours",
      ).escalationId,
    );

    const declineResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/escalations/${declinedEscalationId}/decline`)
      .send({
        actorUserId: "user-ops-lead",
        reason: "No after-hours specialist is online.",
        now: "2026-05-19T15:02:20.000Z",
      });

    expect(declineResponse.status).toBe(200);
    expect(declineResponse.body.escalation).toMatchObject({
      escalationId: declinedEscalationId,
      status: "declined",
      declinedByUserId: "user-ops-lead",
      declineReason: "No after-hours specialist is online.",
      resolvedAt: "2026-05-19T15:02:20.000Z",
    });

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "escalation.requested",
      payload: {
        nodeId: "human-escalation-sla",
        queueId: "support-ops",
        queueName: "Support operations",
        reason: "Caller has waited too long.",
        slaSeconds: 30,
        fallbackMode: "voicemail",
        fallbackMessage: "No operator accepted in time. Please leave a voicemail.",
      },
      at: "2026-05-19T15:03:00.000Z",
    });

    const timeoutResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-west-africa/sandbox/live-sessions/escalations?workspaceId=workspace-default&now=2026-05-19T15:03:45.000Z",
    );
    const timedOutEscalation = timeoutResponse.body.escalations.find(
      (escalation: { nodeId: string }) => escalation.nodeId === "human-escalation-sla",
    );

    expect(timedOutEscalation).toMatchObject({
      status: "fallback_triggered",
      fallbackTriggeredAt: "2026-05-19T15:03:45.000Z",
      fallbackMode: "voicemail",
      fallbackMessage: "No operator accepted in time. Please leave a voicemail.",
    });

    const eventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
    );

    expect(eventsResponse.body.events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining([
        "escalation.accepted",
        "escalation.declined",
        "escalation.failed",
      ]),
    );

    await app.close();
  }, 15_000);

  it("creates a redacted post-call summary with disposition action items and CRM sync target", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "My email is ada@example.com and my card is 4242 4242 4242 4242. I need a billing callback tomorrow.",
      },
      at: "2026-05-19T17:00:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "tool.completed",
      payload: {
        toolId: "hubspot.note.create",
        toolName: "HubSpot note",
        summary: "Created CRM note for billing case INV-204.",
        durationMs: 41,
      },
      at: "2026-05-19T17:00:01.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Please schedule a callback for invoice INV-204.",
        responseText: "We will schedule a billing callback and note the invoice dispute.",
      },
      at: "2026-05-19T17:00:02.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "escalation.accepted",
      payload: {
        escalationId: "escalation-billing-1",
        acceptedByUserId: "user-ops-lead",
      },
      at: "2026-05-19T17:00:03.000Z",
    });

    const summaryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/summary`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T17:05:00.000Z",
        crmSyncTarget: {
          provider: "hubspot",
          connectionId: "hubspot-oauth-1",
          objectType: "contact",
          externalId: "contact-ada",
        },
      });

    expect(summaryResponse.status).toBe(201);
    expect(summaryResponse.body.summary).toMatchObject({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      sessionId,
      outcome: "human_escalated",
      disposition: "callback_requested",
      createdByUserId: "user-ops-lead",
      createdAt: "2026-05-19T17:05:00.000Z",
      actionItems: [
        expect.objectContaining({
          label: "Schedule callback",
          status: "open",
        }),
        expect.objectContaining({
          label: "Review billing issue",
          status: "open",
        }),
      ],
      crmSync: {
        status: "queued",
        provider: "hubspot",
        connectionId: "hubspot-oauth-1",
        objectType: "contact",
        externalId: "contact-ada",
      },
    });
    expect(summaryResponse.body.summary.summaryText).toContain("[redacted-email]");
    expect(summaryResponse.body.summary.summaryText).toContain("[redacted-payment-card]");
    expect(JSON.stringify(summaryResponse.body.summary)).not.toContain("ada@example.com");
    expect(JSON.stringify(summaryResponse.body.summary)).not.toContain("4242 4242 4242 4242");

    const eventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
    );

    expect(eventsResponse.body.events.at(-1)).toMatchObject({
      type: "post_call.summary.created",
      payload: {
        summaryId: summaryResponse.body.summary.summaryId,
        disposition: "callback_requested",
        crmSyncStatus: "queued",
      },
    });

    await app.close();
  }, 15_000);

  it("redacts configured transcript storage and restricts original sensitive values from events memory and summaries", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default", {
          redactSensitiveData: true,
        }),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.transcribed",
      payload: {
        transcript: "My email is ada@example.com, card 4242 4242 4242 4242, phone +14155557890, invoice INV-204.",
      },
      at: "2026-05-19T17:10:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Please send the receipt to ada@example.com for card 4242 4242 4242 4242.",
        responseText: "I will keep invoice INV-204 on the billing callback.",
      },
      at: "2026-05-19T17:10:01.000Z",
    });

    const eventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
    );
    const memoryResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/memory`,
    );
    const summaryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/summary`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T17:15:00.000Z",
      });

    const combinedStoredPayloads = JSON.stringify({
      events: eventsResponse.body.events,
      memory: memoryResponse.body.memory,
      summary: summaryResponse.body.summary,
    });

    expect(combinedStoredPayloads).toContain("[redacted-email]");
    expect(combinedStoredPayloads).toContain("[redacted-payment-card]");
    expect(combinedStoredPayloads).toContain("[redacted-phone]");
    expect(combinedStoredPayloads).toContain("INV-204");
    expect(combinedStoredPayloads).not.toContain("ada@example.com");
    expect(combinedStoredPayloads).not.toContain("4242 4242 4242 4242");
    expect(combinedStoredPayloads).not.toContain("+14155557890");

    await app.close();
  }, 15_000);

  it("shows post-call CRM sync status with retry diagnostics and queues retries", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Please update the HubSpot contact with the callback summary.",
        responseText: "I will note the callback outcome.",
      },
      at: "2026-05-19T18:00:00.000Z",
    });

    const summaryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/summary`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T18:01:00.000Z",
        crmSyncTarget: {
          provider: "hubspot",
          connectionId: "hubspot-oauth-1",
          objectType: "contact",
          externalId: "contact-ada",
        },
      });
    const summaryId = String(summaryResponse.body.summary.summaryId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "post_call.crm_sync.failed",
      payload: {
        summaryId,
        provider: "hubspot",
        connectionId: "hubspot-oauth-1",
        code: "crm_rate_limited",
        message: "HubSpot rate limit reached. Retry after the provider reset window.",
        retryable: true,
        nextStep: "Retry the CRM note sync after the reset window or reconnect HubSpot if this repeats.",
        attemptCount: 1,
        nextRetryAt: "2026-05-19T18:06:00.000Z",
        token: "raw-oauth-token-should-not-leak",
      },
      at: "2026-05-19T18:02:00.000Z",
    });

    const statusResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/crm-sync`,
    );

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.crmSyncStatuses).toEqual([
      expect.objectContaining({
        summaryId,
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-default",
        sessionId,
        status: "failed",
        provider: "hubspot",
        connectionId: "hubspot-oauth-1",
        objectType: "contact",
        externalId: "contact-ada",
        attemptCount: 1,
        lastAttemptAt: "2026-05-19T18:02:00.000Z",
        nextRetryAt: "2026-05-19T18:06:00.000Z",
        diagnostic: {
          code: "crm_rate_limited",
          message: "HubSpot rate limit reached. Retry after the provider reset window.",
          retryable: true,
          nextStep: "Retry the CRM note sync after the reset window or reconnect HubSpot if this repeats.",
        },
      }),
    ]);
    expect(JSON.stringify(statusResponse.body)).not.toContain("raw-oauth-token-should-not-leak");

    const retryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/crm-sync/${summaryId}/retry`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T18:03:00.000Z",
      });

    expect(retryResponse.status).toBe(200);
    expect(retryResponse.body.crmSyncStatus).toMatchObject({
      summaryId,
      status: "retry_queued",
      attemptCount: 2,
      retryQueuedAt: "2026-05-19T18:03:00.000Z",
      nextRetryAt: "2026-05-19T18:04:00.000Z",
      diagnostic: {
        code: "crm_rate_limited",
        retryable: true,
      },
    });

    const eventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
    );

    expect(eventsResponse.body.events.at(-1)).toMatchObject({
      type: "post_call.crm_sync.retry_queued",
      payload: {
        summaryId,
        provider: "hubspot",
        connectionId: "hubspot-oauth-1",
        attemptCount: 2,
      },
    });

    await app.close();
  }, 15_000);

  it("blocks post-call CRM sync retry when the side-effect ledger has an unknown write", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Please write the HubSpot call note.",
        responseText: "I will write the call note.",
      },
      at: "2026-05-19T19:00:00.000Z",
    });

    const summaryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/summary`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T19:01:00.000Z",
        crmSyncTarget: {
          provider: "hubspot",
          connectionId: "hubspot-oauth-1",
          objectType: "contact",
          externalId: "contact-ada",
        },
      });
    const summaryId = String(summaryResponse.body.summary.summaryId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "integration.side_effect.recorded",
      payload: {
        status: "unknown",
        provider: "hubspot",
        integrationConnectionId: "hubspot-oauth-1",
        objectType: "contact",
        externalId: "contact-ada",
        toolId: "hubspot.notes.create",
        idempotencyKey: "tenant-west-africa:session:turn:tool",
        retryPosture: "manual_review_required",
        token: "raw-oauth-token-should-not-leak",
      },
      at: "2026-05-19T19:01:30.000Z",
    });

    const retryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/crm-sync/${summaryId}/retry`)
      .send({
        actorUserId: "user-ops-lead",
        now: "2026-05-19T19:02:00.000Z",
      });

    expect(retryResponse.status).toBe(409);
    expect(retryResponse.body.message).toContain("manual review");
    expect(JSON.stringify(retryResponse.body)).not.toContain("raw-oauth-token-should-not-leak");

    const eventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
    );

    expect(eventsResponse.body.events).not.toContainEqual(
      expect.objectContaining({
        type: "post_call.crm_sync.retry_queued",
      }),
    );

    await app.close();
  }, 15_000);

  it("includes safe failed-tool outcomes in post-call summaries", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Please create a support ticket for invoice INV-204.",
        responseText: "I could not confirm whether the ticket was created.",
      },
      at: "2026-05-19T19:10:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "tool.failed",
      payload: {
        summary: "Tool 'HubSpot note writer' has an unknown provider write outcome.",
        error: {
          code: "tool_execution.side_effect_unknown",
          message: "token=raw-oauth-token-should-not-leak",
          recoverable: true,
        },
      },
      at: "2026-05-19T19:10:01.000Z",
    });

    const summaryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/summary`)
      .send({
        actorUserId: "user-ops-lead",
      });

    expect(summaryResponse.status).toBe(201);
    expect(summaryResponse.body.summary.summaryText).toContain(
      "Tool 'HubSpot note writer' has an unknown provider write outcome.",
    );
    expect(JSON.stringify(summaryResponse.body)).not.toContain("raw-oauth-token-should-not-leak");

    await app.close();
  }, 15_000);

  it("flags quality risks and creates approval-gated draft improvement suggestions", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "routing.dead_end",
      payload: {
        nodeId: "condition-intent",
        reason: "No branch matched the caller's billing dispute.",
      },
      at: "2026-05-19T19:00:00.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Can you confirm whether invoice INV-204 was refunded?",
        responseText: "The refund was completed yesterday.",
        groundingConfidence: 0.22,
      },
      at: "2026-05-19T19:00:01.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "provider.telemetry",
      payload: {
        stage: "model",
        provider: "openai-chat",
        latencyMs: 6200,
      },
      at: "2026-05-19T19:00:02.000Z",
    });
    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "escalation.failed",
      payload: {
        escalationId: "escalation-billing-1",
        reason: "sla_timeout",
      },
      at: "2026-05-19T19:00:03.000Z",
    });

    const qualityResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/quality`,
    );

    expect(qualityResponse.status).toBe(200);
    expect(qualityResponse.body.quality.flags.map((flag: { kind: string }) => flag.kind)).toEqual([
      "dead_end",
      "hallucination_risk",
      "slow_turn",
      "escalation_miss",
    ]);
    expect(qualityResponse.body.quality.flags).toEqual([
      expect.objectContaining({
        kind: "dead_end",
        severity: "high",
        eventSequence: 1,
      }),
      expect.objectContaining({
        kind: "hallucination_risk",
        severity: "high",
        eventSequence: 2,
      }),
      expect.objectContaining({
        kind: "slow_turn",
        severity: "medium",
        eventSequence: 3,
      }),
      expect.objectContaining({
        kind: "escalation_miss",
        severity: "high",
        eventSequence: 4,
      }),
    ]);
    expect(
      qualityResponse.body.quality.suggestions.map(
        (suggestion: {
          status: string;
          approvalRequired: boolean;
          draftChange: { target: string; appliesToPublishedVersion: boolean };
        }) => ({
          status: suggestion.status,
          approvalRequired: suggestion.approvalRequired,
          target: suggestion.draftChange.target,
          appliesToPublishedVersion: suggestion.draftChange.appliesToPublishedVersion,
        }),
      ),
    ).toEqual([
      {
        status: "pending_approval",
        approvalRequired: true,
        target: "workflow_draft",
        appliesToPublishedVersion: false,
      },
      {
        status: "pending_approval",
        approvalRequired: true,
        target: "workflow_draft",
        appliesToPublishedVersion: false,
      },
      {
        status: "pending_approval",
        approvalRequired: true,
        target: "workflow_draft",
        appliesToPublishedVersion: false,
      },
      {
        status: "pending_approval",
        approvalRequired: true,
        target: "workflow_draft",
        appliesToPublishedVersion: false,
      },
    ]);
    expect(JSON.stringify(qualityResponse.body.quality)).toContain("No branch matched");
    expect(JSON.stringify(qualityResponse.body.quality)).not.toContain("published_change");

    await app.close();
  }, 15_000);

  it("does not expose live call session records, events, summaries, or monitoring state across tenants", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SandboxLiveSessionsModule],
    }).compile();

    const app: INestApplication = moduleRef.createNestApplication();
    installTestTenantAuth(app);
    await app.init();

    const service = moduleRef.get(SandboxLiveSessionsService);
    const createResponse = await request(app.getHttpServer())
      .post("/organizations/tenant-west-africa/sandbox/live-sessions")
      .send({
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
        source: "published",
        inputMode: "voice",
        entryAgentId: "agent-front-desk",
        manifest: createCompiledManifest("workspace-default"),
      });
    const sessionId = String(createResponse.body.session.sessionId);

    service.publishSessionEvent({
      organizationId: "tenant-west-africa",
      sessionId,
      type: "turn.completed",
      payload: {
        transcript: "Tenant west call transcript must not leak.",
        responseText: "Tenant west response.",
      },
      at: "2026-05-19T20:00:00.000Z",
    });
    const summaryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/summary`)
      .send({
        actorUserId: "user-ops-lead",
        crmSyncTarget: {
          provider: "hubspot",
          connectionId: "hubspot-oauth-1",
          objectType: "contact",
        },
      });
    const summaryId = String(summaryResponse.body.summary.summaryId);

    const crossTenantSessionResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-east-africa/sandbox/live-sessions/${sessionId}`,
    );
    const crossTenantEventsResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-east-africa/sandbox/live-sessions/${sessionId}/events`,
    );
    const crossTenantQualityResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-east-africa/sandbox/live-sessions/${sessionId}/quality`,
    );
    const crossTenantCrmStatusResponse = await request(app.getHttpServer()).get(
      `/organizations/tenant-east-africa/sandbox/live-sessions/${sessionId}/crm-sync`,
    );
    const crossTenantRetryResponse = await request(app.getHttpServer())
      .post(`/organizations/tenant-east-africa/sandbox/live-sessions/${sessionId}/crm-sync/${summaryId}/retry`)
      .send({
        actorUserId: "user-ops-lead",
      });
    const eastListResponse = await request(app.getHttpServer()).get(
      "/organizations/tenant-east-africa/sandbox/live-sessions?includeEnded=true",
    );

    expect(crossTenantSessionResponse.status).toBe(404);
    expect(crossTenantEventsResponse.status).toBe(404);
    expect(crossTenantQualityResponse.status).toBe(404);
    expect(crossTenantCrmStatusResponse.status).toBe(404);
    expect(crossTenantRetryResponse.status).toBe(404);
    expect(eastListResponse.status).toBe(200);
    expect(eastListResponse.body.sessions).toEqual([]);
    expect(JSON.stringify(crossTenantEventsResponse.body)).not.toContain("Tenant west call transcript");

    await app.close();
  }, 15_000);
});

function createCompiledManifest(
  workspaceId: string,
  telemetryOverrides?: Partial<CompiledRuntimeManifest["telemetry"]>,
  options?: { hubSpotConnectionId?: string | undefined },
): CompiledRuntimeManifest {
  const hubSpotToolNode =
    options?.hubSpotConnectionId === undefined
      ? undefined
      : createToolNode({
          id: "tool-customer-profile",
          label: "Customer profile API",
          position: { x: 300, y: 80 },
          toolId: "hubspot.profile.lookup",
          tool: {
            connector: "hubspot",
            toolName: "Customer profile lookup",
            integrationConnectionId: options.hubSpotConnectionId,
            integrationLabel: "HubSpot - Production",
            connectionStatus: "connected",
            risk: "low",
            requiresAuthorization: true,
            requiresHumanApproval: false,
          },
        });
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
          businessName: "Tuzzy Labs",
          instructions: "Greet the caller and route safely.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en", "fr"],
            allowMidCallSwitching: true,
          },
        },
      }),
      ...(hubSpotToolNode === undefined ? [] : [hubSpotToolNode]),
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
      ...(hubSpotToolNode === undefined
        ? []
        : [
            {
              id: "edge-front-desk-customer-profile",
              sourceNodeId: "agent-front-desk",
              targetNodeId: "tool-customer-profile",
              sourceHandleRole: "tool-call-source" as const,
              targetHandleRole: "tool-call-target" as const,
            },
            {
              id: "edge-customer-profile-front-desk",
              sourceNodeId: "tool-customer-profile",
              targetNodeId: "agent-front-desk",
              kind: "return" as const,
              sourceHandleRole: "tool-result-source" as const,
              targetHandleRole: "tool-result-target" as const,
              condition: "success",
            },
          ]),
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
      ...telemetryOverrides,
    },
  });
}

function createConcreteEntryModelProviderManifest(workspaceId: string): CompiledRuntimeManifest {
  const manifest = createCompiledManifest(workspaceId);

  return {
    ...manifest,
    roles: manifest.roles.map((role) =>
      role.id === "agent-front-desk"
        ? {
            ...role,
            modelProvider: "openai",
          }
        : role,
    ),
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
              modelProvider: "google-gemini",
            },
          },
        };
      }),
    },
  };
}

function withoutGraphAgent(
  manifest: CompiledRuntimeManifest,
  agentId: string,
): CompiledRuntimeManifest {
  return {
    ...manifest,
    graph: {
      ...manifest.graph,
      nodes: manifest.graph.nodes.filter((node) => node.id !== agentId),
    },
  };
}

function seedSandboxIntegrationState(directoryPath: string) {
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
            scopes: ["crm.objects.contacts.read"],
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

function createConfiguredProvider() {
  return {
    availability: {
      configured: true,
      missingEnv: [],
    },
  };
}

function createTextModelProviderAvailabilityProbe(
  availabilityByProvider: Record<TextModelProviderId, { configured: boolean; missingEnv: string[] }>,
): SandwichTextModelProvider & {
  availability: { configured: boolean; missingEnv: string[] };
  getProviderAvailability: ReturnType<typeof vi.fn>;
} {
  return {
    availability: {
      configured: true,
      missingEnv: [],
    },
    getProviderAvailability: vi.fn((providerId: TextModelProviderId) => availabilityByProvider[providerId]),
    async *streamText() {},
  };
}
