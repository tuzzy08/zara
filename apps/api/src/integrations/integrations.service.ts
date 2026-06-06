import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";

import type {
  CheckIntegrationConnectionHealthRequest,
  ConfigureSlackDestinationsRequest,
  ConfigureZendeskApiTokenRequest,
  DeleteIntegrationConnectionRequest,
  IntegrationConnectionHealth,
  IntegrationConnectionAuditEvent,
  IntegrationConnectionAvailability,
  IntegrationConnectionResponse,
  IntegrationProvider,
  PendingOAuthConnectResponse,
  PromoteIntegrationConnectionRequest,
  RevokeIntegrationConnectionRequest,
  SlackDestinationConfig,
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

interface StoredIntegrationCredential {
  credentialType?: "oauth-token" | "api-token" | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  externalAccountId: string;
  zendeskSubdomain?: string | undefined;
  zendeskEmail?: string | undefined;
  zendeskApiToken?: string | undefined;
  slackDestinations?: SlackDestinationConfig[] | undefined;
  slackDestinationsJson?: string | undefined;
}

interface IntegrationStateStore {
  organizationId: string;
  pendingConnectsByState: Map<string, PendingOAuthConnectRecord>;
  connections: IntegrationConnectionResponse[];
  credentialVault: Map<string, StoredIntegrationCredential>;
  toolGrants: ToolPermissionGrantResponse[];
}

const providerClientIds: Record<IntegrationProvider, string> = {
  zendesk: "zara-zendesk-platform-app",
  hubspot: "zara-hubspot-platform-app",
  "google-workspace": "zara-google-workspace-platform-app",
  notion: "zara-notion-platform-app",
  salesforce: "zara-salesforce-platform-app",
  slack: "zara-slack-platform-app",
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
    const availability = normalizeConnectionAvailability(input);
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
      availability,
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
      availability: cloneAvailability(pendingConnect.availability),
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

  async configureZendeskApiToken(
    organizationId: string,
    input: ConfigureZendeskApiTokenRequest,
  ): Promise<IntegrationConnectionResponse> {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to configure integrations.");
    }

    const subdomain = normalizeZendeskSubdomain(input.subdomain);
    const email = normalizeZendeskEmail(input.email);
    const apiToken = input.apiToken.trim();
    if (apiToken.length === 0) {
      throw new BadRequestException("Zendesk API token is required.");
    }

    const state = await this.getOrCreateState(organizationId);
    const configuredAt = new Date(parseTimestamp(input.now) ?? Date.now()).toISOString();
    const connectionId = `integration_connection_${randomUUID()}`;
    const availability = normalizeConnectionAvailability(input);
    const connection: IntegrationConnectionResponse = {
      id: connectionId,
      organizationId,
      provider: "zendesk",
      status: "connected",
      connectedBy: input.actorUserId,
      scopes: ["tickets:read", "tickets:write"],
      availability,
      credentialReference: {
        id: `integration_credential_${randomUUID()}`,
        provider: "zendesk",
        kind: "api-token",
        preview: `${email} / ...${apiToken.slice(-4)}`,
      },
      accountLabel: `${subdomain}.zendesk.com`,
      connectedAt: configuredAt,
      health: {
        status: "unknown",
      },
      auditEvents: [
        createAuditEvent({
          action: "connected",
          actorUserId: input.actorUserId,
          at: configuredAt,
        }),
      ],
    };

    state.connections = [...state.connections, connection];
    state.credentialVault.set(connection.id, {
      credentialType: "api-token",
      externalAccountId: `zendesk:${subdomain}`,
      zendeskSubdomain: subdomain,
      zendeskEmail: email,
      zendeskApiToken: apiToken,
    });
    await this.persistState(state);

    return cloneConnection(connection);
  }

  async configureSlackDestinations(
    organizationId: string,
    input: ConfigureSlackDestinationsRequest,
  ): Promise<SlackDestinationConfig[]> {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to configure integrations.");
    }

    const state = await this.getOrCreateState(organizationId);
    const connection = state.connections.find((candidate) => candidate.id === input.connectionId);
    if (connection === undefined || connection.provider !== "slack") {
      throw new BadRequestException("Slack integration connection was not found.");
    }

    if (connection.status === "revoked") {
      throw new BadRequestException("Slack integration connection has been revoked.");
    }

    const credential = state.credentialVault.get(connection.id);
    if (credential === undefined || credential.accessToken === undefined || credential.accessToken.length === 0) {
      throw new BadRequestException("Slack credential is unavailable.");
    }

    const destinations = normalizeSlackDestinations(input.destinations);
    state.credentialVault.set(connection.id, {
      ...credential,
      slackDestinations: destinations,
      slackDestinationsJson: JSON.stringify(destinations),
    });
    connection.accountLabel = `${destinations.length} Slack destination${destinations.length === 1 ? "" : "s"}`;
    connection.auditEvents = [
      ...connection.auditEvents,
      createAuditEvent({
        action: "configured",
        at: new Date().toISOString(),
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      }),
    ];
    await this.persistState(state);

    return destinations.map(cloneSlackDestination);
  }

  async listConnections(
    organizationId: string,
    input: { workspaceId?: string | undefined } = {},
  ) {
    const state = await this.getOrCreateState(organizationId);

    return state.connections
      .filter((connection) => isConnectionAvailableInWorkspace(connection, input.workspaceId))
      .map(cloneConnection);
  }

  async recordConnectionToolFailureHealth(
    organizationId: string,
    connectionId: string,
    provider: IntegrationProvider,
    health: IntegrationConnectionHealth,
  ) {
    const state = await this.getOrCreateState(organizationId);
    const connection = state.connections.find((candidate) => candidate.id === connectionId);

    if (connection === undefined || connection.provider !== provider || connection.status === "revoked") {
      return;
    }

    connection.health = health;
    await this.persistState(state, { preserveLatestCredentials: true });
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
    const hasCredential = hasUsableIntegrationCredential(connection.provider, credential);
    const health =
      connection.status === "revoked"
        ? {
            status: "revoked" as const,
            checkedAt,
            message: "Connection has been revoked.",
          }
        : {
            status: hasCredential ? ("healthy" as const) : ("unhealthy" as const),
            checkedAt,
            message:
              hasCredential
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
    await this.refreshPersistedToolGrants(state);

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
    state.toolGrants = state.toolGrants.map((grant) =>
      grant.integrationConnectionId === connection.id && grant.status === "active"
        ? {
            ...grant,
            status: "paused",
            pausedAt: revokedAt,
            pausedReason: "integration_connection_revoked",
          }
        : grant,
    );
    await this.persistState(state, { preserveLatestToolGrants: false });

    return cloneConnection(connection);
  }

  async deleteConnection(
    organizationId: string,
    connectionId: string,
    input: DeleteIntegrationConnectionRequest,
  ) {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to delete integrations.");
    }

    const state = await this.getOrCreateState(organizationId);
    const connection = findConnectionOrThrow(state, connectionId);
    await this.refreshPersistedToolGrants(state);
    const activeToolGrantIds = state.toolGrants
      .filter((grant) => grant.integrationConnectionId === connection.id && grant.status === "active")
      .map((grant) => grant.id);

    if (activeToolGrantIds.length > 0) {
      throw new ConflictException({
        message: "Integration connection has active dependencies.",
        dependencies: {
          activeToolGrantIds,
        },
      });
    }

    state.connections = state.connections.filter((candidate) => candidate.id !== connection.id);
    state.credentialVault.delete(connection.id);
    await this.persistState(state);

    return {
      id: connection.id,
      deletedAt: input.now ?? new Date().toISOString(),
      deletedBy: input.actorUserId,
    };
  }

  async promoteConnectionToOrganization(
    organizationId: string,
    connectionId: string,
    input: PromoteIntegrationConnectionRequest,
  ) {
    if (input.actorRole !== "owner" && input.actorRole !== "admin") {
      throw new ForbiddenException("Tenant admin access is required to promote integrations.");
    }

    if (input.reason.trim().length === 0) {
      throw new BadRequestException("Promotion reason is required.");
    }

    const state = await this.getOrCreateState(organizationId);
    const connection = findConnectionOrThrow(state, connectionId);
    const availability = readConnectionAvailability(connection);

    if (availability.scope !== "workspace") {
      throw new BadRequestException("Only workspace-owned connections can be promoted.");
    }

    if (availability.workspaceId !== input.workspaceId) {
      throw new BadRequestException("Promotion workspace does not match the connection owner workspace.");
    }

    const promotedAt = input.now ?? new Date().toISOString();
    connection.availability = {
      scope: "organization",
    };
    connection.auditEvents = [
      ...connection.auditEvents,
      createAuditEvent({
        action: "promoted_to_organization",
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        workspaceId: input.workspaceId,
        reason: input.reason,
        at: promotedAt,
      }),
    ];
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

  private async persistState(
    state: IntegrationStateStore,
    options: {
      preserveLatestCredentials?: boolean | undefined;
      preserveLatestToolGrants?: boolean | undefined;
    } = {},
  ) {
    const latestState = await this.stateRepository.load(state.organizationId);
    const nextState = dehydrateState(state, this.secretVault);
    const preserveLatestCredentials = options.preserveLatestCredentials ?? false;
    const preserveLatestToolGrants = options.preserveLatestToolGrants ?? true;

    if (latestState !== null) {
      if (preserveLatestCredentials) {
        nextState.credentials = latestState.credentials;
      }
      if (preserveLatestToolGrants) {
        nextState.toolGrants = latestState.toolGrants ?? nextState.toolGrants;
      }
      nextState.webhookTools = latestState.webhookTools;
      nextState.webhookToolSecrets = latestState.webhookToolSecrets;
    }

    await this.stateRepository.save(nextState);
  }

  private async refreshPersistedToolGrants(state: IntegrationStateStore) {
    const latestState = await this.stateRepository.load(state.organizationId);

    if (latestState?.toolGrants !== undefined) {
      state.toolGrants = latestState.toolGrants.map(cloneGrant);
    }
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
    availability: cloneAvailability(record.availability),
    status: record.status,
    expiresAt: record.expiresAt,
  };
}

