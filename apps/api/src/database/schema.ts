import {
  boolean,
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  CompiledRuntimeManifest,
  EncryptedCredentialReference,
  ImportedTelephonyPhoneNumber,
  OutboundCallPolicyChecks,
  SipTrunkMetadata,
  TelephonyCallControlEvent,
  TelephonyConnection,
  TelephonyExecutionSession,
  TelephonyProviderHeartbeat,
  TelephonyRecordingConsentState,
  TelephonyRecordingPolicy,
} from "@zara/core";

import type {
  TelephonyDispatchRecord,
  TelephonyHealthCheck,
} from "../telephony/telephony.models";
import type { TelephonyPremiumDispatchSnapshot } from "../telephony/telephony-incremental.repository";
import type { EncryptedTelephonySecretEnvelope } from "../telephony/telephony-secret-vault";
import type { PaygCallChargeContext } from "../billing/billing-payg-call-charge-policy";

export const tenantStatus = pgEnum("tenant_status", ["active", "suspended", "archived"]);

export const authUsers = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull(),
    image: text("image"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
  },
  (table) => ({
    emailUniqueIndex: uniqueIndex("auth_user_email_unique_idx").on(table.email),
  }),
);

export const authOrganizations = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
  },
  (table) => ({
    slugUniqueIndex: uniqueIndex("auth_organization_slug_unique_idx").on(table.slug),
  }),
);

export const authSessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    token: text("token").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    activeOrganizationId: text("activeOrganizationId").references(() => authOrganizations.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    activeTeamId: text("activeTeamId"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
  },
  (table) => ({
    tokenUniqueIndex: uniqueIndex("auth_session_token_unique_idx").on(table.token),
    userIndex: index("auth_session_user_idx").on(table.userId),
  }),
);

export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("idToken"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userIndex: index("auth_account_user_idx").on(table.userId),
  }),
);

export const authVerifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }),
  updatedAt: timestamp("updatedAt", { withTimezone: true }),
});

export const authMembers = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => authOrganizations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: text("role").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userOrganizationUniqueIndex: uniqueIndex("auth_member_user_organization_unique_idx").on(
      table.userId,
      table.organizationId,
    ),
    organizationIndex: index("auth_member_organization_idx").on(table.organizationId),
  }),
);

export const authInvitations = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => authUsers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    organizationId: text("organizationId")
      .notNull()
      .references(() => authOrganizations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: text("role"),
    status: text("status").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    workspaceId: text("workspaceId"),
    workspaceRole: text("workspaceRole"),
  },
  (table) => ({
    organizationEmailIndex: index("auth_invitation_organization_email_idx").on(
      table.organizationId,
      table.email,
    ),
  }),
);

export const authRateLimits = pgTable(
  "rateLimit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("lastRequest", { mode: "number" }).notNull(),
  },
  (table) => ({
    keyUniqueIndex: uniqueIndex("auth_rate_limit_key_unique_idx").on(table.key),
  }),
);

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: tenantStatus("status").notNull().default("active"),
    defaultLocale: text("default_locale").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUniqueIndex: uniqueIndex("tenants_slug_unique_idx").on(table.slug),
    statusIndex: index("tenants_status_idx").on(table.status),
  }),
);

export const publishedWorkflowManifests = pgTable(
  "published_workflow_manifests",
  {
    publishedVersionId: text("published_version_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    manifest: jsonb("manifest").$type<CompiledRuntimeManifest>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.publishedVersionId] }),
    tenantWorkflowIndex: index("published_workflow_manifests_tenant_workflow_idx").on(
      table.tenantId,
      table.workflowId,
    ),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantOccurredAtIndex: index("audit_logs_tenant_occurred_at_idx").on(
      table.tenantId,
      table.occurredAt,
    ),
    actionIndex: index("audit_logs_action_idx").on(table.action),
    tenantIdUniqueIndex: uniqueIndex("audit_logs_tenant_id_id_unique_idx").on(
      table.tenantId,
      table.id,
    ),
  }),
);

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
});

export const memoryEmbeddings = pgTable(
  "memory_embeddings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    recordKind: text("record_kind").$type<"memory" | "tenant_knowledge">().notNull(),
    recordId: text("record_id").notNull(),
    scope: text("scope").$type<"caller" | "account" | "tenant_knowledge">().notNull(),
    callerKind: text("caller_kind").$type<"phone" | "email" | "external_id" | null>(),
    callerValue: text("caller_value"),
    accountId: text("account_id"),
    publishedWorkflowVersionIds: jsonb("published_workflow_version_ids")
      .$type<string[] | null>(),
    confidence: real("confidence").notNull(),
    embedding: vector1536("embedding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantScopeIndex: index("memory_embeddings_tenant_scope_idx").on(
      table.tenantId,
      table.scope,
    ),
    callerIndex: index("memory_embeddings_caller_idx").on(
      table.tenantId,
      table.callerKind,
      table.callerValue,
    ),
    accountIndex: index("memory_embeddings_account_idx").on(table.tenantId, table.accountId),
  }),
);

export const telephonyConnections = pgTable(
  "telephony_connections",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    label: text("label").notNull(),
    ownershipMode: text("ownership_mode").$type<TelephonyConnection["ownershipMode"]>().notNull(),
    provider: text("provider").$type<TelephonyConnection["provider"]>().notNull(),
    region: text("region").notNull(),
    status: text("status").$type<TelephonyConnection["status"]>().notNull(),
    healthStatus: text("health_status").$type<TelephonyConnection["healthStatus"]>().notNull(),
    outboundAbuseBlocked: boolean("outbound_abuse_blocked").notNull().default(false),
    recordingPolicy: jsonb("recording_policy").$type<TelephonyRecordingPolicy>().notNull(),
    blockRoutingOnHealthFailure: boolean("block_routing_on_health_failure").notNull(),
    credentialReference: jsonb("credential_reference").$type<EncryptedCredentialReference | null>(),
    externalReference: text("external_reference"),
    sip: jsonb("sip").$type<SipTrunkMetadata | null>(),
    webhookBaseUrl: text("webhook_base_url"),
    webhookStatus: text("webhook_status").$type<TelephonyConnection["webhookStatus"]>().notNull(),
    createdBy: text("created_by").notNull(),
  },
  (table) => ({
    tenantIndex: index("telephony_connections_tenant_idx").on(table.tenantId),
    providerIndex: index("telephony_connections_provider_idx").on(table.provider),
  }),
);

export const telephonyPhoneNumbers = pgTable(
  "telephony_phone_numbers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => telephonyConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text("provider").$type<ImportedTelephonyPhoneNumber["provider"]>().notNull(),
    provisionSource: text("provision_source")
      .$type<ImportedTelephonyPhoneNumber["provisionSource"]>()
      .notNull(),
    externalNumberId: text("external_number_id").notNull(),
    phoneNumber: text("phone_number").notNull(),
    friendlyName: text("friendly_name").notNull(),
    voiceCapable: boolean("voice_capable").notNull(),
    callerIdEligible: boolean("caller_id_eligible").notNull(),
    status: text("status").$type<ImportedTelephonyPhoneNumber["status"]>().notNull(),
    webhookStatus: text("webhook_status")
      .$type<ImportedTelephonyPhoneNumber["webhookStatus"]>()
      .notNull(),
    liveRoute: jsonb("live_route").$type<ImportedTelephonyPhoneNumber["liveRoute"] | null>(),
    testRoute: jsonb("test_route").$type<ImportedTelephonyPhoneNumber["testRoute"] | null>(),
    phoneTestResults: jsonb("phone_test_results").$type<ImportedTelephonyPhoneNumber["phoneTestResults"] | null>(),
    recordingPolicy: jsonb("recording_policy").$type<TelephonyRecordingPolicy | null>(),
  },
  (table) => ({
    tenantPhoneIndex: uniqueIndex("telephony_phone_numbers_tenant_phone_unique_idx").on(
      table.tenantId,
      table.phoneNumber,
    ),
    connectionIndex: index("telephony_phone_numbers_connection_idx").on(table.connectionId),
  }),
);

