import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  IntegrationConnectionResponse,
  IntegrationProvider,
  ToolPermissionGrantResponse,
  WebhookHttpToolResponse,
} from "./integrations.models";
import type { EncryptedIntegrationSecretEnvelope } from "./integrations-secret-vault";

export interface PersistedPendingOAuthConnectRecord {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  actorUserId: string;
  authorizationUrl: string;
  requestedScopes: string[];
  status: "pending";
  expiresAt: string;
  state: string;
  redirectUri: string;
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
  constructor(private readonly directoryPath: string) {}

  listOrganizationIds() {
    if (!existsSync(this.directoryPath)) {
      return [];
    }

    return readdirSync(this.directoryPath)
      .filter((fileName) => fileName.endsWith(".json") && !fileName.includes(".corrupt-"))
      .map((fileName) => fileName.slice(0, -".json".length));
  }

  load(organizationId: string): PersistedIntegrationStateRecord | null {
    const filePath = resolveStateFilePath(this.directoryPath, organizationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));

      if (!isPersistedIntegrationStateRecord(parsed, organizationId)) {
        throw new Error("Integration snapshot structure is invalid.");
      }

      return parsed;
    } catch {
      const corruptFilePath = join(
        this.directoryPath,
        `${organizationId}.corrupt-${Date.now()}.json`,
      );
      mkdirSync(this.directoryPath, { recursive: true });
      renameSync(filePath, corruptFilePath);

      return null;
    }
  }

  save(record: PersistedIntegrationStateRecord) {
    mkdirSync(this.directoryPath, { recursive: true });

    const nextFilePath = resolveStateFilePath(this.directoryPath, record.organizationId);
    const temporaryFilePath = `${nextFilePath}.tmp`;

    writeFileSync(temporaryFilePath, JSON.stringify(record, null, 2), "utf8");
    rmSync(nextFilePath, { force: true });
    renameSync(temporaryFilePath, nextFilePath);
  }
}

function resolveStateFilePath(directoryPath: string, organizationId: string) {
  return join(directoryPath, `${organizationId}.json`);
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
