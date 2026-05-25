import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";

import type {
  CheckIntegrationConnectionHealthRequest,
  IntegrationConnectionAuditEvent,
  IntegrationConnectionResponse,
  IntegrationProvider,
  PendingOAuthConnectResponse,
  RevokeIntegrationConnectionRequest,
  StartOAuthConnectRequest,
  ToolPermissionGrantResponse,
} from "./integrations.models";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
  type PersistedIntegrationStateRecord,
} from "./integrations-state.repository";
import {
  INTEGRATION_OAUTH_PROVIDER_CLIENT,
  type IntegrationOAuthProviderClient,
} from "./oauth-provider-client";

interface PendingOAuthConnectRecord extends PendingOAuthConnectResponse {
  state: string;
  redirectUri: string;
  reconnectConnectionId?: string | undefined;
  reconnectAuditEvents?: IntegrationConnectionAuditEvent[] | undefined;
}

interface StoredOAuthCredential {
  accessToken: string;
  refreshToken: string;
  externalAccountId: string;
}

interface IntegrationStateStore {
  organizationId: string;
  pendingConnectsByState: Map<string, PendingOAuthConnectRecord>;
  connections: IntegrationConnectionResponse[];
  credentialVault: Map<string, StoredOAuthCredential>;
  toolGrants: ToolPermissionGrantResponse[];
}

const providerClientIds: Record<IntegrationProvider, string> = {
  zendesk: "zara-zendesk-platform-app",
  hubspot: "zara-hubspot-platform-app",
  "google-workspace": "zara-google-workspace-platform-app",
  notion: "zara-notion-platform-app",
  "webhook-http": "zara-webhook-http-platform-app",
};

@Injectable()
export class IntegrationsService {
  private readonly stateByOrganizationId = new Map<string, IntegrationStateStore>();

  constructor(
    @Inject(INTEGRATION_STATE_REPOSITORY)
    private readonly stateRepository: IntegrationStateRepository,
    private readonly secretVault: IntegrationSecretVault,
    @Inject(INTEGRATION_OAUTH_PROVIDER_CLIENT)
    private readonly providerClient: IntegrationOAuthProviderClient,
  ) {}

  async startOAuthConnect(
    organizationId: string,
    provider: IntegrationProvider,
    input: StartOAuthConnectRequest,
  ): Promise<PendingOAuthConnectResponse> {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to connect integrations.");
    }

    const stateStore = await this.getOrCreateState(organizationId);
    const reconnectConnection =
      input.reconnectConnectionId !== undefined
        ? stateStore.connections.find((connection) => connection.id === input.reconnectConnectionId)
        : undefined;

    if (input.reconnectConnectionId !== undefined && reconnectConnection === undefined) {
      throw new BadRequestException("Reconnect connection was not found.");
    }

    if (reconnectConnection !== undefined && reconnectConnection.provider !== provider) {
      throw new BadRequestException("Reconnect connection provider does not match.");
    }

    const state = randomBytes(32).toString("base64url");
    const id = `oauth_connect_${randomUUID()}`;
    const now = parseTimestamp(input.now) ?? Date.now();
    const stateTtlSeconds = input.stateTtlSeconds ?? 10 * 60;
    const expiresAt = new Date(now + stateTtlSeconds * 1000).toISOString();
    const requestedScopes = input.requestedScopes ?? [];
    const authorizationUrl = buildAuthorizationUrl({
      provider,
      state,
      redirectUri: input.redirectUri,
      requestedScopes,
    });

    const pendingConnect: PendingOAuthConnectRecord = {
      id,
      organizationId,
      provider,
      actorUserId: input.actorUserId,
      authorizationUrl,
      requestedScopes,
      status: "pending",
      expiresAt,
      state,
      redirectUri: input.redirectUri,
      ...(input.reconnectConnectionId !== undefined
        ? { reconnectConnectionId: input.reconnectConnectionId }
        : {}),
      ...(reconnectConnection !== undefined
        ? {
            reconnectAuditEvents: [
              ...reconnectConnection.auditEvents.map(cloneAuditEvent),
              createAuditEvent({
                action: "reconnect_started",
                actorUserId: input.actorUserId,
                at: new Date(now).toISOString(),
                priorConnectionId: reconnectConnection.id,
              }),
            ],
          }
        : {}),
    };

    stateStore.pendingConnectsByState.set(state, pendingConnect);
    await this.persistState(stateStore);

