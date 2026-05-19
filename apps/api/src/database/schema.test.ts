import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { drizzleConfigValues } from "./drizzle-config";
import {
  auditLogs,
  telephonyCallControlEvents,
  telephonyConnections,
  telephonyCredentialEnvelopes,
  telephonyDispatches,
  telephonyExecutionCommands,
  telephonyExecutionSessions,
  telephonyHealthChecks,
  telephonyPhoneNumbers,
  telephonyProcessedWebhookEvents,
  telephonyProviderHeartbeats,
  telephonyWebhookEvents,
  tenants,
} from "./schema";

const thisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(thisDirectory, "../../../../");

describe("database foundations", () => {
  it("defines tenant and audit tables in the initial schema", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(Object.keys(getTableColumns(tenants))).toEqual([
      "id",
      "slug",
      "name",
      "status",
      "defaultLocale",
      "createdAt",
      "updatedAt",
    ]);

    expect(getTableName(auditLogs)).toBe("audit_logs");
    expect(Object.keys(getTableColumns(auditLogs))).toEqual([
      "id",
      "tenantId",
      "actorType",
      "actorId",
      "action",
      "targetType",
      "targetId",
      "metadata",
      "occurredAt",
    ]);
  });

  it("defines normalized telephony tables for provider state and execution history", () => {
    expect(getTableName(telephonyConnections)).toBe("telephony_connections");
    expect(Object.keys(getTableColumns(telephonyConnections))).toEqual([
      "id",
      "tenantId",
      "label",
      "ownershipMode",
      "provider",
      "region",
      "status",
      "healthStatus",
      "recordingPolicy",
      "blockRoutingOnHealthFailure",
      "credentialReference",
      "externalReference",
      "sip",
      "webhookBaseUrl",
      "webhookStatus",
      "createdBy",
    ]);

    expect(getTableName(telephonyPhoneNumbers)).toBe("telephony_phone_numbers");
    expect(Object.keys(getTableColumns(telephonyPhoneNumbers))).toEqual([
      "id",
      "tenantId",
      "connectionId",
      "provider",
      "provisionSource",
      "externalNumberId",
      "phoneNumber",
      "friendlyName",
      "voiceCapable",
      "callerIdEligible",
      "status",
      "webhookStatus",
      "publishedVersionId",
      "workflowLabel",
      "workspaceId",
      "recordingPolicy",
    ]);

    expect(getTableName(telephonyHealthChecks)).toBe("telephony_health_checks");
    expect(getTableName(telephonyProviderHeartbeats)).toBe("telephony_provider_heartbeats");
    expect(getTableName(telephonyDispatches)).toBe("telephony_dispatches");
    expect(getTableName(telephonyExecutionSessions)).toBe("telephony_execution_sessions");
    expect(Object.keys(getTableColumns(telephonyExecutionSessions))).toEqual([
      "id",
      "tenantId",
      "dispatchId",
      "callSessionId",
      "connectionId",
      "provider",
      "ownershipMode",
      "direction",
      "status",
      "toPhoneNumber",
      "fromPhoneNumber",
      "workflowLabel",
      "workspaceId",
      "testCall",
      "bridgeKind",
      "bridgeTarget",
      "mediaPath",
      "outageMode",
      "fallbackTarget",
      "diagnostics",
      "createdAt",
      "updatedAt",
    ]);
    expect(getTableName(telephonyExecutionCommands)).toBe("telephony_execution_commands");
    expect(getTableName(telephonyWebhookEvents)).toBe("telephony_webhook_events");
    expect(getTableName(telephonyCallControlEvents)).toBe("telephony_call_control_events");
    expect(getTableName(telephonyCredentialEnvelopes)).toBe("telephony_credential_envelopes");
    expect(getTableName(telephonyProcessedWebhookEvents)).toBe(
      "telephony_processed_webhook_events",
    );
  });

  it("configures drizzle-kit for postgres migrations", () => {
    expect(drizzleConfigValues).toMatchObject({
      dialect: "postgresql",
      schema: "./apps/api/src/database/schema.ts",
      out: "./apps/api/src/database/migrations",
    });
  });

  it("runs migration checks in CI", () => {
    const workflowFile = readFileSync(
      resolve(repositoryRoot, ".github/workflows/migration-check.yml"),
      "utf8",
    );

    expect(workflowFile).toContain("npm run db:check");
  });
});
