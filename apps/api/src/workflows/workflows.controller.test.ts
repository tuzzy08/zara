import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createAgentRoleNode,
  createToolNode,
  createWorkflowGraph,
  type ModelRoutingRule,
  type TelemetryPolicy,
  type WorkflowGraph,
} from "@zara/core";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";
import { withTestTenantAuth } from "../testing/tenant-auth-request";
import type { IntegrationConnectionResponse, IntegrationProvider } from "../integrations/integrations.models";
import {
  FileIntegrationStateRepository,
  INTEGRATION_STATE_REPOSITORY,
  type PersistedIntegrationStateRecord,
} from "../integrations/integrations-state.repository";
import {
  InMemoryMemoryStateRepository,
  MEMORY_STATE_REPOSITORY,
  type PersistedMemoryStateRecord,
} from "../memory/memory-state.repository";
import type { TenantKnowledgeRecordResponse } from "../memory/memory.models";

let tempDirectories: string[] = [];

describe("WorkflowsController", () => {
  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories = [];
  });

  it("requires tenant membership and records the signed-in actor when publishing workflows", async () => {
    const repository = createIntegrationStateRepository();
    const app = await createTestingApp(repository);

    try {
      const unauthenticatedResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/workflows/workflow-support-basic/publish")
        .send(createPublishRequest(createBasicWorkflow()));

      expect(unauthenticatedResponse.status).toBe(401);

      const agent = request.agent(app.getHttpServer());
      const signupResponse = await agent
        .post("/api/auth/onboarding/signup")
        .send({
          email: `workflow-authz-${Date.now()}@example.com`,
          password: "password123",
          name: "Workflow Owner",
          organizationName: "Workflow Authz Tenant",
        });

      expect(signupResponse.status).toBe(200);

      const organizationId = signupResponse.body.activeOrganization.id;
      const response = await agent
        .post(`/organizations/${organizationId}/workflows/workflow-support-basic/publish`)
        .send({
          ...createPublishRequest(createBasicWorkflow()),
          actorUserId: "spoofed-user",
        });

      expect(response.status).toBe(201);
      expect(response.body.publishedVersion.createdBy).toBe(signupResponse.body.user.id);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("blocks publishing connector tool bindings with invalid scoped grants", async () => {
    const repository = createIntegrationStateRepository();
    await repository.save(createScopedGrantValidationState());
    const app = await createTestingApp(repository);

    try {
      const response = await withTestTenantAuth(
        request(app.getHttpServer()).post("/organizations/tenant-west-africa/workflows/workflow-support-scope/publish"),
      )
        .send(createPublishRequest(createScopedConnectorWorkflow()));

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: "Workflow publish blocked by invalid integration tool grants.",
        code: "workflow_publish_tool_grants_invalid",
      });
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "integration_connection_revoked",
            nodeId: "tool-revoked-hubspot",
            integrationConnectionId: "connection-revoked-hubspot",
          }),
          expect.objectContaining({
            code: "integration_connection_missing_scopes",
            nodeId: "tool-calendar-create",
            integrationConnectionId: "connection-google-read-only",
            missingScopes: ["calendar.events"],
          }),
          expect.objectContaining({
            code: "integration_connection_unavailable",
            nodeId: "tool-unavailable-zendesk",
            integrationConnectionId: "connection-zendesk-sales-workspace",
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  }, 15_000);

  it("publishes connector tool bindings when their scoped grants are active", async () => {
    const repository = createIntegrationStateRepository();
    await repository.save(createValidScopedGrantState());
    const app = await createTestingApp(repository);

    try {
      const response = await withTestTenantAuth(
        request(app.getHttpServer()).post("/organizations/tenant-west-africa/workflows/workflow-support-zendesk/publish"),
      )
        .send(createPublishRequest(createValidScopedConnectorWorkflow()));

      expect(response.status).toBe(201);
      expect(response.body.grantValidation).toEqual({ ok: true, errors: [] });
      expect(response.body.manifest.toolBindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: "tool-zendesk-search",
            toolId: "zendesk.tickets.search",
            integrationConnectionId: "connection-zendesk-support",
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  }, 15_000);

  it("creates scoped tool grants for valid connected provider tools during publish", async () => {
    const repository = createIntegrationStateRepository();
    await repository.save(createConnectedZendeskStateWithoutGrants());
    const app = await createTestingApp(repository);

    try {
      const response = await withTestTenantAuth(
        request(app.getHttpServer()).post(
          "/organizations/tenant-west-africa/workflows/workflow-support-zendesk-auto-grant/publish",
        ),
      )
        .send(createPublishRequest(createAutoGrantedZendeskWorkflow()));

      expect(response.status).toBe(201);
      expect(response.body.grantValidation).toEqual({ ok: true, errors: [] });
      const persistedState = await repository.load("tenant-west-africa");

      expect(persistedState?.toolGrants).toEqual([
        expect.objectContaining({
          capability: "agent-tool",
          workspaceId: "workspace-customer-success",
          workflowId: "workflow-support-zendesk-auto-grant",
          roleId: "agent-support",
          toolId: "zendesk.tickets.search",
          integrationConnectionId: "connection-zendesk-support",
          risk: "low",
          requiredScopes: ["tickets:read"],
          approvalRequired: false,
          status: "active",
          grantedBy: "user-ops-lead",
        }),
      ]);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("publishes valid workflows that do not bind connector tools", async () => {
    const repository = createIntegrationStateRepository();
    const app = await createTestingApp(repository);

    try {
      const response = await withTestTenantAuth(
        request(app.getHttpServer()).post("/organizations/tenant-west-africa/workflows/workflow-support-basic/publish"),
      )
        .send(createPublishRequest(createBasicWorkflow()));

      expect(response.status).toBe(201);
      expect(response.body.publishedVersion).toMatchObject({
        id: "workflow-support-basic-v1",
        tenantId: "tenant-west-africa",
        workspaceId: "workspace-customer-success",
        version: 1,
      });
      expect(response.body.manifest).toMatchObject({
        publishedVersionId: "workflow-support-basic-v1",
        workflowId: "workflow-support-basic",
        workspaceId: "workspace-customer-success",
      });
      expect(response.body.manifest.toolBindings).toEqual([]);
      expect(response.body.grantValidation).toEqual({
        ok: true,
        errors: [],
      });
    } finally {
      await app.close();
    }
  }, 15_000);

  it("blocks publishing only for unresolved high-risk knowledge conflicts", async () => {
    const repository = createIntegrationStateRepository();
    const memoryRepository = createMemoryStateRepository([
      createKnowledgeRecord({
        id: "knowledge-policy-public",
        kind: "policy",
        title: "Refund approval policy",
        text: "Refunds above $100 require manager approval.",
      }),
      createKnowledgeRecord({
        id: "knowledge-policy-crm",
        kind: "policy",
        title: "Refund approval policy",
        text: "Refunds above $100 require owner approval.",
      }),
      createKnowledgeRecord({
        id: "knowledge-faq-public",
        kind: "faq",
        title: "Support hours",
        text: "Support opens at 8am.",
      }),
      createKnowledgeRecord({
        id: "knowledge-faq-crm",
        kind: "faq",
        title: "Support hours",
        text: "Support opens at 9am.",
      }),
    ]);
    const app = await createTestingApp(repository, memoryRepository);

    try {
      const blockedResponse = await withTestTenantAuth(
        request(app.getHttpServer()).post("/organizations/tenant-west-africa/workflows/workflow-support-basic/publish"),
      )
        .send(createPublishRequest(createBasicWorkflow()));

      expect(blockedResponse.status).toBe(400);
      expect(blockedResponse.body).toMatchObject({
        message: "Workflow publish blocked by unresolved high-risk knowledge conflicts.",
        code: "workflow_publish_knowledge_conflicts_unresolved",
      });
      expect(blockedResponse.body.publishBlockers).toEqual([
        expect.objectContaining({
          code: "unresolved_high_risk_conflict",
          kind: "policy",
          title: "Refund approval policy",
          recordIds: ["knowledge-policy-public", "knowledge-policy-crm"],
        }),
      ]);

      const lowRiskMemoryRepository = createMemoryStateRepository([
        createKnowledgeRecord({
          id: "knowledge-faq-public",
          kind: "faq",
          title: "Support hours",
          text: "Support opens at 8am.",
        }),
        createKnowledgeRecord({
          id: "knowledge-faq-crm",
          kind: "faq",
          title: "Support hours",
          text: "Support opens at 9am.",
        }),
      ]);
      const lowRiskApp = await createTestingApp(repository, lowRiskMemoryRepository);
      try {
        const publishedResponse = await withTestTenantAuth(
          request(lowRiskApp.getHttpServer()).post(
            "/organizations/tenant-west-africa/workflows/workflow-support-basic/publish",
          ),
        )
          .send(createPublishRequest(createBasicWorkflow()));

        expect(publishedResponse.status).toBe(201);
        expect(publishedResponse.body.knowledgeConflictValidation).toMatchObject({
          canPublish: true,
          publishBlockers: [],
        });
      } finally {
        await lowRiskApp.close();
      }
    } finally {
      await app.close();
    }
  }, 15_000);
});

async function createTestingApp(
  repository: FileIntegrationStateRepository,
  memoryRepository: InMemoryMemoryStateRepository = new InMemoryMemoryStateRepository(),
) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(INTEGRATION_STATE_REPOSITORY)
    .useValue(repository)
    .overrideProvider(MEMORY_STATE_REPOSITORY)
    .useValue(memoryRepository)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();

  return app;
}

function createIntegrationStateRepository() {
  const directory = mkdtempSync(join(tmpdir(), "zara-workflow-publish-"));
  tempDirectories.push(directory);

  return new FileIntegrationStateRepository(join(directory, "integrations"));
}

function createMemoryStateRepository(knowledge: PersistedMemoryStateRecord["knowledge"]) {
  const repository = new InMemoryMemoryStateRepository();
  repository.save({
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    memories: [],
    knowledge,
    knowledgeSources: [],
    knowledgeReviewDrafts: [],
    embeddings: [],
    drafts: [],
    ingestions: [],
  });

  return repository;
}

function createKnowledgeRecord(input: {
  id: string;
  kind: TenantKnowledgeRecordResponse["kind"];
  title: string;
  text: string;
}): TenantKnowledgeRecordResponse {
  return {
    id: input.id,
    organizationId: "tenant-west-africa",
    kind: input.kind,
    publishedWorkflowVersionIds: [],
    workspaceId: "workspace-customer-success",
    workflowIds: ["workflow-support-basic"],
    title: input.title,
    text: input.text,
    source: {
      kind: "document",
      title: `${input.title} source`,
      externalId: `${input.id}-source`,
    },
    conflictState: "none",
    status: "active",
    createdBy: "user-knowledge-admin",
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
  };
}

function createScopedGrantValidationState(): PersistedIntegrationStateRecord {
  return {
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    pendingConnects: [],
    credentials: [],
    connections: [
      createConnection({
        id: "connection-revoked-hubspot",
        provider: "hubspot",
        status: "revoked",
        scopes: ["crm.objects.contacts.read"],
        availability: { scope: "organization" },
      }),
      createConnection({
        id: "connection-google-read-only",
        provider: "google-workspace",
        scopes: ["calendar.freebusy"],
        availability: { scope: "organization" },
      }),
      createConnection({
        id: "connection-zendesk-sales-workspace",
        provider: "zendesk",
        scopes: ["tickets:read"],
        availability: { scope: "workspace", workspaceId: "workspace-growth" },
      }),
      createConnection({
        id: "connection-ungranted-hubspot",
        provider: "hubspot",
        scopes: ["crm.objects.contacts.read"],
        availability: { scope: "organization" },
      }),
    ],
    toolGrants: [],
  };
}

function createValidScopedGrantState(): PersistedIntegrationStateRecord {
  return {
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    pendingConnects: [],
    credentials: [],
    connections: [
      createConnection({
        id: "connection-zendesk-support",
        provider: "zendesk",
        scopes: ["tickets:read"],
        availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
      }),
    ],
    toolGrants: [
      {
        id: "tool-grant-zendesk-search",
        organizationId: "tenant-west-africa",
        capability: "agent-tool",
        workspaceId: "workspace-customer-success",
        workflowId: "workflow-support-zendesk",
        roleId: "agent-support",
        toolId: "zendesk.tickets.search",
        integrationConnectionId: "connection-zendesk-support",
        risk: "low",
        requiredScopes: ["tickets:read"],
        approvalRequired: false,
        status: "active",
        grantedBy: "user-ops-lead",
        createdAt: "2026-06-05T09:00:00.000Z",
      },
    ],
  };
}

function createConnectedZendeskStateWithoutGrants(): PersistedIntegrationStateRecord {
  return {
    schemaVersion: 1,
    organizationId: "tenant-west-africa",
    pendingConnects: [],
    credentials: [],
    connections: [
      createConnection({
        id: "connection-zendesk-support",
        provider: "zendesk",
        scopes: ["tickets:read"],
        availability: { scope: "workspace", workspaceId: "workspace-customer-success" },
      }),
    ],
    toolGrants: [],
  };
}

function createConnection(input: {
  id: string;
  provider: IntegrationProvider;
  status?: IntegrationConnectionResponse["status"] | undefined;
  scopes: string[];
  availability: IntegrationConnectionResponse["availability"];
}): IntegrationConnectionResponse {
  const status = input.status ?? "connected";

  return {
    id: input.id,
    organizationId: "tenant-west-africa",
    provider: input.provider,
    status,
    connectedBy: "user-ops-lead",
    scopes: input.scopes,
    availability: input.availability,
    credentialReference: {
      id: `${input.id}-credential`,
      provider: input.provider,
      kind: input.provider === "zendesk" ? "api-token" : "oauth-token",
      preview: "...1234",
    },
    connectedAt: "2026-06-05T09:00:00.000Z",
    ...(status === "revoked"
      ? {
          revokedBy: "user-ops-lead",
          revokedAt: "2026-06-05T09:10:00.000Z",
          revocationReason: "Credential rotation",
        }
      : {}),
    health: {
      status: status === "revoked" ? "revoked" : "unknown",
    },
    auditEvents: [
      {
        id: `${input.id}-connected`,
        action: "connected",
        actorUserId: "user-ops-lead",
        at: "2026-06-05T09:00:00.000Z",
      },
    ],
  };
}

function createScopedConnectorWorkflow() {
  const agent = createAgentRoleNode({
    id: "agent-support",
    label: "Support specialist",
    position: { x: 180, y: 80 },
    role: {
      kind: "support",
      name: "Support specialist",
      businessName: "Tuzzy Labs",
      instructions: "Help callers with support questions and use connected tools only when allowed.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
    },
  });
  const tools = [
    createConnectorTool({
      id: "tool-revoked-hubspot",
      label: "HubSpot revoked lookup",
      toolId: "hubspot.contacts.lookup",
      connector: "hubspot",
      toolName: "HubSpot contact lookup",
      integrationConnectionId: "connection-revoked-hubspot",
      position: { x: 460, y: 0 },
    }),
    createConnectorTool({
      id: "tool-calendar-create",
      label: "Google Calendar create",
      toolId: "google.calendar.events.create",
      connector: "google-workspace",
      toolName: "Create calendar event",
      integrationConnectionId: "connection-google-read-only",
      risk: "medium",
      requiresHumanApproval: true,
      position: { x: 460, y: 120 },
    }),
    createConnectorTool({
      id: "tool-unavailable-zendesk",
      label: "Zendesk unavailable search",
      toolId: "zendesk.tickets.search",
      connector: "zendesk",
      toolName: "Search Zendesk tickets",
      integrationConnectionId: "connection-zendesk-sales-workspace",
      position: { x: 460, y: 240 },
    }),
    createConnectorTool({
      id: "tool-ungranted-hubspot",
      label: "HubSpot ungranted lookup",
      toolId: "hubspot.contacts.lookup",
      connector: "hubspot",
      toolName: "HubSpot contact lookup",
      integrationConnectionId: "connection-ungranted-hubspot",
      position: { x: 460, y: 360 },
    }),
  ];

  return createWorkflowGraph({
    id: "workflow-support-scope",
    name: "Support scope validation",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 80 },
        config: {},
      },
      agent,
      ...tools,
    ],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-support",
      },
      ...tools.map((tool) => ({
        id: `edge-agent-${tool.id}`,
        sourceNodeId: "agent-support",
        targetNodeId: tool.id,
      })),
    ],
  });
}