    return toPendingConnectResponse(pendingConnect);
  }

  async completeOAuthCallback(input: {
    provider: IntegrationProvider;
    state: string;
    code: string;
    now?: string | undefined;
  }): Promise<IntegrationConnectionResponse> {
    const pendingMatch = await this.findPendingConnect(input.state);

    if (pendingMatch === undefined || pendingMatch.pendingConnect.provider !== input.provider) {
      throw new BadRequestException("OAuth state is invalid or expired.");
    }

    const pendingConnect = pendingMatch.pendingConnect;
    const now = parseTimestamp(input.now) ?? Date.now();
    const completedAt = new Date(now).toISOString();
    if (Date.parse(pendingConnect.expiresAt) <= now) {
      pendingMatch.state.pendingConnectsByState.delete(input.state);
      await this.persistState(pendingMatch.state);
      throw new BadRequestException("OAuth state is invalid or expired.");
    }

    pendingMatch.state.pendingConnectsByState.delete(input.state);
    const tokens = await this.providerClient.exchangeAuthorizationCode({
      provider: input.provider,
      code: input.code,
      redirectUri: pendingConnect.redirectUri,
    });

    const connectionId = `integration_connection_${randomUUID()}`;
    const tokenPreview = maskToken(tokens.accessToken);
    const connection: IntegrationConnectionResponse = {
      id: connectionId,
      organizationId: pendingConnect.organizationId,
      provider: pendingConnect.provider,
      status: "connected",
      connectedBy: pendingConnect.actorUserId,
      scopes: pendingConnect.requestedScopes,
      credentialReference: {
        id: `integration_credential_${randomUUID()}`,
        provider: pendingConnect.provider,
        kind: "oauth-token",
        preview: tokenPreview,
      },
      connectedAt: completedAt,
      ...(pendingConnect.reconnectConnectionId !== undefined
        ? { reconnectOfConnectionId: pendingConnect.reconnectConnectionId }
        : {}),
      health: {
        status: "unknown",
      },
      auditEvents: [
        ...(pendingConnect.reconnectAuditEvents ?? []),
        createAuditEvent({
          action:
            pendingConnect.reconnectConnectionId === undefined ? "connected" : "reconnected",
          actorUserId: pendingConnect.actorUserId,
          at: completedAt,
          ...(pendingConnect.reconnectConnectionId !== undefined
            ? { priorConnectionId: pendingConnect.reconnectConnectionId }
            : {}),
        }),
      ],
    };

    pendingMatch.state.connections = [...pendingMatch.state.connections, connection];
    pendingMatch.state.credentialVault.set(connection.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      externalAccountId: tokens.externalAccountId,
    });
    await this.persistState(pendingMatch.state);

    return connection;
  }

  async listConnections(organizationId: string) {
    const state = await this.getOrCreateState(organizationId);

    return state.connections.map(cloneConnection);
  }

  async checkConnectionHealth(
    organizationId: string,
    connectionId: string,
    input: CheckIntegrationConnectionHealthRequest,
  ) {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to check integration health.");
    }

    const state = await this.getOrCreateState(organizationId);
    const connection = findConnectionOrThrow(state, connectionId);
    const checkedAt = input.now ?? new Date().toISOString();
    const credential = state.credentialVault.get(connection.id);
    const health =
      connection.status === "revoked"
        ? {
            status: "revoked" as const,
            checkedAt,
            message: "Connection has been revoked.",
          }
        : {
            status:
              credential?.accessToken !== undefined && credential.accessToken.length > 0
                ? ("healthy" as const)
                : ("unhealthy" as const),
            checkedAt,
            message:
              credential?.accessToken !== undefined && credential.accessToken.length > 0
                ? "Connector credentials are available."
                : "Connector credentials are missing or unavailable.",
          };

    connection.health = health;
    connection.auditEvents = [
      ...connection.auditEvents,
      createAuditEvent({
        action: "health_checked",
        actorUserId: input.actorUserId,
        at: checkedAt,
        healthStatus: health.status,
      }),
    ];
    await this.persistState(state);

    return cloneConnection(connection);
  }

  async revokeConnection(
    organizationId: string,
    connectionId: string,
    input: RevokeIntegrationConnectionRequest,
  ) {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to revoke integrations.");
    }

    const state = await this.getOrCreateState(organizationId);
    const connection = findConnectionOrThrow(state, connectionId);
    const revokedAt = input.now ?? new Date().toISOString();

    connection.status = "revoked";
    connection.revokedBy = input.actorUserId;
    connection.revokedAt = revokedAt;
    connection.revocationReason = input.reason;
    connection.health = {
      status: "revoked",
      checkedAt: revokedAt,
      message: "Connection has been revoked.",
    };
    connection.auditEvents = [
      ...connection.auditEvents,
      createAuditEvent({
        action: "revoked",
        actorUserId: input.actorUserId,
        at: revokedAt,
        reason: input.reason,
      }),
    ];
    state.credentialVault.delete(connection.id);
    await this.persistState(state);

    return cloneConnection(connection);
  }

  private async findPendingConnect(state: string) {
    for (const organizationId of new Set([
      ...this.stateByOrganizationId.keys(),
      ...(await this.stateRepository.listOrganizationIds()),
    ])) {
      const integrationState = await this.getOrCreateState(organizationId);
      const pendingConnect = integrationState.pendingConnectsByState.get(state);

      if (pendingConnect !== undefined) {
        return {
          state: integrationState,
          pendingConnect,
        };
      }
    }

    return undefined;
  }

  private async getOrCreateState(organizationId: string): Promise<IntegrationStateStore> {
    const existingState = this.stateByOrganizationId.get(organizationId);
    if (existingState !== undefined) {
      return existingState;
    }

    const persistedState = await this.stateRepository.load(organizationId);
    const nextState =
      persistedState === null
        ? createEmptyState(organizationId)
        : hydrateState(persistedState, this.secretVault);

    this.stateByOrganizationId.set(organizationId, nextState);
    return nextState;
  }

  private async persistState(state: IntegrationStateStore) {
    const latestState = await this.stateRepository.load(state.organizationId);
    const nextState = dehydrateState(state, this.secretVault);

    if (latestState !== null) {
      nextState.toolGrants = latestState.toolGrants ?? nextState.toolGrants;
      nextState.webhookTools = latestState.webhookTools;
      nextState.webhookToolSecrets = latestState.webhookToolSecrets;
    }

    await this.stateRepository.save(nextState);
  }
}