function maskToken(token: string) {
  return `...${token.slice(-4)}`;
}

function normalizeZendeskSubdomain(value: string) {
  const subdomain = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(subdomain)) {
    throw new BadRequestException("Zendesk subdomain must be a valid Zendesk account subdomain.");
  }

  return subdomain;
}

function normalizeZendeskEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new BadRequestException("Zendesk email must be a valid email address.");
  }

  return email;
}

function normalizeSlackDestinations(destinations: SlackDestinationConfig[]) {
  if (!Array.isArray(destinations) || destinations.length === 0) {
    throw new BadRequestException("At least one Slack destination is required.");
  }

  const ids = new Set<string>();
  return destinations.map((destination) => {
    const id = normalizeSlackDestinationId(destination.id);
    if (ids.has(id)) {
      throw new BadRequestException("Slack destination IDs must be unique.");
    }
    ids.add(id);

    const channelId = destination.channelId.trim();
    if (!/^[CG][A-Z0-9]{2,}$/.test(channelId)) {
      throw new BadRequestException("Slack destination channel ID is invalid.");
    }

    return {
      id,
      label: normalizeRequiredSlackText(destination.label, "Slack destination label"),
      channelId,
      channelName: normalizeRequiredSlackText(destination.channelName, "Slack destination channel name"),
      purpose: normalizeSlackDestinationPurpose(destination.purpose),
    };
  });
}