export const telephonyHealthChecks = pgTable(
  "telephony_health_checks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => telephonyConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    status: text("status").$type<TelephonyHealthCheck["status"]>().notNull(),
    blocking: boolean("blocking").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    message: text("message").notNull(),
    scheduled: boolean("scheduled"),
    latencyMs: integer("latency_ms"),
    diagnostics: jsonb("diagnostics").$type<string[] | null>(),
  },
  (table) => ({
    tenantCheckedAtIndex: index("telephony_health_checks_tenant_checked_at_idx").on(
      table.tenantId,
      table.checkedAt,
    ),
  }),
);

export const telephonyProviderHeartbeats = pgTable(
  "telephony_provider_heartbeats",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => telephonyConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text("provider").$type<TelephonyProviderHeartbeat["provider"]>().notNull(),
    ownershipMode: text("ownership_mode")
      .$type<TelephonyProviderHeartbeat["ownershipMode"]>()
      .notNull(),
    status: text("status").$type<TelephonyProviderHeartbeat["status"]>().notNull(),
    blocking: boolean("blocking").notNull(),
    scheduled: boolean("scheduled").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    routedNumberCount: integer("routed_number_count").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    message: text("message").notNull(),
    diagnostics: jsonb("diagnostics").$type<string[]>().notNull(),
  },
  (table) => ({
    tenantAtIndex: index("telephony_provider_heartbeats_tenant_at_idx").on(
      table.tenantId,
      table.at,
    ),
  }),
);

export const telephonyDispatches = pgTable(
  "telephony_dispatches",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    direction: text("direction").$type<TelephonyDispatchRecord["direction"]>().notNull(),
    disposition: text("disposition").$type<TelephonyDispatchRecord["disposition"]>().notNull(),
    reason: text("reason").notNull(),
    callSessionId: text("call_session_id"),
    phoneNumberId: text("phone_number_id"),
    fallbackPhoneNumberId: text("fallback_phone_number_id"),
    connectionId: text("connection_id"),
    publishedVersionId: text("published_version_id"),
    workspaceId: text("workspace_id"),
    workflowLabel: text("workflow_label"),
    routeMode: text("route_mode").$type<TelephonyDispatchRecord["routeMode"] | null>(),
    runtimeProfile: text("runtime_profile").$type<TelephonyDispatchRecord["runtimeProfile"] | null>(),
    runtimePath: text("runtime_path").$type<TelephonyDispatchRecord["runtimePath"] | null>(),
    testRouteSessionId: text("test_route_session_id"),
    outageMode: text("outage_mode").$type<TelephonyDispatchRecord["outageMode"] | null>(),
    recording: jsonb("recording").$type<TelephonyRecordingPolicy>().notNull(),
    recordingConsent: jsonb("recording_consent").$type<TelephonyRecordingConsentState>(),
    toPhoneNumber: text("to_phone_number").notNull(),
    fromPhoneNumber: text("from_phone_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    source: text("source").$type<TelephonyDispatchRecord["source"]>().notNull(),
    policyChecks: jsonb("policy_checks").$type<OutboundCallPolicyChecks | null>(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantCreatedAtIndex: index("telephony_dispatches_tenant_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    callSessionIndex: index("telephony_dispatches_call_session_idx").on(table.callSessionId),
    tenantCallSessionUniqueIndex: uniqueIndex(
      "telephony_dispatches_tenant_call_session_unique_idx",
    ).on(table.tenantId, table.callSessionId),
  }),
);

export const telephonyExecutionSessions = pgTable(
  "telephony_execution_sessions",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    dispatchId: text("dispatch_id").notNull(),
    callSessionId: text("call_session_id").notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => telephonyConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text("provider").$type<TelephonyExecutionSession["provider"]>().notNull(),
    ownershipMode: text("ownership_mode")
      .$type<TelephonyExecutionSession["ownershipMode"]>()
      .notNull(),
    direction: text("direction").$type<TelephonyExecutionSession["direction"]>().notNull(),
    status: text("status").$type<TelephonyExecutionSession["status"]>().notNull(),
    version: integer("version").notNull().default(0),
    toPhoneNumber: text("to_phone_number").notNull(),
    fromPhoneNumber: text("from_phone_number").notNull(),
    workflowLabel: text("workflow_label"),
    workspaceId: text("workspace_id"),
    testCall: boolean("test_call").notNull(),
    bridgeKind: text("bridge_kind").$type<TelephonyExecutionSession["bridgeKind"]>().notNull(),
    bridgeTarget: text("bridge_target").notNull(),
    mediaPath: text("media_path").$type<TelephonyExecutionSession["mediaPath"]>().notNull(),
    outageMode: text("outage_mode").$type<TelephonyExecutionSession["outageMode"] | null>(),
    fallbackTarget: text("fallback_target"),
    recordingConsent: jsonb("recording_consent").$type<TelephonyRecordingConsentState>(),
    diagnostics: jsonb("diagnostics").$type<string[]>().notNull(),
    policyState: jsonb("policy_state").$type<TelephonyExecutionSession["policyState"] | null>(),
    lifecycleState: jsonb("lifecycle_state")
      .$type<NonNullable<TelephonyExecutionSession["lifecycleState"]>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    dispatchForeignKey: foreignKey({
      columns: [table.tenantId, table.dispatchId],
      foreignColumns: [telephonyDispatches.tenantId, telephonyDispatches.id],
      name: "telephony_execution_sessions_dispatch_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    tenantUpdatedAtIndex: index("telephony_execution_sessions_tenant_updated_at_idx").on(
      table.tenantId,
      table.updatedAt,
    ),
    tenantCallSessionUniqueIndex: uniqueIndex(
      "telephony_execution_sessions_tenant_call_session_unique_idx",
    ).on(table.tenantId, table.callSessionId),
  }),
);

