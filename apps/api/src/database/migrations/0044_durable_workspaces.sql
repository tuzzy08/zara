CREATE TABLE "workspace_audit_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_membership_history" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "workspace_membership_history_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_tenant_id_workspace_id_user_id_pk" PRIMARY KEY("tenant_id","workspace_id","user_id"),
	CONSTRAINT "workspace_memberships_role_check" CHECK ("workspace_memberships"."role" in ('owner', 'admin', 'builder', 'operator', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "workspaces_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "workspaces_status_check" CHECK ("workspaces"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "workspace_audit_entries" ADD CONSTRAINT "workspace_audit_entries_tenant_id_workspace_id_workspaces_tenant_id_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership_history" ADD CONSTRAINT "workspace_membership_history_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership_history" ADD CONSTRAINT "workspace_membership_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_tenant_id_workspace_id_workspaces_tenant_id_id_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_tenant_id_member_userId_organizationId_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."member"("userId","organizationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_audit_entries_tenant_sequence_idx" ON "workspace_audit_entries" USING btree ("tenant_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_tenant_slug_unique" ON "workspaces" USING btree ("tenant_id","slug");