function buildAuthorizationUrl(input: {
  provider: IntegrationProvider;
  state: string;
  redirectUri: string;
  requestedScopes: string[];
}) {
  const authorizationUrl = new URL(`https://oauth.zara.local/${input.provider}/authorize`);
  authorizationUrl.searchParams.set("client_id", providerClientIds[input.provider]);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizationUrl.searchParams.set("state", input.state);

  if (input.requestedScopes.length > 0) {
    authorizationUrl.searchParams.set("scope", input.requestedScopes.join(" "));
  }

  return authorizationUrl.toString();
}

function toPendingConnectResponse(record: PendingOAuthConnectRecord): PendingOAuthConnectResponse {
  return {
    id: record.id,
    organizationId: record.organizationId,
    provider: record.provider,
    actorUserId: record.actorUserId,
    authorizationUrl: record.authorizationUrl,
    requestedScopes: record.requestedScopes,
    status: record.status,
    expiresAt: record.expiresAt,
  };
}

function maskToken(token: string) {
  return `...${token.slice(-4)}`;
}

function createEmptyState(organizationId: string): IntegrationStateStore {
  return {
    organizationId,
    pendingConnectsByState: new Map<string, PendingOAuthConnectRecord>(),
    connections: [],
    credentialVault: new Map<string, StoredOAuthCredential>(),
    toolGrants: [],
  };
}

function hydrateState(
  persistedState: PersistedIntegrationStateRecord,
  secretVault: IntegrationSecretVault,
): IntegrationStateStore {
  const credentialVault = new Map<string, StoredOAuthCredential>();

  for (const credential of persistedState.credentials) {
    try {
      credentialVault.set(
        credential.connectionId,
        secretVault.open(credential.envelope) as unknown as StoredOAuthCredential,
      );
    } catch {
      credentialVault.set(credential.connectionId, {
        accessToken: "",
        refreshToken: "",
        externalAccountId: "",
      });
    }
  }

  return {
    organizationId: persistedState.organizationId,
    pendingConnectsByState: new Map(
      persistedState.pendingConnects.map((pendingConnect) => [
        pendingConnect.state,
        { ...pendingConnect },
      ]),
    ),
    connections: persistedState.connections.map(cloneConnection),
    credentialVault,
    toolGrants: (persistedState.toolGrants ?? []).map(cloneGrant),
  };
}

function dehydrateState(
  state: IntegrationStateStore,
  secretVault: IntegrationSecretVault,
): PersistedIntegrationStateRecord {
  return {
    schemaVersion: 1,
    organizationId: state.organizationId,
    pendingConnects: [...state.pendingConnectsByState.values()].map((pendingConnect) => ({
      ...pendingConnect,
      requestedScopes: [...pendingConnect.requestedScopes],
    })),
    connections: state.connections.map(cloneConnection),
    credentials: [...state.credentialVault.entries()].map(([connectionId, credential]) => ({
      connectionId,
      envelope: secretVault.seal(credential),
    })),
    toolGrants: state.toolGrants.map(cloneGrant),
  };
}

function cloneConnection(connection: IntegrationConnectionResponse): IntegrationConnectionResponse {
  return {
    ...connection,
    scopes: [...connection.scopes],
    credentialReference: {
      ...connection.credentialReference,
    },
    health: {
      ...connection.health,
    },
    auditEvents: connection.auditEvents.map(cloneAuditEvent),
  };
}

function cloneGrant(grant: ToolPermissionGrantResponse): ToolPermissionGrantResponse {
  return {
    ...grant,
  };
}

function parseTimestamp(timestamp: string | undefined) {
  if (timestamp === undefined) {
    return undefined;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function findConnectionOrThrow(state: IntegrationStateStore, connectionId: string) {
  const connection = state.connections.find((candidate) => candidate.id === connectionId);

  if (connection === undefined) {
    throw new NotFoundException("Integration connection was not found.");
  }

  return connection;
}

function createAuditEvent(
  input: Omit<IntegrationConnectionAuditEvent, "id">,
): IntegrationConnectionAuditEvent {
  return {
    id: `integration_audit_${randomUUID()}`,
    ...input,
  };
}

function cloneAuditEvent(
  event: IntegrationConnectionAuditEvent,
): IntegrationConnectionAuditEvent {
  return {
    ...event,
  };
}