function normalizeSlackDestinationId(value: string) {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(id)) {
    throw new BadRequestException("Slack destination ID is invalid.");
  }

  return id;
}

function normalizeRequiredSlackText(value: string, label: string) {
  const text = value.trim();
  if (text.length === 0) {
    throw new BadRequestException(`${label} is required.`);
  }

  return text;
}

function normalizeSlackDestinationPurpose(value: SlackDestinationConfig["purpose"]) {
  if (value !== "escalation" && value !== "alert" && value !== "post-call-summary") {
    throw new BadRequestException("Slack destination purpose is invalid.");
  }

  return value;
}

function cloneSlackDestination(destination: SlackDestinationConfig): SlackDestinationConfig {
  return { ...destination };
}

function hasUsableIntegrationCredential(
  provider: IntegrationProvider,
  credential: StoredIntegrationCredential | undefined,
) {
  if (credential === undefined) {
    return false;
  }

  if (provider === "zendesk" && credential.credentialType === "api-token") {
    return (
      credential.zendeskSubdomain !== undefined &&
      credential.zendeskSubdomain.length > 0 &&
      credential.zendeskEmail !== undefined &&
      credential.zendeskEmail.length > 0 &&
      credential.zendeskApiToken !== undefined &&
      credential.zendeskApiToken.length > 0
    );
  }

  return credential.accessToken !== undefined && credential.accessToken.length > 0;
}

function createEmptyState(organizationId: string): IntegrationStateStore {
  return {
    organizationId,
    pendingConnectsByState: new Map<string, PendingOAuthConnectRecord>(),
    connections: [],
    credentialVault: new Map<string, StoredIntegrationCredential>(),
    toolGrants: [],
  };
}

function hydrateState(
  persistedState: PersistedIntegrationStateRecord,
  secretVault: IntegrationSecretVault,
): IntegrationStateStore {
  const credentialVault = new Map<string, StoredIntegrationCredential>();

  for (const credential of persistedState.credentials) {
    try {
      credentialVault.set(
        credential.connectionId,
        secretVault.open(credential.envelope) as unknown as StoredIntegrationCredential,
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
        {
          ...pendingConnect,
          availability: cloneAvailability(pendingConnect.availability ?? { scope: "organization" }),
        },
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
      availability: cloneAvailability(pendingConnect.availability),
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
    availability: cloneAvailability(readConnectionAvailability(connection)),
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

function normalizeConnectionAvailability(input: {
  connectionScope?: "organization" | "workspace" | undefined;
  workspaceId?: string | undefined;
}): IntegrationConnectionAvailability {
  if (input.connectionScope === "workspace") {
    const workspaceId = input.workspaceId?.trim() ?? "";

    if (workspaceId.length === 0) {
      throw new BadRequestException("Workspace-owned connections require a workspace ID.");
    }

    return {
      scope: "workspace",
      workspaceId,
    };
  }

  return {
    scope: "organization",
  };
}

function readConnectionAvailability(
  connection: Partial<Pick<IntegrationConnectionResponse, "availability">>,
): IntegrationConnectionAvailability {
  return connection.availability ?? {
    scope: "organization",
  };
}

function isConnectionAvailableInWorkspace(
  connection: IntegrationConnectionResponse,
  workspaceId: string | undefined,
) {
  if (workspaceId === undefined) {
    return true;
  }

  const availability = readConnectionAvailability(connection);

  return availability.scope === "organization" || availability.workspaceId === workspaceId;
}

function cloneAvailability(
  availability: IntegrationConnectionAvailability,
): IntegrationConnectionAvailability {
  return availability.scope === "workspace"
    ? {
        scope: "workspace",
        workspaceId: availability.workspaceId,
      }
    : {
        scope: "organization",
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
