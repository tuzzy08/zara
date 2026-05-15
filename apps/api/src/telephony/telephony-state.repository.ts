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
  dispatches: TelephonyDispatchRecord[];
  webhookEvents: TelephonyWebhookEvent[];
  callControlEvents?: TelephonyCallControlEvent[] | undefined;
  credentials: PersistedTelephonyCredentialRecord[];
  processedWebhookEventIds: string[];
}

export class FileTelephonyStateRepository {
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
    Array.isArray(candidate.dispatches) &&
    Array.isArray(candidate.webhookEvents) &&
    (candidate.callControlEvents === undefined || Array.isArray(candidate.callControlEvents)) &&
    Array.isArray(candidate.credentials) &&
    Array.isArray(candidate.processedWebhookEventIds)
  );
}
