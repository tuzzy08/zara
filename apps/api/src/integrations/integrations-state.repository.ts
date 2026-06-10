import type {
  IntegrationConnectionAvailability,
  IntegrationConnectionResponse,
  IntegrationProvider,
  ToolPermissionGrantResponse,
  WebhookHttpToolResponse,
} from "./integrations.models";
import type { EncryptedIntegrationSecretEnvelope } from "./integrations-secret-vault";
import {
  createTenantJsonStateRepository,
  type TenantJsonStateRepository,
} from "../persistence/tenant-json-state.repository";

export interface PersistedPendingOAuthConnectRecord {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  actorUserId: string;
  authorizationUrl: string;
  requestedScopes: string[];
  availability?: IntegrationConnectionAvailability | undefined;
  status: "pending";
  expiresAt: string;
  state: string;
  redirectUri: string;
  shopifyShopDomain?: string | undefined;
}

export interface PersistedIntegrationCredentialRecord {
  connectionId: string;
  envelope?: EncryptedIntegrationSecretEnvelope | undefined;
}

export interface PersistedWebhookHttpToolSecretRecord {
  toolId: string;
  envelope?: EncryptedIntegrationSecretEnvelope | undefined;
}

export interface PersistedIntegrationStateRecord {
  schemaVersion: 1;
  organizationId: string;
  pendingConnects: PersistedPendingOAuthConnectRecord[];
  connections: IntegrationConnectionResponse[];
  credentials: PersistedIntegrationCredentialRecord[];
  toolGrants?: ToolPermissionGrantResponse[] | undefined;
  webhookTools?: WebhookHttpToolResponse[] | undefined;
  webhookToolSecrets?: PersistedWebhookHttpToolSecretRecord[] | undefined;
}

export const INTEGRATION_STATE_REPOSITORY = Symbol("INTEGRATION_STATE_REPOSITORY");

export interface IntegrationStateRepository {
  listOrganizationIds(): string[] | Promise<string[]>;
  load(organizationId: string): PersistedIntegrationStateRecord | null | Promise<PersistedIntegrationStateRecord | null>;
  save(record: PersistedIntegrationStateRecord): void | Promise<void>;
}

export class FileIntegrationStateRepository implements IntegrationStateRepository {
  private readonly stateRepository: TenantJsonStateRepository<PersistedIntegrationStateRecord>;

  constructor(directoryPath: string) {
    this.stateRepository = createTenantJsonStateRepository({
      directoryPath,
      validate: isPersistedIntegrationStateRecord,
    });
  }

  listOrganizationIds() {
    return this.stateRepository.listOrganizationIds();
  }

  load(organizationId: string): PersistedIntegrationStateRecord | null {
    return this.stateRepository.load(organizationId);
  }

  save(record: PersistedIntegrationStateRecord) {
    this.stateRepository.save(record);
  }
}

function isPersistedIntegrationStateRecord(
  value: unknown,
  organizationId: string,
): value is PersistedIntegrationStateRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedIntegrationStateRecord>;

  return (
    candidate.schemaVersion === 1 &&
    candidate.organizationId === organizationId &&
    Array.isArray(candidate.pendingConnects) &&
    Array.isArray(candidate.connections) &&
    Array.isArray(candidate.credentials)
  );
}