function createValidScopedConnectorWorkflow() {
  const agent = createAgentRoleNode({
    id: "agent-support",
    label: "Support specialist",
    position: { x: 180, y: 80 },
    role: {
      kind: "support",
      name: "Support specialist",
      businessName: "Tuzzy Labs",
      instructions: "Help callers with support questions and use connected tools only when allowed.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
    },
  });
  const tool = createConnectorTool({
    id: "tool-zendesk-search",
    label: "Search tickets",
    toolId: "zendesk.tickets.search",
    connector: "zendesk",
    toolName: "Search tickets",
    integrationConnectionId: "connection-zendesk-support",
    position: { x: 460, y: 80 },
  });

  return createWorkflowGraph({
    id: "workflow-support-zendesk",
    name: "Support Zendesk",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 80 },
        config: {},
      },
      agent,
      tool,
    ],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-support",
      },
      {
        id: "edge-agent-tool",
        sourceNodeId: "agent-support",
        targetNodeId: "tool-zendesk-search",
      },
    ],
  });
}

function createAutoGrantedZendeskWorkflow() {
  const agent = createAgentRoleNode({
    id: "agent-support",
    label: "Support specialist",
    position: { x: 180, y: 80 },
    role: {
      kind: "support",
      name: "Support specialist",
      businessName: "Tuzzy Labs",
      instructions: "Help callers with support questions and use connected tools only when allowed.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
    },
  });
  const tool = createConnectorTool({
    id: "tool-zendesk-search",
    label: "Search tickets",
    toolId: "zendesk.tickets.search",
    connector: "zendesk",
    toolName: "Search tickets",
    integrationConnectionId: "connection-zendesk-support",
    position: { x: 460, y: 80 },
  });

  return createWorkflowGraph({
    id: "workflow-support-zendesk-auto-grant",
    name: "Support Zendesk auto grant",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 80 },
        config: {},
      },
      agent,
      tool,
    ],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-support",
      },
      {
        id: "edge-agent-tool",
        sourceNodeId: "agent-support",
        targetNodeId: "tool-zendesk-search",
      },
    ],
  });
}

