import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", ["active", "suspended", "archived"]);

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