export const telephonyMediaStreamTokens = pgTable(
  "telephony_media_stream_tokens",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    callSessionId: text("call_session_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => telephonyConnections.id, { onDelete: "cascade", onUpdate: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    ownerWorkerId: text("owner_worker_id"),
    ownerEpoch: integer("owner_epoch").notNull().default(0),
    ownerLeaseExpiresAt: timestamp("owner_lease_expires_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.callSessionId] }),
    sessionForeignKey: foreignKey({
      columns: [table.tenantId, table.callSessionId],
      foreignColumns: [telephonyExecutionSessions.tenantId, telephonyExecutionSessions.callSessionId],
      name: "telephony_media_stream_tokens_session_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    dispatchForeignKey: foreignKey({
      columns: [table.tenantId, table.dispatchId],
      foreignColumns: [telephonyDispatches.tenantId, telephonyDispatches.id],
      name: "telephony_media_stream_tokens_dispatch_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    tokenHashCheck: check(
      "telephony_media_stream_tokens_token_hash_check",
      sql`char_length(${table.tokenHash}) = 43 and ${table.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    tenantTokenHashUniqueIndex: uniqueIndex(
      "telephony_media_stream_tokens_tenant_token_hash_unique_idx",
    ).on(table.tenantId, table.tokenHash),
    ownerEpochCheck: check(
      "telephony_media_stream_tokens_owner_epoch_check",
      sql`${table.ownerEpoch} >= 0`,
    ),
    ownerPairCheck: check(
      "telephony_media_stream_tokens_owner_pair_check",
      sql`(${table.ownerWorkerId} is null and ${table.ownerEpoch} = 0)
          or (${table.ownerWorkerId} is not null and ${table.ownerEpoch} > 0)`,
    ),
  }),
);

export const telephonyPremiumDispatchSnapshots = pgTable(
  "telephony_premium_dispatch_snapshots",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    callSessionId: text("call_session_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    publishedVersionId: text("published_version_id").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    checksum: text("checksum").notNull(),
    snapshot: jsonb("snapshot").$type<TelephonyPremiumDispatchSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.callSessionId] }),
    sessionForeignKey: foreignKey({
      columns: [table.tenantId, table.callSessionId],
      foreignColumns: [telephonyExecutionSessions.tenantId, telephonyExecutionSessions.callSessionId],
      name: "telephony_premium_dispatch_snapshots_session_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    dispatchForeignKey: foreignKey({
      columns: [table.tenantId, table.dispatchId],
      foreignColumns: [telephonyDispatches.tenantId, telephonyDispatches.id],
      name: "telephony_premium_dispatch_snapshots_dispatch_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    schemaVersionCheck: check(
      "telephony_premium_dispatch_snapshots_schema_version_check",
      sql`${table.schemaVersion} > 0`,
    ),
    checksumCheck: check(
      "telephony_premium_dispatch_snapshots_checksum_check",
      sql`char_length(${table.checksum}) = 64 and ${table.checksum} ~ '^[a-f0-9]{64}$'`,
    ),
    snapshotObjectCheck: check(
      "telephony_premium_dispatch_snapshots_snapshot_object_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
  }),
);

export const telephonyExecutionCommands = pgTable(
  "telephony_execution_commands",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sessionId: text("session_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    callSessionId: text("call_session_id").notNull(),
    provider: text("provider").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    target: text("target").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    sessionForeignKey: foreignKey({
      columns: [table.tenantId, table.sessionId],
      foreignColumns: [telephonyExecutionSessions.tenantId, telephonyExecutionSessions.id],
      name: "telephony_execution_commands_session_fk",
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    sessionRequestedAtIndex: index("telephony_execution_commands_session_requested_at_idx").on(
      table.sessionId,
      table.requestedAt,
    ),
  }),
);

export const telephonyWebhookEvents = pgTable(
  "telephony_webhook_events",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => telephonyConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    accountSid: text("account_sid").notNull(),
    callSid: text("call_sid").notNull(),
    eventSid: text("event_sid").notNull(),
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    duplicate: boolean("duplicate").notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantEventSidIndex: uniqueIndex("telephony_webhook_events_tenant_connection_event_sid_unique_idx").on(
      table.tenantId,
      table.connectionId,
      table.eventSid,
    ),
  }),
);

export const telephonyCallControlEvents = pgTable(
  "telephony_call_control_events",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    dispatchId: text("dispatch_id").notNull(),
    callSessionId: text("call_session_id").notNull(),
    eventType: text("event_type").$type<TelephonyCallControlEvent["eventType"]>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    fallbackTarget: text("fallback_target"),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantAtIndex: index("telephony_call_control_events_tenant_at_idx").on(table.tenantId, table.at),
  }),
);

export const telephonyCredentialEnvelopes = pgTable(
  "telephony_credential_envelopes",
  {
    connectionId: text("connection_id")
      .primaryKey()
      .references(() => telephonyConnections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    envelope: jsonb("envelope").$type<EncryptedTelephonySecretEnvelope | null>(),
  },
  (table) => ({
    tenantIndex: index("telephony_credential_envelopes_tenant_idx").on(table.tenantId),
  }),
);

export const telephonyPhoneTestCheckpoints = pgTable(
  "telephony_phone_test_checkpoints",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    phoneNumberId: text("phone_number_id")
      .notNull()
      .references(() => telephonyPhoneNumbers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    callSessionId: text("call_session_id").notNull(),
    testRouteSessionId: text("test_route_session_id").notNull(),
    checkpoint: text("checkpoint").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantCallCheckpointUniqueIndex: uniqueIndex(
      "telephony_phone_test_checkpoints_tenant_call_checkpoint_unique_idx",
    ).on(table.tenantId, table.callSessionId, table.checkpoint),
  }),
);

export const billingCustomers = pgTable(
  "billing_customers",
  {
    tenantId: text("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerCustomerUniqueIndex: uniqueIndex(
      "billing_customers_provider_customer_unique_idx",
    ).on(table.provider, table.providerCustomerId),
    providerCheck: check("billing_customers_provider_check", sql`${table.provider} = 'polar'`),
  }),
);

export const billingPriceCatalogs = pgTable(
  "billing_price_catalogs",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    checksum: text("checksum").notNull(),
    catalogDocument: jsonb("catalog_document").$type<Record<string, unknown>>().notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionUniqueIndex: uniqueIndex("billing_price_catalogs_version_unique_idx").on(
      table.version,
    ),
    versionCheck: check("billing_price_catalogs_version_check", sql`${table.version} > 0`),
    statusCheck: check("billing_price_catalogs_status_check", sql`${table.status} = 'active'`),
    currencyCheck: check("billing_price_catalogs_currency_check", sql`${table.currency} = 'usd'`),
    checksumCheck: check(
      "billing_price_catalogs_checksum_check",
      sql`char_length(${table.checksum}) = 64 and ${table.checksum} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);

export const billingLedgerEntries = pgTable(
  "billing_ledger_entries",
  {
    id: text("id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    entryType: text("entry_type").notNull(),
    catalogId: text("catalog_id").references(() => billingPriceCatalogs.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    currency: text("currency").notNull(),
    customerAmountMinor: bigint("customer_amount_minor", { mode: "number" }),
    supplierCostMinor: bigint("supplier_cost_minor", { mode: "number" }),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    unit: text("unit").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantIdempotencyUniqueIndex: uniqueIndex(
      "billing_ledger_entries_tenant_idempotency_unique_idx",
    ).on(table.tenantId, table.idempotencyKey),
    tenantOccurredAtIndex: index("billing_ledger_entries_tenant_occurred_at_idx").on(
      table.tenantId,
      table.occurredAt,
    ),
    currencyCheck: check("billing_ledger_entries_currency_check", sql`${table.currency} = 'usd'`),
    customerAmountCheck: check(
      "billing_ledger_entries_customer_amount_check",
      sql`${table.customerAmountMinor} is null or ${table.customerAmountMinor} >= 0`,
    ),
    supplierCostCheck: check(
      "billing_ledger_entries_supplier_cost_check",
      sql`${table.supplierCostMinor} is null or ${table.supplierCostMinor} >= 0`,
    ),
    quantityCheck: check("billing_ledger_entries_quantity_check", sql`${table.quantity} >= 0`),
  }),
);

export const billingTenantStates = pgTable("billing_tenant_states", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => billingPriceCatalogs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    planSlug: text("plan_slug"),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    providerSubscriptionUniqueIndex: uniqueIndex(
      "billing_subscriptions_provider_subscription_unique_idx",
    ).on(table.providerSubscriptionId),
    tenantStatusIndex: index("billing_subscriptions_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),
    versionCheck: check("billing_subscriptions_version_check", sql`${table.version} > 0`),
  }),
);

export const billingCycles = pgTable(
  "billing_cycles",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => billingPriceCatalogs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantStartsAtIndex: index("billing_cycles_tenant_starts_at_idx").on(
      table.tenantId,
      table.startsAt,
    ),
    rangeCheck: check("billing_cycles_range_check", sql`${table.endsAt} > ${table.startsAt}`),
    utcDayBoundariesCheck: check(
      "billing_cycles_utc_day_boundaries_check",
      sql`date_trunc('day', ${table.startsAt} AT TIME ZONE 'UTC') = ${table.startsAt} AT TIME ZONE 'UTC'
        AND date_trunc('day', ${table.endsAt} AT TIME ZONE 'UTC') = ${table.endsAt} AT TIME ZONE 'UTC'`,
    ),
  }),
);

export const billingBudgetPolicies = pgTable(
  "billing_budget_policies",
  {
    tenantId: text("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    currency: text("currency").notNull(),
    overageLimitMinor: bigint("overage_limit_minor", { mode: "number" }).notNull().default(0),
    callMinuteLimit: real("call_minute_limit").notNull().default(0),
    premiumRuntimeMinuteLimit: real("premium_runtime_minute_limit").notNull().default(0),
    overBudgetBehavior: text("over_budget_behavior").notNull(),
    warningThresholdPercent: integer("warning_threshold_percent").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    currencyCheck: check("billing_budget_policies_currency_check", sql`${table.currency} = 'usd'`),
    overageCheck: check("billing_budget_policies_overage_check", sql`${table.overageLimitMinor} >= 0`),
    callLimitCheck: check("billing_budget_policies_call_limit_check", sql`${table.callMinuteLimit} >= 0`),
    premiumLimitCheck: check("billing_budget_policies_premium_limit_check", sql`${table.premiumRuntimeMinuteLimit} >= 0`),
    warningCheck: check(
      "billing_budget_policies_warning_check",
      sql`${table.warningThresholdPercent} between 1 and 100`,
    ),
    versionCheck: check("billing_budget_policies_version_check", sql`${table.version} > 0`),
  }),
);

export const billingPlatformRiskLimits = pgTable(
  "billing_platform_risk_limits",
  {
    tenantId: text("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    currency: text("currency").notNull(),
    overageLimitMinor: bigint("overage_limit_minor", { mode: "number" }).notNull().default(0),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => ({
    currencyCheck: check("billing_platform_risk_limits_currency_check", sql`${table.currency} = 'usd'`),
    overageCheck: check("billing_platform_risk_limits_overage_check", sql`${table.overageLimitMinor} >= 0`),
    versionCheck: check("billing_platform_risk_limits_version_check", sql`${table.version} > 0`),
  }),
);

export const billingEntitlements = pgTable(
  "billing_entitlements",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    providerBenefitId: text("provider_benefit_id"),
    key: text("key").notNull(),
    status: text("status").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantKeyUniqueIndex: uniqueIndex("billing_entitlements_tenant_key_unique_idx").on(
      table.tenantId,
      table.key,
    ),
  }),
);

export const billingInvoices = pgTable(
  "billing_invoices",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    providerOrderUniqueIndex: uniqueIndex("billing_invoices_provider_order_unique_idx").on(
      table.providerOrderId,
    ),
    amountCheck: check("billing_invoices_amount_check", sql`${table.amountMinor} >= 0`),
    currencyCheck: check("billing_invoices_currency_check", sql`${table.currency} = 'usd'`),
  }),
);

