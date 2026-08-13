CREATE TABLE "billing_charge_release_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_role" text NOT NULL,
	"catalog_id" text NOT NULL,
	"release_id" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_charge_release_approvals_role_check" CHECK ("billing_charge_release_approvals"."approval_role" in ('billing', 'security', 'release')),
	CONSTRAINT "billing_charge_release_approvals_window_check" CHECK ("billing_charge_release_approvals"."expires_at" > "billing_charge_release_approvals"."approved_at")
);
--> statement-breakpoint
CREATE TABLE "billing_reconciliation_reports" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"run_key" text NOT NULL,
	"release_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"cycle_starts_at" timestamp with time zone NOT NULL,
	"cycle_ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"mismatch_count" integer NOT NULL,
	"evidence_id" text NOT NULL,
	"report" jsonb NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reconciliation_reports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_reconciliation_reports_status_check" CHECK ("billing_reconciliation_reports"."status" in ('matched', 'mismatch')),
	CONSTRAINT "billing_reconciliation_reports_mismatch_count_check" CHECK ("billing_reconciliation_reports"."mismatch_count" >= 0),
	CONSTRAINT "billing_reconciliation_reports_cycle_check" CHECK ("billing_reconciliation_reports"."cycle_ends_at" > "billing_reconciliation_reports"."cycle_starts_at"),
	CONSTRAINT "billing_reconciliation_reports_freshness_check" CHECK ("billing_reconciliation_reports"."valid_until" > "billing_reconciliation_reports"."created_at")
);
--> statement-breakpoint
CREATE TABLE "billing_release_canary_reports" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"canary_type" text NOT NULL,
	"tenant_consent_id" text,
	"catalog_id" text NOT NULL,
	"release_id" text NOT NULL,
	"result" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_release_canary_reports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_release_canary_reports_type_check" CHECK ("billing_release_canary_reports"."canary_type" in ('internal', 'selected_tenant')),
	CONSTRAINT "billing_release_canary_reports_result_check" CHECK ("billing_release_canary_reports"."result" in ('passed', 'failed')),
	CONSTRAINT "billing_release_canary_reports_consent_check" CHECK (("billing_release_canary_reports"."canary_type" = 'internal' and "billing_release_canary_reports"."tenant_consent_id" is null)
        or ("billing_release_canary_reports"."canary_type" = 'selected_tenant' and "billing_release_canary_reports"."tenant_consent_id" is not null)),
	CONSTRAINT "billing_release_canary_reports_window_check" CHECK ("billing_release_canary_reports"."valid_until" > "billing_release_canary_reports"."completed_at")
);
--> statement-breakpoint
CREATE TABLE "billing_release_drill_reports" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"release_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_version" integer NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"drill_results" jsonb NOT NULL,
	"alert_results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_release_drill_reports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_release_drill_reports_status_check" CHECK ("billing_release_drill_reports"."status" in ('passed', 'failed')),
	CONSTRAINT "billing_release_drill_reports_catalog_version_check" CHECK ("billing_release_drill_reports"."catalog_version" > 0),
	CONSTRAINT "billing_release_drill_reports_window_check" CHECK ("billing_release_drill_reports"."valid_until" > "billing_release_drill_reports"."executed_at")
);
--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "billing_approval_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "security_approval_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "release_approval_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "internal_canary_tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "internal_canary_evidence_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "selected_tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "selected_tenant_canary_evidence_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "reconciliation_tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "reconciliation_evidence_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "drill_tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD COLUMN "drill_evidence_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_outbox" ADD COLUMN "charge_release_id" text;--> statement-breakpoint
ALTER TABLE "billing_outbox" ADD COLUMN "charge_promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_charge_release_approvals" ADD CONSTRAINT "billing_charge_release_approvals_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_reports" ADD CONSTRAINT "billing_reconciliation_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_reports" ADD CONSTRAINT "billing_reconciliation_reports_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_canary_reports" ADD CONSTRAINT "billing_release_canary_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_canary_reports" ADD CONSTRAINT "billing_release_canary_reports_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_reports" ADD CONSTRAINT "billing_release_drill_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_reports" ADD CONSTRAINT "billing_release_drill_reports_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "billing_reconciliation_reports_tenant_run_idx" ON "billing_reconciliation_reports" USING btree ("tenant_id","run_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_reconciliation_reports_tenant_evidence_unique_idx" ON "billing_reconciliation_reports" USING btree ("tenant_id","evidence_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_reports_status_created_idx" ON "billing_reconciliation_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_reports_tenant_cycle_idx" ON "billing_reconciliation_reports" USING btree ("tenant_id","cycle_starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_release_canary_reports_tenant_idempotency_unique_idx" ON "billing_release_canary_reports" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_release_drill_reports_tenant_idempotency_unique_idx" ON "billing_release_drill_reports" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_billing_approval_id_billing_charge_release_approvals_id_fk" FOREIGN KEY ("billing_approval_id") REFERENCES "public"."billing_charge_release_approvals"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_security_approval_id_billing_charge_release_approvals_id_fk" FOREIGN KEY ("security_approval_id") REFERENCES "public"."billing_charge_release_approvals"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_release_approval_id_billing_charge_release_approvals_id_fk" FOREIGN KEY ("release_approval_id") REFERENCES "public"."billing_charge_release_approvals"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_internal_canary_fk" FOREIGN KEY ("internal_canary_tenant_id","internal_canary_evidence_id") REFERENCES "public"."billing_release_canary_reports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_selected_canary_fk" FOREIGN KEY ("selected_tenant_id","selected_tenant_canary_evidence_id") REFERENCES "public"."billing_release_canary_reports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_reconciliation_fk" FOREIGN KEY ("reconciliation_tenant_id","reconciliation_evidence_id") REFERENCES "public"."billing_reconciliation_reports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_drill_fk" FOREIGN KEY ("drill_tenant_id","drill_evidence_id") REFERENCES "public"."billing_release_drill_reports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_outbox" ADD CONSTRAINT "billing_outbox_charge_promotion_check" CHECK (("billing_outbox"."charge_release_id" is null and "billing_outbox"."charge_promoted_at" is null)
        or ("billing_outbox"."charge_release_id" is not null and "billing_outbox"."charge_promoted_at" is not null
          and "billing_outbox"."payload" ->> 'deliveryMode' = 'charge'));--> statement-breakpoint
CREATE TRIGGER billing_charge_release_approvals_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_charge_release_approvals"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER billing_reconciliation_reports_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_reconciliation_reports"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER billing_release_canary_reports_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_release_canary_reports"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER billing_release_drill_reports_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_release_drill_reports"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
