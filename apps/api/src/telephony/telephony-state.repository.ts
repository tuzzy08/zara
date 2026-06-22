import type {
  ImportedTelephonyPhoneNumber,
  TelephonyCallControlEvent,
  TelephonyConnection,
  TelephonyExecutionCommand,
  TelephonyExecutionSession,
  TelephonyProviderHeartbeat,
} from "@zara/core";

import type { EncryptedTelephonySecretEnvelope } from "./telephony-secret-vault";
import type {
  TelephonyDispatchRecord,
  TelephonyHealthCheck,
  TelephonyMediaStreamTokenRecord,
  TelephonyWebhookEvent,
} from "./telephony.models";
import {
  createTenantJsonStateRepository,
  type TenantJsonStateRepository,
} from "../persistence/tenant-json-state.repository";

export interface PersistedTelephonyCredentialRecord {
  connectionId: string;
  envelope?: EncryptedTelephonySecretEnvelope | undefined;
}

export interface PersistedTelephonyStateRecord {
  schemaVersion: 1;
  organizationId: string;
  connections: TelephonyConnection[];
  phoneNumbers: ImportedTelephonyPhoneNumber[];
  healthChecks: TelephonyHealthCheck[];
  providerHeartbeats?: TelephonyProviderHeartbeat[] | undefined;
  dispatches: TelephonyDispatchRecord[];
  executionSessions?: TelephonyExecutionSession[] | undefined;
  executionCommands?: TelephonyExecutionCommand[] | undefined;
  webhookEvents: TelephonyWebhookEvent[];
  callControlEvents?: TelephonyCallControlEvent[] | undefined;
  mediaStreamTokens?: TelephonyMediaStreamTokenRecord[] | undefined;
  credentials: PersistedTelephonyCredentialRecord[];
  processedWebhookEventIds: string[];
}

export const TELEPHONY_STATE_REPOSITORY = Symbol("TELEPHONY_STATE_REPOSITORY");

export interface TelephonyStateRepository {
  listOrganizationIds(): string[] | Promise<string[]>;
  load(organizationId: string): PersistedTelephonyStateRecord | null | Promise<PersistedTelephonyStateRecord | null>;
  save(record: PersistedTelephonyStateRecord): void | Promise<void>;
}

export class FileTelephonyStateRepository implements TelephonyStateRepository {
  private readonly stateRepository: TenantJsonStateRepository<PersistedTelephonyStateRecord>;

  constructor(directoryPath: string) {
    this.stateRepository = createTenantJsonStateRepository({
      directoryPath,
      validate: isPersistedTelephonyStateRecord,
    });
  }

  listOrganizationIds() {
    return this.stateRepository.listOrganizationIds();
  }

  load(organizationId: string): PersistedTelephonyStateRecord | null {
    return this.stateRepository.load(organizationId);
  }

  save(record: PersistedTelephonyStateRecord) {
    this.stateRepository.save(record);
  }
}

function isPersistedTelephonyStateRecord(
  value: unknown,
  organizationId: string,
): value is PersistedTelephonyStateRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedTelephonyStateRecord>;

  return (
    candidate.schemaVersion === 1 &&
    candidate.organizationId === organizationId &&
    Array.isArray(candidate.connections) &&
    Array.isArray(candidate.phoneNumbers) &&
    Array.isArray(candidate.healthChecks) &&
    (candidate.providerHeartbeats === undefined || Array.isArray(candidate.providerHeartbeats)) &&
    Array.isArray(candidate.dispatches) &&
    (candidate.executionSessions === undefined || Array.isArray(candidate.executionSessions)) &&
    (candidate.executionCommands === undefined || Array.isArray(candidate.executionCommands)) &&
    Array.isArray(candidate.webhookEvents) &&
    (candidate.callControlEvents === undefined || Array.isArray(candidate.callControlEvents)) &&
    (candidate.mediaStreamTokens === undefined || Array.isArray(candidate.mediaStreamTokens)) &&
    Array.isArray(candidate.credentials) &&
    Array.isArray(candidate.processedWebhookEventIds)
  );
}