export const billingAdjustments = pgTable(
  "billing_adjustments",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    kind: text("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    ledgerForeignKey: foreignKey({
      columns: [table.tenantId, table.ledgerEntryId],
      foreignColumns: [billingLedgerEntries.tenantId, billingLedgerEntries.id],
      name: "billing_adjustments_ledger_entry_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    amountCheck: check("billing_adjustments_amount_check", sql`${table.amountMinor} > 0`),
    currencyCheck: check("billing_adjustments_currency_check", sql`${table.currency} = 'usd'`),
  }),
);

export const billingPaygOrders = pgTable(
  "billing_payg_orders",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    currency: text("currency").notNull(),
    paidAmountMinor: bigint("paid_amount_minor", { mode: "number" }).notNull(),
    grantedCreditMinor: bigint("granted_credit_minor", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    providerOrderUniqueIndex: uniqueIndex("billing_payg_orders_provider_order_unique_idx").on(
      table.providerOrderId,
    ),
    paidAmountCheck: check("billing_payg_orders_paid_amount_check", sql`${table.paidAmountMinor} > 0`),
    creditCheck: check("billing_payg_orders_credit_check", sql`${table.grantedCreditMinor} > 0`),
    currencyCheck: check("billing_payg_orders_currency_check", sql`${table.currency} = 'usd'`),
  }),
);

export const billingPaygCreditEntries = pgTable(
  "billing_payg_credit_entries",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    orderId: text("order_id"),
    entryType: text("entry_type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sessionId: text("session_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    orderForeignKey: foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [billingPaygOrders.tenantId, billingPaygOrders.id],
      name: "billing_payg_credit_entries_order_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    tenantIdempotencyUniqueIndex: uniqueIndex(
      "billing_payg_credit_entries_tenant_idempotency_unique_idx",
    ).on(table.tenantId, table.idempotencyKey),
    amountCheck: check("billing_payg_credit_entries_amount_check", sql`${table.amountMinor} > 0`),
  }),
);

export const billingReservationAccounts = pgTable("billing_reservation_accounts", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
  reservedAmountMinor: bigint("reserved_amount_minor", { mode: "number" })
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  reservedAmountCheck: check(
    "billing_reservation_accounts_reserved_amount_check",
    sql`${table.reservedAmountMinor} >= 0`,
  ),
}));

export const billingChargeReservations = pgTable(
  "billing_charge_reservations",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    reservationKey: text("reservation_key").notNull(),
    catalogId: text("catalog_id").references(() => billingPriceCatalogs.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    chargeContext: jsonb("charge_context").$type<PaygCallChargeContext>(),
    fundingSource: text("funding_source").notNull(),
    status: text("status").notNull(),
    reservedAmountMinor: bigint("reserved_amount_minor", { mode: "number" }).notNull(),
    actualAmountMinor: bigint("actual_amount_minor", { mode: "number" }),
    sessionId: text("session_id"),
    terminalOutcome: text("terminal_outcome"),
    currency: text("currency").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantReservationKeyUniqueIndex: uniqueIndex(
      "billing_charge_reservations_tenant_key_unique_idx",
    ).on(table.tenantId, table.reservationKey),
    activeExpiryIndex: index("billing_charge_reservations_status_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    amountCheck: check(
      "billing_charge_reservations_amount_check",
      sql`${table.reservedAmountMinor} > 0`,
    ),
    currencyCheck: check(
      "billing_charge_reservations_currency_check",
      sql`${table.currency} = 'usd'`,
    ),
    fundingSourceCheck: check(
      "billing_charge_reservations_funding_source_check",
      sql`${table.fundingSource} = 'payg_credit'`,
    ),
    statusCheck: check(
      "billing_charge_reservations_status_check",
      sql`${table.status} in ('active', 'expired', 'finalized', 'released')`,
    ),
    actualAmountCheck: check(
      "billing_charge_reservations_actual_amount_check",
      sql`${table.actualAmountMinor} is null or (${table.actualAmountMinor} > 0 and ${table.actualAmountMinor} <= ${table.reservedAmountMinor})`,
    ),
    terminalOutcomeCheck: check(
      "billing_charge_reservations_terminal_outcome_check",
      sql`${table.terminalOutcome} is null or ${table.terminalOutcome} in ('completed', 'transferred', 'failed')`,
    ),
    finalizationCheck: check(
      "billing_charge_reservations_finalization_check",
      sql`(${table.status} = 'finalized' and ${table.actualAmountMinor} is not null and ${table.sessionId} is not null and ${table.finalizedAt} is not null) or (${table.status} <> 'finalized' and ${table.actualAmountMinor} is null and ${table.sessionId} is null and ${table.finalizedAt} is null)`,
    ),
    releaseCheck: check(
      "billing_charge_reservations_release_check",
      sql`(${table.status} = 'released' and ${table.releasedAt} is not null) or (${table.status} <> 'released' and ${table.releasedAt} is null)`,
    ),
    expiryCheck: check(
      "billing_charge_reservations_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
);

export const billingSubscriptionReservationAccounts = pgTable(
  "billing_subscription_reservation_accounts",
  {
    tenantId: text("tenant_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    meterClass: text("meter_class").notNull(),
    reservedIncludedSeconds: bigint("reserved_included_seconds", { mode: "number" }).notNull().default(0),
    reservedOverageMinor: bigint("reserved_overage_minor", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.cycleId, table.meterClass] }),
    cycleForeignKey: foreignKey({ columns: [table.tenantId, table.cycleId], foreignColumns: [billingCycles.tenantId, billingCycles.id], name: "billing_subscription_reservation_accounts_cycle_fk" }).onDelete("cascade").onUpdate("cascade"),
    meterCheck: check("billing_subscription_reservation_accounts_meter_check", sql`${table.meterClass} in ('standard', 'premium')`),
    valuesCheck: check("billing_subscription_reservation_accounts_values_check", sql`${table.reservedIncludedSeconds} >= 0 and ${table.reservedOverageMinor} >= 0`),
  }),
);

