CREATE TABLE "billing_charge_promotion_records" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"outbox_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"release_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"reason" text NOT NULL,
	"promoted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_charge_promotion_records_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_charge_promotion_records_actor_role_check" CHECK ("billing_charge_promotion_records"."actor_role" = 'billing_owner')
);
--> statement-breakpoint
CREATE TABLE "billing_release_drill_operation_evidence" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"run_id" text NOT NULL,
	"release_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"drill_id" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"operation_record_ids" jsonb NOT NULL,
	"observed_result" jsonb NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_release_drill_operation_evidence_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_release_drill_operation_evidence_hash_check" CHECK (length("billing_release_drill_operation_evidence"."evidence_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "billing_charge_promotion_records" ADD CONSTRAINT "billing_charge_promotion_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_promotion_records" ADD CONSTRAINT "billing_charge_promotion_records_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_promotion_records" ADD CONSTRAINT "billing_charge_promotion_records_outbox_fk" FOREIGN KEY ("tenant_id","outbox_id") REFERENCES "public"."billing_outbox"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_charge_promotion_records" ADD CONSTRAINT "billing_charge_promotion_records_ledger_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."billing_ledger_entries"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charge_promotion_records_tenant_outbox_unique_idx" ON "billing_charge_promotion_records" USING btree ("tenant_id","outbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_release_drill_operation_evidence_tenant_run_drill_unique_idx" ON "billing_release_drill_operation_evidence" USING btree ("tenant_id","run_id","drill_id");--> statement-breakpoint
CREATE TRIGGER billing_charge_promotion_records_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_charge_promotion_records"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER billing_release_drill_operation_evidence_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_release_drill_operation_evidence"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
