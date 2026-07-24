import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { drizzleConfigValues } from "./drizzle-config";
import {
  authAccounts,
  authInvitations,
  authMembers,
  authOrganizations,
  authRateLimits,
  authSessions,
  authUsers,
  authVerifications,
  auditLogs,
  telephonyCallControlEvents,
  telephonyConnections,
  telephonyCredentialEnvelopes,
  telephonyDispatches,
  telephonyExecutionCommands,
  telephonyExecutionSessions,
  telephonyHealthChecks,
  telephonyMediaStreamTokens,
  telephonyPhoneNumbers,
  telephonyPhoneTestCheckpoints,
  telephonyProcessedWebhookEvents,
  telephonyProviderHeartbeats,
  telephonyWebhookEvents,
  memoryEmbeddings,
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

  it("defines Better Auth core and organization tables for durable tenant signup", () => {
    expect(getTableName(authUsers)).toBe("user");
    expect(Object.keys(getTableColumns(authUsers))).toEqual([
      "id",
      "name",
      "email",
      "emailVerified",
      "image",
      "createdAt",
      "updatedAt",
    ]);

    expect(getTableName(authSessions)).toBe("session");
    expect(Object.keys(getTableColumns(authSessions))).toEqual([
      "id",
      "userId",
      "token",
      "expiresAt",
      "ipAddress",
      "userAgent",
      "activeOrganizationId",
      "activeTeamId",
      "createdAt",
      "updatedAt",
    ]);

    expect(getTableName(authAccounts)).toBe("account");
    expect(getTableName(authVerifications)).toBe("verification");
    expect(getTableName(authOrganizations)).toBe("organization");
    expect(Object.keys(getTableColumns(authOrganizations))).toEqual([
      "id",
      "name",
      "slug",
      "logo",
      "metadata",
      "createdAt",
    ]);
    expect(getTableName(authMembers)).toBe("member");
    expect(Object.keys(getTableColumns(authMembers))).toEqual([
      "id",
      "userId",
      "organizationId",
      "role",
      "createdAt",
    ]);
    expect(getTableName(authInvitations)).toBe("invitation");
    expect(Object.keys(getTableColumns(authInvitations))).toEqual([
      "id",
      "email",
      "inviterId",
      "organizationId",
      "role",
      "status",
      "createdAt",
      "expiresAt",
      "workspaceId",
      "workspaceRole",
    ]);

    const migrationFile = readFileSync(
      resolve(repositoryRoot, "apps/api/src/database/migrations/0003_auth_organizations.sql"),
      "utf8",
    );
    const invitationWorkspaceIntentMigrationFile = readFileSync(
      resolve(repositoryRoot, "apps/api/src/database/migrations/0005_auth_invitation_workspace_intent.sql"),
      "utf8",
    );

    expect(migrationFile).toContain('CREATE TABLE "user"');
    expect(migrationFile).toContain('CREATE TABLE "organization"');
    expect(migrationFile).toContain('"activeOrganizationId" text');
    expect(migrationFile).toContain('CREATE TABLE "member"');
    expect(migrationFile).toContain('CREATE TABLE "invitation"');
    expect(invitationWorkspaceIntentMigrationFile).toContain('ALTER TABLE "invitation" ADD COLUMN "workspaceId" text');
    expect(invitationWorkspaceIntentMigrationFile).toContain('ALTER TABLE "invitation" ADD COLUMN "workspaceRole" text');
  });

  it("defines Better Auth's database-backed rate limit table for production auth hardening", () => {
    expect(getTableName(authRateLimits)).toBe("rateLimit");
    expect(Object.keys(getTableColumns(authRateLimits))).toEqual([
      "id",
      "key",
      "count",
      "lastRequest",
    ]);

    const migrationFile = readFileSync(
      resolve(repositoryRoot, "apps/api/src/database/migrations/0006_auth_rate_limit_table.sql"),
      "utf8",
    );

    expect(migrationFile).toContain('CREATE TABLE IF NOT EXISTS "rateLimit"');
    expect(migrationFile).toContain('"key" text NOT NULL');
    expect(migrationFile).toContain('"count" integer NOT NULL');
    expect(migrationFile).toContain('"lastRequest" bigint NOT NULL');
    expect(migrationFile).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "auth_rate_limit_key_unique_idx"');
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
      "liveRoute",
      "testRoute",
      "phoneTestResults",
      "recordingPolicy",
    ]);

    expect(getTableName(telephonyHealthChecks)).toBe("telephony_health_checks");
    expect(getTableName(telephonyProviderHeartbeats)).toBe("telephony_provider_heartbeats");
    expect(getTableName(telephonyDispatches)).toBe("telephony_dispatches");
    expect(getTableColumns(telephonyDispatches)).toHaveProperty("recordingConsent");
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
      "version",
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
      "recordingConsent",
      "diagnostics",
      "policyState",
      "lifecycleState",
      "createdAt",
      "updatedAt",
    ]);
    expect(getTableName(telephonyMediaStreamTokens)).toBe("telephony_media_stream_tokens");
    expect(getTableName(telephonyPhoneTestCheckpoints)).toBe(
      "telephony_phone_test_checkpoints",
    );
    const lifecycleMigration = readFileSync(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0010_bitter_pretty_boy.sql",
      ),
      "utf8",
    );
    expect(lifecycleMigration).toContain(
      'ALTER TABLE "telephony_execution_sessions"',
    );
    expect(lifecycleMigration).toContain('"lifecycle_state" jsonb');
    expect(lifecycleMigration).toContain(
      `WHEN "status" = 'completed' THEN 'completed'`,
    );
    expect(lifecycleMigration).toContain(
      `WHEN "status" IN ('terminated', 'blocked') THEN 'failed'`,
    );
    expect(lifecycleMigration).toContain(
      'DROP INDEX IF EXISTS "telephony_phone_test_checkpoints_tenant_test_checkpoint_unique_idx"',
    );
    expect(lifecycleMigration).toContain(
      'CREATE UNIQUE INDEX "telephony_phone_test_checkpoints_tenant_call_checkpoint_unique_idx"',
    );
    expect(getTableName(telephonyExecutionCommands)).toBe("telephony_execution_commands");
    expect(getTableName(telephonyWebhookEvents)).toBe("telephony_webhook_events");
    expect(getTableName(telephonyCallControlEvents)).toBe("telephony_call_control_events");
    expect(getTableName(telephonyCredentialEnvelopes)).toBe("telephony_credential_envelopes");
    expect(getTableName(telephonyProcessedWebhookEvents)).toBe(
      "telephony_processed_webhook_events",
    );
  });

  it("ships the execution-session policy state as an executable migration", () => {
    const migrationFile = readFileSync(
      resolve(repositoryRoot, "apps/api/src/database/migrations/0008_telephony_execution_policy_state.sql"),
      "utf8",
    );
    const migrationJournal = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "apps/api/src/database/migrations/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ tag: string }> };

    expect(migrationFile).toContain(
      'ALTER TABLE "telephony_execution_sessions" ADD COLUMN IF NOT EXISTS "policy_state" jsonb',
    );
    expect(migrationJournal.entries).toContainEqual(
      expect.objectContaining({ tag: "0008_telephony_execution_policy_state" }),
    );
  });

  it("ships additive incremental telephony persistence with an ordered rollback", () => {
    const migrationFile = readFileSync(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0009_telephony_incremental_persistence.sql",
      ),
      "utf8",
    );
    const migrationJournal = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "apps/api/src/database/migrations/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: Array<{ tag: string }> };
    const rollbackFile = readFileSync(
      resolve(
        repositoryRoot,
        "docs/Runbooks/rollback-0009-telephony-incremental-persistence.sql",
      ),
      "utf8",
    );

    expect(migrationFile).toContain('ADD COLUMN IF NOT EXISTS "version" integer');
    expect(migrationFile).toContain('ADD COLUMN IF NOT EXISTS "recording_consent" jsonb');
    expect(migrationFile).toContain('PRIMARY KEY ("tenant_id", "id")');
    expect(migrationFile).toContain(
      'ALTER TABLE "telephony_dispatches" ADD COLUMN IF NOT EXISTS "runtime_path" text',
    );
    expect(migrationFile).toContain('CREATE TABLE IF NOT EXISTS "telephony_media_stream_tokens"');
    expect(migrationFile).toContain('char_length("token_hash") = 43');
    expect(migrationFile).toContain(
      'CREATE TABLE IF NOT EXISTS "telephony_phone_test_checkpoints"',
    );
    expect(migrationFile).toContain("Rollback order:");
    expect(migrationFile).toContain("duplicate tenant call dispatches exist");
    expect(rollbackFile).toContain('DROP TABLE IF EXISTS "telephony_media_stream_tokens"');
    expect(rollbackFile).toContain("Cannot restore legacy webhook uniqueness");
    expect(migrationJournal.entries).toContainEqual(
      expect.objectContaining({ tag: "0009_telephony_incremental_persistence" }),
    );
  });

  it("scopes execution command and call-control event identities by tenant with rollback", () => {
    const commandPrimaryKey = getTableConfig(telephonyExecutionCommands).primaryKeys[0];
    const eventPrimaryKey = getTableConfig(telephonyCallControlEvents).primaryKeys[0];
    expect(commandPrimaryKey?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
    ]);
    expect(eventPrimaryKey?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
    ]);

    const migrationFile = readFileSync(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0011_telephony_tenant_composite_identities.sql",
      ),
      "utf8",
    );
    const rollbackFile = readFileSync(
      resolve(
        repositoryRoot,
        "docs/Runbooks/rollback-0011-telephony-tenant-composite-identities.sql",
      ),
      "utf8",
    );
    expect(migrationFile).toContain(
      'PRIMARY KEY ("tenant_id","id")',
    );
    expect(migrationFile).toContain(
      'ALTER TABLE "telephony_call_control_events" DROP CONSTRAINT',
    );
    expect(rollbackFile).toContain(
      "Cannot restore global telephony execution-command identity",
    );
    expect(rollbackFile).toContain(
      "Cannot restore global telephony call-control event identity",
    );
  });

  it("defines pgvector-backed memory embedding storage and index migration", () => {
    expect(getTableName(memoryEmbeddings)).toBe("memory_embeddings");
    expect(Object.keys(getTableColumns(memoryEmbeddings))).toEqual([
      "id",
      "tenantId",
      "recordKind",
      "recordId",
      "scope",
      "callerKind",
      "callerValue",
      "accountId",
      "publishedWorkflowVersionIds",
      "confidence",
      "embedding",
      "createdAt",
    ]);

    const migrationFile = readFileSync(
      resolve(repositoryRoot, "apps/api/src/database/migrations/0002_cool_tattoo.sql"),
      "utf8",
    );

    expect(migrationFile).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(migrationFile).toContain('"embedding" vector(1536) NOT NULL');
    expect(migrationFile).toContain("USING ivfflat");
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