function createBasicWorkflow() {
  return createWorkflowGraph({
    id: "workflow-support-basic",
    name: "Support basic",
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 80 },
        config: {},
      },
      createAgentRoleNode({
        id: "agent-support",
        label: "Support specialist",
        position: { x: 180, y: 80 },
        role: {
          kind: "support",
          name: "Support specialist",
          businessName: "Tuzzy Labs",
          instructions: "Help callers with support questions.",
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
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-support",
      },
    ],
  });
}

function createConnectorTool(input: {
  id: string;
  label: string;
  toolId: string;
  connector: "zendesk" | "hubspot" | "google-workspace" | "notion";
  toolName: string;
  integrationConnectionId: string;
  risk?: "low" | "medium" | "high" | undefined;
  requiresHumanApproval?: boolean | undefined;
  position: { x: number; y: number };
}) {
  return createToolNode({
    id: input.id,
    label: input.label,
    position: input.position,
    toolId: input.toolId,
    tool: {
      connector: input.connector,
      toolName: input.toolName,
      integrationConnectionId: input.integrationConnectionId,
      connectionStatus: "connected",
      risk: input.risk ?? "low",
      requiresAuthorization: true,
      requiresHumanApproval: input.requiresHumanApproval ?? false,
    },
  });
}

function createPublishRequest(graph: WorkflowGraph) {
  return {
    actorUserId: "user-ops-lead",
    workspaceId: "workspace-customer-success",
    environment: "production",
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
      currentSpendUsd: 100,
      projectedCostPerMinuteUsd: 0.25,
      blockOnLimit: true,
    },
    modelRouting: defaultModelRouting,
    telemetry: defaultTelemetry,
    now: "2026-06-05T09:30:00.000Z",
  };
}

const defaultModelRouting: ModelRoutingRule[] = [
  {
    id: "route-support-standard",
    priority: 10,
    when: {
      callPhase: "tool-use",
    },
    useTier: "standard",
    reason: "Support tool turns use the standard tier.",
  },
];

const defaultTelemetry: TelemetryPolicy = {
  captureAudio: false,
  captureTranscript: true,
  redactSensitiveData: true,
  sinks: ["live-monitor"],
};