export const billingSubscriptionOverageAccounts = pgTable(
  "billing_subscription_overage_accounts",
  {
    tenantId: text("tenant_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    reservedOverageMinor: bigint("reserved_overage_minor", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.cycleId] }),
    cycleForeignKey: foreignKey({ columns: [table.tenantId, table.cycleId], foreignColumns: [billingCycles.tenantId, billingCycles.id], name: "billing_subscription_overage_accounts_cycle_fk" }).onDelete("cascade").onUpdate("cascade"),
    valuesCheck: check("billing_subscription_overage_accounts_values_check", sql`${table.reservedOverageMinor} >= 0`),
  }),
);

export const billingTerminalRecoveryJobs = pgTable(
  "billing_terminal_recovery_jobs",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    callSessionId: text("call_session_id").notNull(),
    reservationId: text("reservation_id").notNull(),
    commercialMode: text("commercial_mode").notNull(),
    usageFact: jsonb("usage_fact").$type<Record<string, unknown>>().notNull(),
    settlementFact: jsonb("settlement_fact").$type<Record<string, unknown>>().notNull(),
    paygAppliedMinor: bigint("payg_applied_minor", { mode: "number" }),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseToken: text("lease_token"),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantIdempotencyUnique: uniqueIndex(
      "billing_terminal_recovery_jobs_tenant_idempotency_unique",
    ).on(table.tenantId, table.idempotencyKey),
    dueIndex: index("billing_terminal_recovery_jobs_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    reservationIndex: index("billing_terminal_recovery_jobs_reservation_idx").on(
      table.tenantId,
      table.commercialMode,
      table.reservationId,
      table.status,
    ),
    modeCheck: check(
      "billing_terminal_recovery_jobs_mode_check",
      sql`${table.commercialMode} in ('payg', 'subscription')`,
    ),
    statusCheck: check(
      "billing_terminal_recovery_jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'completed', 'dead_letter')`,
    ),
    attemptCheck: check(
      "billing_terminal_recovery_jobs_attempt_check",
      sql`${table.attemptCount} >= 0`,
    ),
    paygAppliedCheck: check(
      "billing_terminal_recovery_jobs_payg_applied_check",
      sql`${table.paygAppliedMinor} is null or ${table.paygAppliedMinor} >= 0`,
    ),
    lifecycleCheck: check(
      "billing_terminal_recovery_jobs_lifecycle_check",
      sql`(${table.status} = 'pending' and ${table.leaseExpiresAt} is null and ${table.leaseToken} is null and ${table.completedAt} is null and ${table.deadLetteredAt} is null) or (${table.status} = 'processing' and ${table.leaseExpiresAt} is not null and ${table.leaseToken} is not null and ${table.completedAt} is null and ${table.deadLetteredAt} is null) or (${table.status} = 'completed' and ${table.leaseExpiresAt} is null and ${table.leaseToken} is null and ${table.completedAt} is not null and ${table.deadLetteredAt} is null) or (${table.status} = 'dead_letter' and ${table.leaseExpiresAt} is null and ${table.leaseToken} is null and ${table.completedAt} is null and ${table.deadLetteredAt} is not null)`,
    ),
  }),
);

export const billingSubscriptionCallReservations = pgTable(
  "billing_subscription_call_reservations",
  {
    tenantId: text("tenant_id").notNull(), id: text("id").notNull(), reservationKey: text("reservation_key").notNull(),
    subscriptionId: text("subscription_id").notNull(), cycleId: text("cycle_id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    planSlug: text("plan_slug").notNull(), meterClass: text("meter_class").notNull(), status: text("status").notNull(),
    reservedSeconds: bigint("reserved_seconds", { mode: "number" }).notNull(),
    reservedIncludedSeconds: bigint("reserved_included_seconds", { mode: "number" }).notNull(),
    reservedPaygMinor: bigint("reserved_payg_minor", { mode: "number" }).notNull().default(0),
    reservedOverageMinor: bigint("reserved_overage_minor", { mode: "number" }).notNull(),
    billingMode: text("billing_mode").notNull(), provider: text("provider").notNull(), direction: text("direction").notNull(),
    routeRateId: text("route_rate_id"), routeIdentity: jsonb("route_identity").$type<Record<string, unknown>>(), routeRateMinorPerMinute: bigint("route_rate_minor_per_minute", { mode: "number" }),
    reservedTelephonyMinor: bigint("reserved_telephony_minor", { mode: "number" }).notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), actualSeconds: bigint("actual_seconds", { mode: "number" }),
    actualProviderConnectedSeconds: bigint("actual_provider_connected_seconds", { mode: "number" }),
    sessionId: text("session_id"), finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    terminalOutcome: text("terminal_outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantKeyUnique: uniqueIndex("billing_subscription_call_reservations_tenant_key_unique").on(table.tenantId, table.reservationKey),
    subscriptionForeignKey: foreignKey({ columns: [table.tenantId, table.subscriptionId], foreignColumns: [billingSubscriptions.tenantId, billingSubscriptions.id], name: "billing_subscription_call_reservations_subscription_fk" }).onDelete("restrict").onUpdate("cascade"),
    cycleForeignKey: foreignKey({ columns: [table.tenantId, table.cycleId], foreignColumns: [billingCycles.tenantId, billingCycles.id], name: "billing_subscription_call_reservations_cycle_fk" }).onDelete("restrict").onUpdate("cascade"),
    expiryIndex: index("billing_subscription_call_reservations_expiry_idx").on(table.status, table.expiresAt),
    meterCheck: check("billing_subscription_call_reservations_meter_check", sql`${table.meterClass} in ('standard', 'premium')`),
    modeCheck: check("billing_subscription_call_reservations_mode_check", sql`${table.billingMode} in ('byo', 'platform_managed')`),
    routeCheck: check("billing_subscription_call_reservations_route_check", sql`(${table.billingMode} = 'byo' and ${table.routeRateId} is null and ${table.routeIdentity} is null and ${table.routeRateMinorPerMinute} is null and ${table.reservedTelephonyMinor} = 0) or (${table.billingMode} = 'platform_managed' and ${table.routeRateId} is not null and ${table.routeIdentity} is not null and ${table.routeRateMinorPerMinute} >= 0 and ${table.reservedTelephonyMinor} >= 0)`),
    statusCheck: check("billing_subscription_call_reservations_status_check", sql`${table.status} in ('active', 'expired', 'finalized')`),
    terminalOutcomeCheck: check("billing_subscription_call_reservations_terminal_outcome_check", sql`${table.terminalOutcome} is null or ${table.terminalOutcome} in ('completed', 'transferred', 'failed')`),
    valuesCheck: check("billing_subscription_call_reservations_values_check", sql`${table.reservedSeconds} > 0 and ${table.reservedIncludedSeconds} >= 0 and ${table.reservedIncludedSeconds} <= ${table.reservedSeconds} and ${table.reservedPaygMinor} >= 0 and ${table.reservedOverageMinor} >= 0`),
    actualCheck: check("billing_subscription_call_reservations_actual_check", sql`${table.actualSeconds} is null or (${table.actualSeconds} >= 0 and ${table.actualSeconds} <= ${table.reservedSeconds})`),
  }),
);

