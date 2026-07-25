import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectorToolFailureHealthRecorder } from "./connector-tool-failure-health-recorder";
import { ConnectorToolsService } from "./connector-tools.service";
import { IntegrationsRuntimeModule } from "./integrations-runtime.module";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import { IntegrationsService } from "./integrations.service";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "./integrations-state.repository";

describe("ConnectorToolsService failure health recording", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves the connector failure when health persistence is read-only", async () => {
    const secretVault = new IntegrationSecretVault({
      masterSecret: "integration-secret-123456789012345678",
      keyVersion: 1,
    });
    const state = createZendeskState(secretVault);
    const stateRepository: IntegrationStateRepository = {
      listOrganizationIds: () => [state.organizationId],
      load: () => state,
      save: vi.fn(),
    };
    const healthRecorder = {
      recordConnectionToolFailureHealth: vi.fn().mockRejectedValue(
        Object.assign(new Error("Read-only file system"), { code: "EROFS" }),
      ),
    };
    const service = new ConnectorToolsService(
      stateRepository,
      secretVault,
      healthRecorder as ConnectorToolFailureHealthRecorder,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "55",
          },
        }),
      ),
    );

    await expect(
      service.executeTool(
        state.organizationId,
        "zendesk",
        "zendesk.tickets.create",
        {
          connectionId: state.connections[0]!.id,
          input: {
            subject: "Refund request",
            requesterEmail: "ada@example.com",
            body: "Caller needs help with a duplicate invoice.",
          },
        },
      ),
    ).rejects.toMatchObject({
      response: {
        provider: "zendesk",
        toolId: "zendesk.tickets.create",
        code: "tool_execution.rate_limited",
        recoverable: true,
        retryAfterSeconds: 55,
      },
      status: 429,
    });
    expect(healthRecorder.recordConnectionToolFailureHealth).toHaveBeenCalledOnce();
  });

  it("does not write connection health from the realtime worker", async () => {
    vi.stubEnv("ZARA_PROCESS_ROLE", "pstn-realtime-worker");
    const secretVault = new IntegrationSecretVault({
      masterSecret: "integration-secret-123456789012345678",
      keyVersion: 1,
    });
    const state = createZendeskState(secretVault);
    const stateRepository: IntegrationStateRepository = {
      listOrganizationIds: () => [state.organizationId],
      load: () => state,
      save: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationsRuntimeModule],
    })
      .overrideProvider(INTEGRATION_STATE_REPOSITORY)
      .useValue(stateRepository)
      .overrideProvider(IntegrationSecretVault)
      .useValue(secretVault)
      .compile();
    const integrationsService = moduleRef.get(IntegrationsService);
    const healthWrite = vi
      .spyOn(integrationsService, "recordConnectionToolFailureHealth")
      .mockRejectedValue(
        Object.assign(new Error("Read-only file system"), { code: "EROFS" }),
      );
    const service = moduleRef.get(ConnectorToolsService);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "55",
          },
        }),
      ),
    );

    await expect(
      service.executeTool(
        state.organizationId,
        "zendesk",
        "zendesk.tickets.create",
        {
          connectionId: state.connections[0]!.id,
          input: {
            subject: "Refund request",
            requesterEmail: "ada@example.com",
            body: "Caller needs help with a duplicate invoice.",
          },
        },
      ),
    ).rejects.toMatchObject({
      response: {
        code: "tool_execution.rate_limited",
      },
      status: 429,
    });
    expect(healthWrite).not.toHaveBeenCalled();

    await moduleRef.close();
  });
});

function createZendeskState(
  secretVault: IntegrationSecretVault,
): PersistedIntegrationStateRecord {
  const organizationId = "tenant-west-africa";
  const connectionId = "integration-connection-zendesk";

  return {
    schemaVersion: 1,
    organizationId,
    pendingConnects: [],
    connections: [
      {
        id: connectionId,
        organizationId,
        provider: "zendesk",
        status: "connected",
        connectedBy: "user-ops-lead",
        scopes: ["tickets:read", "tickets:write"],
        availability: { scope: "organization" },
        credentialReference: {
          id: "integration-credential-zendesk",
          provider: "zendesk",
          kind: "api-token",
          preview: "ops@example.com / ...3456",
        },
        connectedAt: "2026-07-25T00:00:00.000Z",
        health: { status: "unknown" },
        auditEvents: [],
      },
    ],
    credentials: [
      {
        connectionId,
        envelope: secretVault.seal({
          credentialType: "api-token",
          externalAccountId: "zendesk:roylessolutions",
          zendeskSubdomain: "roylessolutions",
          zendeskEmail: "ops@example.com",
          zendeskApiToken: "zendesk-api-token-123456",
        }),
      },
    ],
  };
}
