CREATE TABLE "pstn_capacity_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pstn_capacity_policy_singleton_check" CHECK ("pstn_capacity_policy"."id" = 'global'),
	CONSTRAINT "pstn_capacity_policy_version_check" CHECK ("pstn_capacity_policy"."version" > 0),
	CONSTRAINT "pstn_capacity_policy_object_check" CHECK (jsonb_typeof("pstn_capacity_policy"."policy") = 'object')
);
--> statement-breakpoint
CREATE TABLE "pstn_capacity_policy_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_version" integer NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"before_policy" jsonb NOT NULL,
	"after_policy" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pstn_capacity_policy_audit_policy_version_unique" UNIQUE("policy_version"),
	CONSTRAINT "pstn_capacity_policy_audit_reason_check" CHECK (char_length(btrim("pstn_capacity_policy_audit"."reason")) >= 3),
	CONSTRAINT "pstn_capacity_policy_audit_before_object_check" CHECK (jsonb_typeof("pstn_capacity_policy_audit"."before_policy") = 'object'),
	CONSTRAINT "pstn_capacity_policy_audit_after_object_check" CHECK (jsonb_typeof("pstn_capacity_policy_audit"."after_policy") = 'object')
);
--> statement-breakpoint
CREATE TABLE "pstn_capacity_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pstn_capacity_rejections" ADD CONSTRAINT "pstn_capacity_rejections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pstn_capacity_policy_audit_occurred_at_idx" ON "pstn_capacity_policy_audit" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "pstn_capacity_rejections_tenant_occurred_at_idx" ON "pstn_capacity_rejections" USING btree ("tenant_id","occurred_at");