export const billingWebhookReceipts = pgTable(
  "billing_webhook_receipts",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status").notNull(),
    error: text("error"),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.provider, table.eventId] }),
    statusReceivedAtIndex: index("billing_webhook_receipts_status_received_at_idx").on(
      table.status,
      table.receivedAt,
    ),
    payloadHashCheck: check(
      "billing_webhook_receipts_payload_hash_check",
      sql`char_length(${table.payloadHash}) = 64 and ${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);

export const billingOutbox = pgTable(
  "billing_outbox",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade", onUpdate: "cascade" }),
    id: text("id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    chargeReleaseId: text("charge_release_id"),
    chargePromotedAt: timestamp("charge_promoted_at", { withTimezone: true }),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    deliveryIndex: index("billing_outbox_delivery_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    attemptCheck: check("billing_outbox_attempt_count_check", sql`${table.attemptCount} >= 0`),
    chargePromotionCheck: check(
      "billing_outbox_charge_promotion_check",
      sql`(${table.chargeReleaseId} is null and ${table.chargePromotedAt} is null)
        or (${table.chargeReleaseId} is not null and ${table.chargePromotedAt} is not null
          and ${table.payload} ->> 'deliveryMode' = 'charge')`,
    ),
  }),
);

export const billingChargeReleaseApprovals = pgTable(
  "billing_charge_release_approvals",
  {
    id: text("id").primaryKey(),
    approvalRole: text("approval_role").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    releaseId: text("release_id").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roleCheck: check(
      "billing_charge_release_approvals_role_check",
      sql`${table.approvalRole} in ('billing', 'security', 'release')`,
    ),
    windowCheck: check(
      "billing_charge_release_approvals_window_check",
      sql`${table.expiresAt} > ${table.approvedAt}`,
    ),
  }),
);

export const billingReleaseCanaryReports = pgTable(
  "billing_release_canary_reports",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    canaryType: text("canary_type").notNull(),
    tenantConsentId: text("tenant_consent_id"),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    releaseId: text("release_id").notNull(),
    result: text("result").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    idempotencyIndex: uniqueIndex("billing_release_canary_reports_tenant_idempotency_unique_idx")
      .on(table.tenantId, table.idempotencyKey),
    typeCheck: check(
      "billing_release_canary_reports_type_check",
      sql`${table.canaryType} in ('internal', 'selected_tenant')`,
    ),
    resultCheck: check(
      "billing_release_canary_reports_result_check",
      sql`${table.result} in ('passed', 'failed')`,
    ),
    consentCheck: check(
      "billing_release_canary_reports_consent_check",
      sql`(${table.canaryType} = 'internal' and ${table.tenantConsentId} is null)
        or (${table.canaryType} = 'selected_tenant' and ${table.tenantConsentId} is not null)`,
    ),
    windowCheck: check(
      "billing_release_canary_reports_window_check",
      sql`${table.validUntil} > ${table.completedAt}`,
    ),
  }),
);

export const billingReleaseDrillReports = pgTable(
  "billing_release_drill_reports",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    schemaVersion: text("schema_version").notNull(),
    releaseId: text("release_id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    catalogVersion: integer("catalog_version").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    drillResults: jsonb("drill_results").$type<Record<string, unknown>>().notNull(),
    alertResults: jsonb("alert_results").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    idempotencyIndex: uniqueIndex("billing_release_drill_reports_tenant_idempotency_unique_idx")
      .on(table.tenantId, table.idempotencyKey),
    statusCheck: check(
      "billing_release_drill_reports_status_check",
      sql`${table.status} in ('passed', 'failed')`,
    ),
    catalogVersionCheck: check(
      "billing_release_drill_reports_catalog_version_check",
      sql`${table.catalogVersion} > 0`,
    ),
    windowCheck: check(
      "billing_release_drill_reports_window_check",
      sql`${table.validUntil} > ${table.executedAt}`,
    ),
  }),
);

export const billingReconciliationReports = pgTable(
  "billing_reconciliation_reports",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    runKey: text("run_key").notNull(),
    releaseId: text("release_id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    cycleStartsAt: timestamp("cycle_starts_at", { withTimezone: true }).notNull(),
    cycleEndsAt: timestamp("cycle_ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    mismatchCount: integer("mismatch_count").notNull(),
    evidenceId: text("evidence_id").notNull(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    runIndex: index("billing_reconciliation_reports_tenant_run_idx")
      .on(table.tenantId, table.runKey),
    evidenceUniqueIndex: uniqueIndex("billing_reconciliation_reports_tenant_evidence_unique_idx")
      .on(table.tenantId, table.evidenceId),
    statusCreatedIndex: index("billing_reconciliation_reports_status_created_idx")
      .on(table.status, table.createdAt),
    tenantCycleIndex: index("billing_reconciliation_reports_tenant_cycle_idx")
      .on(table.tenantId, table.cycleStartsAt),
    statusCheck: check(
      "billing_reconciliation_reports_status_check",
      sql`${table.status} in ('matched', 'mismatch')`,
    ),
    mismatchCheck: check(
      "billing_reconciliation_reports_mismatch_count_check",
      sql`${table.mismatchCount} >= 0`,
    ),
    cycleCheck: check(
      "billing_reconciliation_reports_cycle_check",
      sql`${table.cycleEndsAt} > ${table.cycleStartsAt}`,
    ),
    freshnessCheck: check(
      "billing_reconciliation_reports_freshness_check",
      sql`${table.validUntil} > ${table.createdAt}`,
    ),
  }),
);

export const billingChargePromotionRecords = pgTable(
  "billing_charge_promotion_records",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    outboxId: text("outbox_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    releaseId: text("release_id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    reason: text("reason").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    outboxUniqueIndex: uniqueIndex("billing_charge_promotion_records_tenant_outbox_unique_idx")
      .on(table.tenantId, table.outboxId),
    outboxForeignKey: foreignKey({
      columns: [table.tenantId, table.outboxId],
      foreignColumns: [billingOutbox.tenantId, billingOutbox.id],
      name: "billing_charge_promotion_records_outbox_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    ledgerForeignKey: foreignKey({
      columns: [table.tenantId, table.ledgerEntryId],
      foreignColumns: [billingLedgerEntries.tenantId, billingLedgerEntries.id],
      name: "billing_charge_promotion_records_ledger_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    actorRoleCheck: check(
      "billing_charge_promotion_records_actor_role_check",
      sql`${table.actorRole} = 'billing_owner'`,
    ),
  }),
);

export const billingProviderTenantScopes = pgTable(
  "billing_provider_tenant_scopes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    provider: text("provider").notNull(),
    externalScopeId: text("external_scope_id").notNull(),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantProviderEffectiveUniqueIndex: uniqueIndex(
      "billing_provider_tenant_scopes_tenant_provider_effective_unique_idx",
    ).on(table.tenantId, table.provider, table.effectiveFrom),
    tenantProviderIndex: index("billing_provider_tenant_scopes_tenant_provider_idx")
      .on(table.tenantId, table.provider, table.effectiveFrom),
    providerCheck: check(
      "billing_provider_tenant_scopes_provider_check",
      sql`${table.provider} in ('cartesia', 'openai', 'gemini')`,
    ),
    intervalCheck: check(
      "billing_provider_tenant_scopes_interval_check",
      sql`${table.effectiveUntil} is null or ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
    externalScopeCheck: check(
      "billing_provider_tenant_scopes_external_scope_check",
      sql`${table.externalScopeId} = btrim(${table.externalScopeId}) and length(${table.externalScopeId}) > 0`,
    ),
  }),
);

