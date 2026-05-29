import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type {
  CreateWebhookHttpToolRequest,
  WebhookHttpToolResponse,
} from "./integrations.models";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
  type PersistedIntegrationStateRecord,
  type PersistedWebhookHttpToolSecretRecord,
} from "./integrations-state.repository";

interface WebhookHttpSecretPayload {
  authToken: string;
}

@Injectable()
export class WebhookHttpToolsService {
  constructor(
    @Inject(INTEGRATION_STATE_REPOSITORY)
    private readonly stateRepository: IntegrationStateRepository,
    private readonly secretVault: IntegrationSecretVault,
  ) {}

  async createWebhookTool(
    organizationId: string,
    input: CreateWebhookHttpToolRequest,
  ): Promise<WebhookHttpToolResponse> {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to define webhook tools.");
    }

    const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
    const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
    const url = parseHttpsUrl(input.url);
    const state = await this.loadState(organizationId);
    const toolId = `webhook_http_${randomUUID()}`;
    const authToken = input.authToken?.trim() ?? "";
    const authTokenReference =
      authToken.length > 0 ? `secret://webhook-http-tools/${toolId}/auth-token` : undefined;
    const webhookTool: WebhookHttpToolResponse = {
      id: toolId,
      organizationId,
      workspaceId: input.workspaceId,
      provider: "webhook-http",
      toolId,
      toolName: input.toolName.trim(),
      createdBy: input.actorUserId,
      createdAt: input.now ?? new Date().toISOString(),
      request: {
        method: input.method,
        url: url.toString(),
        headers: normalizeHeaders(input.headers ?? []),
        ...(input.bodyTemplate !== undefined ? { bodyTemplate: input.bodyTemplate } : {}),
        ...(authTokenReference !== undefined ? { authTokenReference } : {}),
        timeoutMs,
        retryPolicy,
      },
    };

    state.webhookTools = [webhookTool, ...state.webhookTools];
    if (authTokenReference !== undefined) {
      state.webhookToolSecrets = [
        {
          toolId,
          envelope: this.secretVault.seal({ authToken }),
        },
        ...state.webhookToolSecrets.filter((secret) => secret.toolId !== toolId),
      ];
    }
    await this.saveState(state);

    return cloneWebhookTool(webhookTool);
  }

  async listWebhookTools(input: {
    organizationId: string;
    workspaceId?: string | undefined;
  }): Promise<WebhookHttpToolResponse[]> {
    const state = await this.loadState(input.organizationId);

    return state.webhookTools
      .filter((tool) => input.workspaceId === undefined || tool.workspaceId === input.workspaceId)
      .map(cloneWebhookTool);
  }

  async resolveWebhookAuthToken(input: {
    organizationId: string;
    toolId: string;
    authTokenReference: string;
  }) {
    const expectedReference = `secret://webhook-http-tools/${input.toolId}/auth-token`;
    if (input.authTokenReference !== expectedReference) {
      throw new Error("Webhook auth token reference does not match the tool.");
    }

    const state = await this.loadState(input.organizationId);
    const secret = state.webhookToolSecrets.find((candidate) => candidate.toolId === input.toolId);
    const opened = this.secretVault.open(secret?.envelope) as unknown as WebhookHttpSecretPayload;

    if (typeof opened.authToken !== "string" || opened.authToken.length === 0) {
      throw new Error("Webhook auth token is unavailable.");
    }

    return opened.authToken;
  }

  async getExecutionPolicy(input: { organizationId: string; toolId: string }) {
    const state = await this.loadState(input.organizationId);
    const tool = state.webhookTools.find((candidate) => candidate.toolId === input.toolId);

    if (tool === undefined) {
      return undefined;
    }

    return {
      timeoutMs: tool.request.timeoutMs,
      retryPolicy: { ...tool.request.retryPolicy },
    };
  }

  private async loadState(organizationId: string): Promise<PersistedIntegrationStateRecord & {
    webhookTools: WebhookHttpToolResponse[];
    webhookToolSecrets: PersistedWebhookHttpToolSecretRecord[];
  }> {
    const persistedState = await this.stateRepository.load(organizationId);

    if (persistedState === null) {
      return {
        schemaVersion: 1,
        organizationId,
        pendingConnects: [],
        connections: [],
        credentials: [],
        toolGrants: [],
        webhookTools: [],
        webhookToolSecrets: [],
      };
    }

    return {
      ...persistedState,
      pendingConnects: [...persistedState.pendingConnects],
      connections: persistedState.connections.map((connection) => ({
        ...connection,
        scopes: [...connection.scopes],
        credentialReference: { ...connection.credentialReference },
      })),
      credentials: [...persistedState.credentials],
      toolGrants: persistedState.toolGrants?.map((grant) => ({ ...grant })) ?? [],
      webhookTools: (persistedState.webhookTools ?? []).map(cloneWebhookTool),
      webhookToolSecrets: [...(persistedState.webhookToolSecrets ?? [])],
    };
  }

  private async saveState(state: PersistedIntegrationStateRecord & {
    webhookTools: WebhookHttpToolResponse[];
    webhookToolSecrets: PersistedWebhookHttpToolSecretRecord[];
  }) {
    await this.stateRepository.save({
      ...state,
      webhookTools: state.webhookTools.map(cloneWebhookTool),
      webhookToolSecrets: [...state.webhookToolSecrets],
    });
  }
}

function normalizeTimeoutMs(value: number) {
  if (!Number.isInteger(value) || value < 100 || value > 30_000) {
    throw new BadRequestException("Webhook timeoutMs must be an integer between 100 and 30000.");
  }

  return value;
}

function normalizeRetryPolicy(value: CreateWebhookHttpToolRequest["retryPolicy"]) {
  if (
    value === undefined
    || !Number.isInteger(value.maxAttempts)
    || value.maxAttempts < 1
    || value.maxAttempts > 5
    || !Number.isInteger(value.backoffMs)
    || value.backoffMs < 0
    || value.backoffMs > 10_000
  ) {
    throw new BadRequestException(
      "Webhook retryPolicy must include maxAttempts 1-5 and backoffMs 0-10000.",
    );
  }

  return {
    maxAttempts: value.maxAttempts,
    backoffMs: value.backoffMs,
  };
}

function parseHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("Webhook URL must be a valid HTTPS URL.");
  }

  if (url.protocol !== "https:") {
    throw new BadRequestException("Webhook URL must use HTTPS.");
  }

  return url;
}

function normalizeHeaders(headers: { name: string; value: string }[]) {
  return headers.map((header) => ({
    name: header.name.trim().toLowerCase(),
    value: header.value,
  }));
}

function cloneWebhookTool(tool: WebhookHttpToolResponse): WebhookHttpToolResponse {
  return {
    ...tool,
    request: {
      ...tool.request,
      headers: tool.request.headers.map((header) => ({ ...header })),
      retryPolicy: { ...tool.request.retryPolicy },
    },
  };
}
