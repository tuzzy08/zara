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
  TelephonyWebhookEvent,
} from "./telephony.models";

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
  constructor(private readonly directoryPath: string) {}

  listOrganizationIds() {
    if (!existsSync(this.directoryPath)) {
      return [];
    }

    return readdirSync(this.directoryPath)
      .filter((fileName) => fileName.endsWith(".json") && !fileName.includes(".corrupt-"))
      .map((fileName) => fileName.slice(0, -".json".length));
  }

  load(organizationId: string): PersistedTelephonyStateRecord | null {
    const filePath = resolveStateFilePath(this.directoryPath, organizationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));

      if (!isPersistedTelephonyStateRecord(parsed, organizationId)) {
        throw new Error("Telephony snapshot structure is invalid.");
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

  save(record: PersistedTelephonyStateRecord) {
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
    Array.isArray(candidate.credentials) &&
    Array.isArray(candidate.processedWebhookEventIds)
  );
}