export const billingProviderEvidenceReports = pgTable(
  "billing_provider_evidence_reports",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    provider: text("provider").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    sourceReportId: text("source_report_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    cycleStartsAt: timestamp("cycle_starts_at", { withTimezone: true }).notNull(),
    cycleEndsAt: timestamp("cycle_ends_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    tenantCatalogCycleProviderSourceUniqueIndex: uniqueIndex(
      "billing_provider_evidence_reports_tenant_catalog_cycle_provider_source_unique_idx",
    ).on(
      table.tenantId,
      table.catalogId,
      table.cycleStartsAt,
      table.cycleEndsAt,
      table.provider,
      table.sourceReportId,
    ),
    tenantCycleIndex: index("billing_provider_evidence_reports_tenant_cycle_idx")
      .on(table.tenantId, table.cycleStartsAt, table.cycleEndsAt),
    kindCheck: check(
      "billing_provider_evidence_reports_kind_check",
      sql`${table.evidenceKind} in ('telephony_usage', 'runtime_usage')`,
    ),
    sourceHashCheck: check(
      "billing_provider_evidence_reports_source_hash_check",
      sql`length(${table.sourceHash}) = 64`,
    ),
    cycleCheck: check(
      "billing_provider_evidence_reports_cycle_check",
      sql`${table.cycleEndsAt} > ${table.cycleStartsAt}`,
    ),
    fetchedCheck: check(
      "billing_provider_evidence_reports_fetched_check",
      sql`${table.fetchedAt} >= ${table.cycleEndsAt}`,
    ),
  }),
);

export const billingReleaseDrillExecutionRecords = pgTable(
  "billing_release_drill_execution_records",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    runId: text("run_id").notNull(),
    releaseId: text("release_id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    drillId: text("drill_id").notNull(),
    actorId: text("actor_id").notNull(),
    preState: jsonb("pre_state").$type<Record<string, unknown>>().notNull(),
    postState: jsonb("post_state").$type<Record<string, unknown>>().notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    runDrillUniqueIndex: uniqueIndex(
      "billing_release_drill_execution_records_tenant_run_drill_unique_idx",
    ).on(table.tenantId, table.runId, table.drillId),
    drillCheck: check(
      "billing_release_drill_execution_records_drill_check",
      sql`${table.drillId} in (
        'zero_balance_stop', 'invoice_dispute', 'rollback', 'charge_stop', 'release_signals'
      )`,
    ),
    actorCheck: check(
      "billing_release_drill_execution_records_actor_check",
      sql`length(trim(${table.actorId})) > 0`,
    ),
  }),
);

function billingChargeReleaseControlEnvironmentColumn() {
  return billingChargeReleaseControls.environment;
}

export const billingReleaseDrillOperationEvidence = pgTable(
  "billing_release_drill_operation_evidence",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, {
      onDelete: "cascade", onUpdate: "cascade",
    }),
    id: text("id").notNull(),
    runId: text("run_id").notNull(),
    releaseId: text("release_id").notNull(),
    catalogId: text("catalog_id").notNull().references(() => billingPriceCatalogs.id, {
      onDelete: "restrict", onUpdate: "cascade",
    }),
    drillId: text("drill_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    paygOrderId: text("payg_order_id"),
    paygCreditEntryId: text("payg_credit_entry_id"),
    reservationId: text("reservation_id"),
    outboxId: text("outbox_id"),
    adjustmentId: text("adjustment_id"),
    ledgerEntryId: text("ledger_entry_id"),
    auditLogId: text("audit_log_id"),
    reconciliationReportId: text("reconciliation_report_id"),
    releaseControlEnvironment: text("release_control_environment"),
    executionRecordId: text("execution_record_id"),
    evidenceHash: text("evidence_hash").notNull(),
    operationRecordIds: jsonb("operation_record_ids").$type<string[]>().notNull(),
    observedResult: jsonb("observed_result").$type<Record<string, unknown>>().notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tenantId, table.id] }),
    runDrillUniqueIndex: uniqueIndex(
      "billing_release_drill_operation_evidence_tenant_run_drill_unique_idx",
    ).on(table.tenantId, table.runId, table.drillId),
    paygOrderForeignKey: foreignKey({
      columns: [table.tenantId, table.paygOrderId],
      foreignColumns: [billingPaygOrders.tenantId, billingPaygOrders.id],
      name: "billing_release_drill_operation_evidence_payg_order_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    paygCreditEntryForeignKey: foreignKey({
      columns: [table.tenantId, table.paygCreditEntryId],
      foreignColumns: [billingPaygCreditEntries.tenantId, billingPaygCreditEntries.id],
      name: "billing_release_drill_operation_evidence_payg_credit_entry_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    reservationForeignKey: foreignKey({
      columns: [table.tenantId, table.reservationId],
      foreignColumns: [billingChargeReservations.tenantId, billingChargeReservations.id],
      name: "billing_release_drill_operation_evidence_reservation_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    outboxForeignKey: foreignKey({
      columns: [table.tenantId, table.outboxId],
      foreignColumns: [billingOutbox.tenantId, billingOutbox.id],
      name: "billing_release_drill_operation_evidence_outbox_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    adjustmentForeignKey: foreignKey({
      columns: [table.tenantId, table.adjustmentId],
      foreignColumns: [billingAdjustments.tenantId, billingAdjustments.id],
      name: "billing_release_drill_operation_evidence_adjustment_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    ledgerEntryForeignKey: foreignKey({
      columns: [table.tenantId, table.ledgerEntryId],
      foreignColumns: [billingLedgerEntries.tenantId, billingLedgerEntries.id],
      name: "billing_release_drill_operation_evidence_ledger_entry_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    auditLogForeignKey: foreignKey({
      columns: [table.tenantId, table.auditLogId],
      foreignColumns: [auditLogs.tenantId, auditLogs.id],
      name: "billing_release_drill_operation_evidence_audit_log_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    reconciliationForeignKey: foreignKey({
      columns: [table.tenantId, table.reconciliationReportId],
      foreignColumns: [billingReconciliationReports.tenantId, billingReconciliationReports.id],
      name: "billing_release_drill_operation_evidence_reconciliation_report_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    releaseControlForeignKey: foreignKey({
      columns: [table.releaseControlEnvironment],
      foreignColumns: [billingChargeReleaseControlEnvironmentColumn()],
      name: "billing_release_drill_operation_evidence_release_control_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    executionRecordForeignKey: foreignKey({
      columns: [table.tenantId, table.executionRecordId],
      foreignColumns: [
        billingReleaseDrillExecutionRecords.tenantId,
        billingReleaseDrillExecutionRecords.id,
      ],
      name: "billing_release_drill_operation_evidence_execution_record_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    hashCheck: check(
      "billing_release_drill_operation_evidence_hash_check",
      sql`length(${table.evidenceHash}) = 64`,
    ),
    sourceIntegrityCheck: check(
      "billing_release_drill_operation_evidence_source_integrity_check",
      sql`(
        ${table.drillId} = 'top_up'
        and ${table.sourceType} = 'payg_order'
        and ${table.sourceRecordId} = ${table.paygOrderId}
        and ${table.paygCreditEntryId} is null and ${table.reservationId} is null
        and ${table.outboxId} is null and ${table.adjustmentId} is null
        and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} = 'paid_grant'
        and ${table.sourceType} = 'payg_credit_entry'
        and ${table.sourceRecordId} = ${table.paygCreditEntryId}
        and ${table.paygOrderId} is null and ${table.reservationId} is null
        and ${table.outboxId} is null and ${table.adjustmentId} is null
        and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} = 'reservation'
        and ${table.sourceType} = 'reservation'
        and ${table.sourceRecordId} = ${table.reservationId}
        and ${table.paygOrderId} is null and ${table.paygCreditEntryId} is null
        and ${table.outboxId} is null and ${table.adjustmentId} is null
        and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} = 'debit_finalization'
        and ${table.sourceType} = 'reservation'
        and ${table.sourceRecordId} = ${table.reservationId}
        and ${table.paygOrderId} is null and ${table.paygCreditEntryId} is not null
        and ${table.outboxId} is null and ${table.adjustmentId} is null
        and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} = 'refund_reversal'
        and ${table.sourceType} = 'payg_credit_entry'
        and ${table.sourceRecordId} = ${table.paygCreditEntryId}
        and ${table.paygOrderId} is not null and ${table.reservationId} is null
        and ${table.outboxId} is null and ${table.adjustmentId} is null
        and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} in ('zero_balance_stop', 'invoice_dispute', 'rollback', 'release_signals')
        and ${table.sourceType} = 'execution_record'
        and ${table.sourceRecordId} = ${table.executionRecordId}
        and ${table.paygOrderId} is null and ${table.paygCreditEntryId} is null
        and ${table.reservationId} is null and ${table.outboxId} is null
        and ${table.adjustmentId} is null and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null
      ) or (
        ${table.drillId} in ('duplicate_event', 'late_event')
        and ${table.sourceType} = 'reconciliation_report'
        and ${table.sourceRecordId} = ${table.reconciliationReportId}
        and ${table.paygOrderId} is null and ${table.paygCreditEntryId} is null
        and ${table.reservationId} is null and ${table.outboxId} is null
        and ${table.adjustmentId} is null and ${table.releaseControlEnvironment} is null
        and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} = 'adjustment'
        and ${table.sourceType} = 'adjustment'
        and ${table.sourceRecordId} = ${table.adjustmentId}
        and ${table.paygOrderId} is null and ${table.paygCreditEntryId} is null
        and ${table.reservationId} is null and ${table.outboxId} is null
        and ${table.reconciliationReportId} is null
        and ${table.releaseControlEnvironment} is null and ${table.executionRecordId} is null
      ) or (
        ${table.drillId} = 'charge_stop'
        and ${table.sourceType} = 'execution_record'
        and ${table.sourceRecordId} = ${table.executionRecordId}
        and ${table.releaseControlEnvironment} is not null
        and ${table.paygOrderId} is null and ${table.paygCreditEntryId} is null
        and ${table.reservationId} is null and ${table.outboxId} is null
        and ${table.adjustmentId} is null and ${table.reconciliationReportId} is null
      )`,
    ),
    adjustmentSourceIntegrityCheck: check(
      "billing_release_drill_operation_evidence_adjustment_source_integrity_check",
      sql`(${table.drillId} = 'adjustment'
          and ${table.ledgerEntryId} is not null and ${table.auditLogId} is not null)
        or (${table.drillId} <> 'adjustment'
          and ${table.ledgerEntryId} is null and ${table.auditLogId} is null)`,
    ),
  }),
);

