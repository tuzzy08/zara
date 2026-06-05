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
import type { IntegrationConnectionResponse, IntegrationProvider } from "../integrations/integrations.models";
import {
  FileIntegrationStateRepository,
  INTEGRATION_STATE_REPOSITORY,
  type PersistedIntegrationStateRecord,
} from "../integrations/integrations-state.repository";

let tempDirectories: string[] = [];

describe("WorkflowsController", () => {
  afterEach(() => {
    for (const directory of tempDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories = [];
  });

  it("blocks publishing connector tool bindings with invalid scoped grants", async () => {
    const repository = createIntegrationStateRepository();
    await repository.save(createScopedGrantValidationState());
    const app = await createTestingApp(repository);

    try {
      const response = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/workflows/workflow-support-scope/publish")
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
          expect.objectContaining({
            code: "tool_permission_denied",
            nodeId: "tool-ungranted-hubspot",
            integrationConnectionId: "connection-ungranted-hubspot",
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  }, 15_000);

  it("publishes valid workflows that do not bind connector tools", async () => {
    const repository = createIntegrationStateRepository();
    const app = await createTestingApp(repository);

    try {
      const response = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/workflows/workflow-support-basic/publish")
        .send(createPublishRequest(createBasicWorkflow()));

      expect(response.status).toBe(201);
      expect(response.body.publishedVersion).toMatchObject({
        id: "workflow-support-basic-v1",
        tenantId: "tenant-west-africa",
        workspaceId: "workspace-support",
        version: 1,
      });
      expect(response.body.manifest).toMatchObject({
        publishedVersionId: "workflow-support-basic-v1",
        workspaceId: "workspace-support",
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
});

async function createTestingApp(repository: FileIntegrationStateRepository) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(INTEGRATION_STATE_REPOSITORY)
    .useValue(repository)
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
        availability: { scope: "workspace", workspaceId: "workspace-sales" },
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
      reusableSpecialist: true,
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
          reusableSpecialist: true,
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
    workspaceId: "workspace-support",
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
