import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  EncryptedCredentialReference,
  ImportedTelephonyPhoneNumber,
  OutboundCallPolicyChecks,
  SipTrunkMetadata,
  TelephonyCallControlEvent,
  TelephonyConnection,
  TelephonyExecutionSession,
  TelephonyProviderHeartbeat,
  TelephonyRecordingPolicy,
} from "@zara/core";

import type {
  TelephonyDispatchRecord,
  TelephonyHealthCheck,
} from "../telephony/telephony.models";
import type { EncryptedTelephonySecretEnvelope } from "../telephony/telephony-secret-vault";

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
  },
  (table) => ({
    organizationEmailIndex: index("auth_invitation_organization_email_idx").on(
      table.organizationId,
      table.email,
    ),
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
    id: text("id").primaryKey(),
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
    testRouteSessionId: text("test_route_session_id"),
    outageMode: text("outage_mode").$type<TelephonyDispatchRecord["outageMode"] | null>(),
    recording: jsonb("recording").$type<TelephonyRecordingPolicy>().notNull(),
    toPhoneNumber: text("to_phone_number").notNull(),
    fromPhoneNumber: text("from_phone_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    source: text("source").$type<TelephonyDispatchRecord["source"]>().notNull(),
    policyChecks: jsonb("policy_checks").$type<OutboundCallPolicyChecks | null>(),
  },
  (table) => ({
    tenantCreatedAtIndex: index("telephony_dispatches_tenant_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    callSessionIndex: index("telephony_dispatches_call_session_idx").on(table.callSessionId),
  }),
);

export const telephonyExecutionSessions = pgTable(
  "telephony_execution_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => telephonyDispatches.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
    diagnostics: jsonb("diagnostics").$type<string[]>().notNull(),
    policyState: jsonb("policy_state").$type<TelephonyExecutionSession["policyState"] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    tenantUpdatedAtIndex: index("telephony_execution_sessions_tenant_updated_at_idx").on(
      table.tenantId,
      table.updatedAt,
    ),
    callSessionUniqueIndex: uniqueIndex("telephony_execution_sessions_call_session_unique_idx").on(
      table.callSessionId,
    ),
  }),
);

export const telephonyExecutionCommands = pgTable(
  "telephony_execution_commands",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sessionId: text("session_id")
      .notNull()
      .references(() => telephonyExecutionSessions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
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
    sessionRequestedAtIndex: index("telephony_execution_commands_session_requested_at_idx").on(
      table.sessionId,
      table.requestedAt,
    ),
  }),
);

export const telephonyWebhookEvents = pgTable(
  "telephony_webhook_events",
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
    accountSid: text("account_sid").notNull(),
    callSid: text("call_sid").notNull(),
    eventSid: text("event_sid").notNull(),
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    duplicate: boolean("duplicate").notNull(),
  },
  (table) => ({
    tenantEventSidIndex: uniqueIndex("telephony_webhook_events_tenant_event_sid_unique_idx").on(
      table.tenantId,
      table.eventSid,
    ),
  }),
);

export const telephonyCallControlEvents = pgTable(
  "telephony_call_control_events",
  {
    id: text("id").primaryKey(),
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

export const telephonyProcessedWebhookEvents = pgTable(
  "telephony_processed_webhook_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    eventSid: text("event_sid").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEventSidIndex: uniqueIndex(
      "telephony_processed_webhook_events_tenant_event_sid_unique_idx",
    ).on(table.tenantId, table.eventSid),
  }),
);