export const billingPolarMappings = pgTable(
  "billing_polar_mappings",
  {
    id: text("id").primaryKey(),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => billingPriceCatalogs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    mappingType: text("mapping_type").notNull(),
    internalKey: text("internal_key").notNull(),
    providerId: text("provider_id").notNull(),
    environment: text("environment").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    catalogMappingUniqueIndex: uniqueIndex("billing_polar_mappings_catalog_key_unique_idx").on(
      table.catalogId,
      table.mappingType,
      table.internalKey,
      table.environment,
    ),
    providerEnvironmentUniqueIndex: uniqueIndex(
      "billing_polar_mappings_provider_environment_unique_idx",
    ).on(table.providerId, table.environment),
  }),
);

export const billingChargeReleaseControls = pgTable(
  "billing_charge_release_controls",
  {
    environment: text("environment").primaryKey(),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => billingPriceCatalogs.id, { onDelete: "restrict", onUpdate: "cascade" }),
    releaseId: text("release_id").notNull(),
    approvalId: text("approval_id").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }).notNull(),
    internalCanaryCompletedAt: timestamp("internal_canary_completed_at", { withTimezone: true }).notNull(),
    internalCanaryExpiresAt: timestamp("internal_canary_expires_at", { withTimezone: true }).notNull(),
    selectedTenantCanaryCompletedAt: timestamp("selected_tenant_canary_completed_at", { withTimezone: true }).notNull(),
    selectedTenantCanaryExpiresAt: timestamp("selected_tenant_canary_expires_at", { withTimezone: true }).notNull(),
    reconciliationCompletedAt: timestamp("reconciliation_completed_at", { withTimezone: true }).notNull(),
    reconciliationExpiresAt: timestamp("reconciliation_expires_at", { withTimezone: true }).notNull(),
    drillsCompletedAt: timestamp("drills_completed_at", { withTimezone: true }).notNull(),
    drillsExpiresAt: timestamp("drills_expires_at", { withTimezone: true }).notNull(),
    billingApprovalId: text("billing_approval_id").notNull().references(
      () => billingChargeReleaseApprovals.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    securityApprovalId: text("security_approval_id").notNull().references(
      () => billingChargeReleaseApprovals.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    releaseApprovalId: text("release_approval_id").notNull().references(
      () => billingChargeReleaseApprovals.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    internalCanaryTenantId: text("internal_canary_tenant_id").notNull(),
    internalCanaryEvidenceId: text("internal_canary_evidence_id").notNull(),
    selectedTenantId: text("selected_tenant_id").notNull(),
    selectedTenantCanaryEvidenceId: text("selected_tenant_canary_evidence_id").notNull(),
    reconciliationTenantId: text("reconciliation_tenant_id").notNull(),
    reconciliationEvidenceId: text("reconciliation_evidence_id").notNull(),
    drillTenantId: text("drill_tenant_id").notNull(),
    drillEvidenceId: text("drill_evidence_id").notNull(),
    deliveryStopped: boolean("delivery_stopped").notNull().default(true),
    stopReason: text("stop_reason"),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    productionOnlyCheck: check(
      "billing_charge_release_controls_production_only_check",
      sql`${table.environment} = 'production'`,
    ),
    approvalWindowCheck: check(
      "billing_charge_release_controls_approval_window_check",
      sql`${table.approvalExpiresAt} > ${table.approvedAt}`,
    ),
    internalCanaryWindowCheck: check(
      "billing_charge_release_controls_internal_canary_window_check",
      sql`${table.internalCanaryExpiresAt} > ${table.internalCanaryCompletedAt}`,
    ),
    selectedTenantCanaryWindowCheck: check(
      "billing_charge_release_controls_selected_tenant_canary_window_check",
      sql`${table.selectedTenantCanaryExpiresAt} > ${table.selectedTenantCanaryCompletedAt}`,
    ),
    reconciliationWindowCheck: check(
      "billing_charge_release_controls_reconciliation_window_check",
      sql`${table.reconciliationExpiresAt} > ${table.reconciliationCompletedAt}`,
    ),
    drillsWindowCheck: check(
      "billing_charge_release_controls_drills_window_check",
      sql`${table.drillsExpiresAt} > ${table.drillsCompletedAt}`,
    ),
    stopReasonCheck: check(
      "billing_charge_release_controls_stop_reason_check",
      sql`(${table.deliveryStopped} = false and ${table.stopReason} is null and ${table.stoppedAt} is null)
        or (${table.deliveryStopped} = true and ${table.stopReason} is not null and ${table.stoppedAt} is not null)`,
    ),
    internalCanaryForeignKey: foreignKey({
      columns: [table.internalCanaryTenantId, table.internalCanaryEvidenceId],
      foreignColumns: [billingReleaseCanaryReports.tenantId, billingReleaseCanaryReports.id],
      name: "billing_charge_release_controls_internal_canary_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    selectedTenantCanaryForeignKey: foreignKey({
      columns: [table.selectedTenantId, table.selectedTenantCanaryEvidenceId],
      foreignColumns: [billingReleaseCanaryReports.tenantId, billingReleaseCanaryReports.id],
      name: "billing_charge_release_controls_selected_canary_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    reconciliationForeignKey: foreignKey({
      columns: [table.reconciliationTenantId, table.reconciliationEvidenceId],
      foreignColumns: [billingReconciliationReports.tenantId, billingReconciliationReports.id],
      name: "billing_charge_release_controls_reconciliation_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    drillForeignKey: foreignKey({
      columns: [table.drillTenantId, table.drillEvidenceId],
      foreignColumns: [billingReleaseDrillReports.tenantId, billingReleaseDrillReports.id],
      name: "billing_charge_release_controls_drill_fk",
    }).onDelete("restrict").onUpdate("cascade"),
  }),
);
