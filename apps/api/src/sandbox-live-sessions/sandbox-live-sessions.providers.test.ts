import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntimeContext, CompiledRuntimeManifest, CompiledRuntimeToolBinding } from "@zara/core";

import { ConnectorToolsService } from "../integrations/connector-tools.service";
import { FileIntegrationStateRepository } from "../integrations/integrations-state.repository";
import { IntegrationSecretVault } from "../integrations/integrations-secret-vault";
import { WebhookHttpToolsService } from "../integrations/webhook-http-tools.service";
import { DefaultLiveSandboxToolRegistry } from "./sandbox-live-sessions.providers";

describe("DefaultLiveSandboxToolRegistry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves webhook HTTP secret references inside the runtime before executing a tool", async () => {
    const webhookToolsService = createWebhookToolsService();
    const webhookTool = await webhookToolsService.createWebhookTool("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-default",
      toolName: "Lookup loyalty profile",
      method: "POST",
      url: "https://hooks.example.test/customers/lookup",
      headers: [{ name: "content-type", value: "application/json" }],
      bodyTemplate: '{"transcript":"{{turn.transcript}}"}',
      authToken: "webhook-token-super-secret-1234",
      timeoutMs: 2_000,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
      },
    });
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ found: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const registry = new DefaultLiveSandboxToolRegistry(webhookToolsService);
    const result = await registry.execute({
      callSessionId: "call_live_123",
      manifest: { tenantId: "tenant-west-africa" } as CompiledRuntimeManifest,
      agentContext: createAgentContext(),
      binding: {
        nodeId: "agent-support:loyalty-profile",
        toolId: webhookTool.toolId,
        toolName: webhookTool.toolName,
        request: {
          method: webhookTool.request.method,
          url: webhookTool.request.url,
          authToken: webhookTool.request.authTokenReference ?? "",
          headers: webhookTool.request.headers,
          bodyTemplate: webhookTool.request.bodyTemplate,
        },
      } as CompiledRuntimeToolBinding,
      toolCallId: "tool-call-loyalty-profile",
      toolAssignmentId: "agent-support:loyalty-profile",
      arguments: {},
      idempotencyKey: "call_live_123:turn-1:agent-support:loyalty-profile:tool-call-loyalty-profile",
      transcript: "caller asks about loyalty",
      actorUserId: "user-ops-lead",
      workspaceId: "workspace-default",
    });

    expect(result.output).toMatchObject({
      status: 200,
      ok: true,
      body: {
        found: true,
      },
    });
    expect(fetchCalls).toHaveLength(1);
    expect(new Headers(fetchCalls[0]?.init.headers).get("authorization")).toBe(
      "Bearer webhook-token-super-secret-1234",
    );
    expect(JSON.stringify(fetchCalls[0])).not.toContain(
      "secret://webhook-http-tools",
    );
  });

  it("retries transient webhook HTTP failures according to the stored tool policy", async () => {
    const webhookToolsService = createWebhookToolsService();
    const webhookTool = await webhookToolsService.createWebhookTool("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-default",
      toolName: "Sync caller status",
      method: "POST",
      url: "https://hooks.example.test/customers/status",
      headers: [],
      authToken: "webhook-token-retry-1234",
      timeoutMs: 2_000,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ synced: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    const registry = new DefaultLiveSandboxToolRegistry(webhookToolsService);
    const result = await registry.execute({
      callSessionId: "call_live_retry",
      manifest: { tenantId: "tenant-west-africa" } as CompiledRuntimeManifest,
      agentContext: createAgentContext(),
      binding: {
        nodeId: "agent-support:status-sync",
        toolId: webhookTool.toolId,
        toolName: webhookTool.toolName,
        request: {
          method: webhookTool.request.method,
          url: webhookTool.request.url,
          authToken: webhookTool.request.authTokenReference ?? "",
          headers: webhookTool.request.headers,
        },
      } as CompiledRuntimeToolBinding,
      toolCallId: "tool-call-status-sync",
      toolAssignmentId: "agent-support:status-sync",
      arguments: {},
      idempotencyKey: "call_live_retry:turn-1:agent-support:status-sync:tool-call-status-sync",
      transcript: "caller wants a status update",
      actorUserId: "user-ops-lead",
      workspaceId: "workspace-default",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output).toMatchObject({
      status: 200,
      ok: true,
      body: {
        synced: true,
      },
    });
  });

  it("aborts webhook HTTP execution when the stored timeout policy is exceeded", async () => {
    const webhookToolsService = createWebhookToolsService();
    const webhookTool = await webhookToolsService.createWebhookTool("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-default",
      toolName: "Slow enrichment",
      method: "POST",
      url: "https://hooks.example.test/customers/slow-enrichment",
      headers: [],
      authToken: "webhook-token-timeout-1234",
      timeoutMs: 100,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
      },
    });
    globalThis.fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null) {
            reject(new Error("missing abort signal"));
            return;
          }

          signal.addEventListener("abort", () => {
            reject(new Error("fetch aborted"));
          });
        }),
    ) as unknown as typeof fetch;

    const registry = new DefaultLiveSandboxToolRegistry(webhookToolsService);
    await expect(
      registry.execute({
        callSessionId: "call_live_timeout",
        manifest: { tenantId: "tenant-west-africa" } as CompiledRuntimeManifest,
        agentContext: createAgentContext(),
        binding: {
          nodeId: "agent-support:slow-enrichment",
          toolId: webhookTool.toolId,
          toolName: webhookTool.toolName,
          request: {
            method: webhookTool.request.method,
            url: webhookTool.request.url,
            authToken: webhookTool.request.authTokenReference ?? "",
            headers: webhookTool.request.headers,
          },
        } as CompiledRuntimeToolBinding,
        toolCallId: "tool-call-slow-enrichment",
        toolAssignmentId: "agent-support:slow-enrichment",
        arguments: {},
        idempotencyKey: "call_live_timeout:turn-1:agent-support:slow-enrichment:tool-call-slow-enrichment",
        transcript: "caller needs enrichment",
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
      }),
    ).rejects.toThrow(
      "Live sandbox tool '"
        + webhookTool.toolId
        + "' timed out after 100ms.",
    );
  });

  it("blocks webhook HTTP execution to internal network destinations before fetch", async () => {
    const webhookToolsService = createWebhookToolsService();
    const webhookTool = await webhookToolsService.createWebhookTool("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-default",
      toolName: "Internal metadata lookup",
      method: "POST",
      url: "https://127.0.0.1/latest/meta-data",
      headers: [],
      authToken: "webhook-token-internal-1234",
      timeoutMs: 2_000,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
      },
    });
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    const registry = new DefaultLiveSandboxToolRegistry(webhookToolsService);
    await expect(
      registry.execute({
        callSessionId: "call_live_internal_target",
        manifest: { tenantId: "tenant-west-africa" } as CompiledRuntimeManifest,
        agentContext: createAgentContext(),
        binding: {
          nodeId: "agent-support:internal-target",
          toolId: webhookTool.toolId,
          toolName: webhookTool.toolName,
          request: {
            method: webhookTool.request.method,
            url: webhookTool.request.url,
            authToken: webhookTool.request.authTokenReference ?? "",
            headers: webhookTool.request.headers,
          },
        } as CompiledRuntimeToolBinding,
        toolCallId: "tool-call-internal-target",
        toolAssignmentId: "agent-support:internal-target",
        arguments: {},
        idempotencyKey: "call_live_internal_target:turn-1:agent-support:internal-target:tool-call-internal-target",
        transcript: "caller asks for account data",
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
      }),
    ).rejects.toThrow("Outbound HTTP destination is not allowed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches redacted provider response details to non-success HTTP tool failures", async () => {
    const webhookToolsService = createWebhookToolsService();
    const webhookTool = await webhookToolsService.createWebhookTool("tenant-west-africa", {
      actorUserId: "user-ops-lead",
      actorRole: "admin",
      workspaceId: "workspace-default",
      toolName: "Search tickets",
      method: "POST",
      url: "https://hooks.example.test/tickets/search",
      headers: [{ name: "content-type", value: "application/json" }],
      bodyTemplate: '{"transcript":"{{turn.transcript}}"}',
      authToken: "webhook-token-search-1234",
      timeoutMs: 2_000,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
      },
    });
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "Search query is required.",
          token: "provider-secret-token",
        }),
        { status: 400 },
      )) as unknown as typeof fetch;

    const registry = new DefaultLiveSandboxToolRegistry(webhookToolsService);
    let capturedError: unknown;

    try {
      await registry.execute({
        callSessionId: "call_live_http_error",
        manifest: { tenantId: "tenant-west-africa" } as CompiledRuntimeManifest,
        agentContext: createAgentContext(),
        binding: {
          nodeId: "agent-support:ticket-search",
          toolId: webhookTool.toolId,
          toolName: webhookTool.toolName,
          request: {
            method: webhookTool.request.method,
            url: webhookTool.request.url,
            authToken: webhookTool.request.authTokenReference ?? "",
            headers: webhookTool.request.headers,
            bodyTemplate: webhookTool.request.bodyTemplate,
          },
        } as CompiledRuntimeToolBinding,
        toolCallId: "tool-call-ticket-search",
        toolAssignmentId: "agent-support:ticket-search",
        arguments: {},
        idempotencyKey: "call_live_http_error:turn-1:agent-support:ticket-search:tool-call-ticket-search",
        transcript: "caller asks for a pending ticket",
        actorUserId: "user-ops-lead",
        workspaceId: "workspace-default",
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Search query is required."),
    });
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).not.toContain("provider-secret-token");
  });

  it("executes catalog connector tools through the server-owned connector executor", async () => {
    const connectorToolsService = {
      executeTool: vi.fn(async () => ({
        provider: "zendesk",
        toolId: "zendesk.tickets.search",
        tickets: [
          {
            id: "ticket-123",
            status: "pending",
            subject: "Account activation",
          },
        ],
      })),
    } as unknown as ConnectorToolsService;

    const registry = new DefaultLiveSandboxToolRegistry(undefined, connectorToolsService);
    const result = await registry.execute({
      callSessionId: "call_live_connector",
      manifest: { tenantId: "tenant-west-africa" } as CompiledRuntimeManifest,
      agentContext: createAgentContext(),
      binding: {
        nodeId: "agent-support:ticket-search",
        connector: "zendesk",
        toolId: "zendesk.tickets.search",
        toolName: "Search tickets",
        integrationConnectionId: "zendesk-prod",
      } as CompiledRuntimeToolBinding,
      toolCallId: "tool-call-ticket-search",
      toolAssignmentId: "agent-support:ticket-search",
      arguments: {
        query: "account activation Francis",
      },
      idempotencyKey: "call_live_connector:turn-1:agent-support:ticket-search:tool-call-ticket-search",
      transcript: "caller asks for a pending ticket",
      actorUserId: "user-ops-lead",
      workspaceId: "workspace-default",
    });

    expect(connectorToolsService.executeTool).toHaveBeenCalledWith(
      "tenant-west-africa",
      "zendesk",
      "zendesk.tickets.search",
      {
        connectionId: "zendesk-prod",
        idempotencyKey: "call_live_connector:turn-1:agent-support:ticket-search:tool-call-ticket-search",
        input: {
          query: "account activation Francis",
        },
      },
    );
    expect(result).toMatchObject({
      summary: "Executed Search tickets.",
      output: {
        provider: "zendesk",
        toolId: "zendesk.tickets.search",
        tickets: [
          {
            id: "ticket-123",
            status: "pending",
            subject: "Account activation",
          },
        ],
      },
    });
  });
});

function createWebhookToolsService() {
  return new WebhookHttpToolsService(
    new FileIntegrationStateRepository(join(tmpdir(), "zara-webhook-provider-tests", randomUUID())),
    new IntegrationSecretVault({
      masterSecret: "integration-secret-123456789012345678",
      keyVersion: 1,
    }),
  );
}

function createAgentContext(): AgentRuntimeContext {
  return {
    organizationId: "tenant-west-africa",
    workspaceId: "workspace-default",
    callSessionId: "call_live_123",
    actorUserId: "user-ops-lead",
    manifest: {
      manifestId: "manifest-1",
      version: 1,
      publishedVersionId: "published-1",
      workflowId: "workflow-1",
    },
    agent: {
      agentId: "agent-support",
      nodeId: "agent-support",
      name: "Support",
      kind: "support",
      businessName: "Zara AI",
      instructions: "Help support callers.",
      defaultModelTier: "standard",
      languagePolicy: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        allowMidCallSwitching: false,
      },
      toolAssignments: [],
    },
  };
}
