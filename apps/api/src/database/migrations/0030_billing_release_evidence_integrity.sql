DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_release_drill_operation_evidence) THEN
    RAISE EXCEPTION 'Migration 0030 blocked: pre-0030 drill operation evidence exists. Preserve and migrate that evidence before retrying.';
  END IF;
END
$$;--> statement-breakpoint
CREATE TABLE "billing_provider_evidence_reports" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"provider" text NOT NULL,
	"evidence_kind" text NOT NULL,
	"source_report_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"cycle_starts_at" timestamp with time zone NOT NULL,
	"cycle_ends_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_provider_evidence_reports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_provider_evidence_reports_kind_check" CHECK ("billing_provider_evidence_reports"."evidence_kind" in ('telephony_usage', 'runtime_usage')),
	CONSTRAINT "billing_provider_evidence_reports_source_hash_check" CHECK (length("billing_provider_evidence_reports"."source_hash") = 64),
	CONSTRAINT "billing_provider_evidence_reports_cycle_check" CHECK ("billing_provider_evidence_reports"."cycle_ends_at" > "billing_provider_evidence_reports"."cycle_starts_at"),
	CONSTRAINT "billing_provider_evidence_reports_fetched_check" CHECK ("billing_provider_evidence_reports"."fetched_at" >= "billing_provider_evidence_reports"."cycle_ends_at")
);
--> statement-breakpoint
CREATE TABLE "billing_release_drill_execution_records" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"run_id" text NOT NULL,
	"release_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"drill_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"pre_state" jsonb NOT NULL,
	"post_state" jsonb NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_release_drill_execution_records_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_release_drill_execution_records_drill_check" CHECK ("billing_release_drill_execution_records"."drill_id" in (
        'zero_balance_stop', 'invoice_dispute', 'rollback', 'charge_stop', 'release_signals'
      )),
	CONSTRAINT "billing_release_drill_execution_records_actor_check" CHECK (length(trim("billing_release_drill_execution_records"."actor_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "source_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "source_record_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "payg_order_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "payg_credit_entry_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "reservation_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "outbox_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "adjustment_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "reconciliation_report_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "release_control_environment" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "execution_record_id" text;--> statement-breakpoint
ALTER TABLE "billing_provider_evidence_reports" ADD CONSTRAINT "billing_provider_evidence_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_execution_records" ADD CONSTRAINT "billing_release_drill_execution_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_execution_records" ADD CONSTRAINT "billing_release_drill_execution_records_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_evidence_reports_provider_source_unique_idx" ON "billing_provider_evidence_reports" USING btree ("provider","source_report_id");--> statement-breakpoint
CREATE INDEX "billing_provider_evidence_reports_tenant_cycle_idx" ON "billing_provider_evidence_reports" USING btree ("tenant_id","cycle_starts_at","cycle_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_release_drill_execution_records_tenant_run_drill_unique_idx" ON "billing_release_drill_execution_records" USING btree ("tenant_id","run_id","drill_id");--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_payg_order_fk" FOREIGN KEY ("tenant_id","payg_order_id") REFERENCES "public"."billing_payg_orders"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_payg_credit_entry_fk" FOREIGN KEY ("tenant_id","payg_credit_entry_id") REFERENCES "public"."billing_payg_credit_entries"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."billing_charge_reservations"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_outbox_fk" FOREIGN KEY ("tenant_id","outbox_id") REFERENCES "public"."billing_outbox"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_adjustment_fk" FOREIGN KEY ("tenant_id","adjustment_id") REFERENCES "public"."billing_adjustments"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_reconciliation_report_fk" FOREIGN KEY ("tenant_id","reconciliation_report_id") REFERENCES "public"."billing_reconciliation_reports"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_release_control_fk" FOREIGN KEY ("release_control_environment") REFERENCES "public"."billing_charge_release_controls"("environment") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_execution_record_fk" FOREIGN KEY ("tenant_id","execution_record_id") REFERENCES "public"."billing_release_drill_execution_records"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_source_integrity_check" CHECK ((
        "billing_release_drill_operation_evidence"."drill_id" = 'top_up'
        and "billing_release_drill_operation_evidence"."source_type" = 'payg_order'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."payg_order_id"
        and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is null and "billing_release_drill_operation_evidence"."reservation_id" is null
        and "billing_release_drill_operation_evidence"."outbox_id" is null and "billing_release_drill_operation_evidence"."adjustment_id" is null
        and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" = 'paid_grant'
        and "billing_release_drill_operation_evidence"."source_type" = 'payg_credit_entry'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."payg_credit_entry_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."reservation_id" is null
        and "billing_release_drill_operation_evidence"."outbox_id" is null and "billing_release_drill_operation_evidence"."adjustment_id" is null
        and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" = 'reservation'
        and "billing_release_drill_operation_evidence"."source_type" = 'reservation'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."reservation_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is null
        and "billing_release_drill_operation_evidence"."outbox_id" is null and "billing_release_drill_operation_evidence"."adjustment_id" is null
        and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" = 'debit_finalization'
        and "billing_release_drill_operation_evidence"."source_type" = 'reservation'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."reservation_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is not null
        and "billing_release_drill_operation_evidence"."outbox_id" is null and "billing_release_drill_operation_evidence"."adjustment_id" is null
        and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" = 'refund_reversal'
        and "billing_release_drill_operation_evidence"."source_type" = 'payg_credit_entry'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."payg_credit_entry_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is not null and "billing_release_drill_operation_evidence"."reservation_id" is null
        and "billing_release_drill_operation_evidence"."outbox_id" is null and "billing_release_drill_operation_evidence"."adjustment_id" is null
        and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" in ('zero_balance_stop', 'invoice_dispute', 'rollback', 'release_signals')
        and "billing_release_drill_operation_evidence"."source_type" = 'execution_record'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."execution_record_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is null
        and "billing_release_drill_operation_evidence"."reservation_id" is null and "billing_release_drill_operation_evidence"."outbox_id" is null
        and "billing_release_drill_operation_evidence"."adjustment_id" is null and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" in ('duplicate_event', 'late_event')
        and "billing_release_drill_operation_evidence"."source_type" = 'reconciliation_report'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."reconciliation_report_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is null
        and "billing_release_drill_operation_evidence"."reservation_id" is null and "billing_release_drill_operation_evidence"."outbox_id" is null
        and "billing_release_drill_operation_evidence"."adjustment_id" is null and "billing_release_drill_operation_evidence"."release_control_environment" is null
        and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" = 'adjustment'
        and "billing_release_drill_operation_evidence"."source_type" = 'adjustment'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."adjustment_id"
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is null
        and "billing_release_drill_operation_evidence"."reservation_id" is null and "billing_release_drill_operation_evidence"."outbox_id" is null
        and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
        and "billing_release_drill_operation_evidence"."release_control_environment" is null and "billing_release_drill_operation_evidence"."execution_record_id" is null
      ) or (
        "billing_release_drill_operation_evidence"."drill_id" = 'charge_stop'
        and "billing_release_drill_operation_evidence"."source_type" = 'execution_record'
        and "billing_release_drill_operation_evidence"."source_record_id" = "billing_release_drill_operation_evidence"."execution_record_id"
        and "billing_release_drill_operation_evidence"."release_control_environment" is not null
        and "billing_release_drill_operation_evidence"."payg_order_id" is null and "billing_release_drill_operation_evidence"."payg_credit_entry_id" is null
        and "billing_release_drill_operation_evidence"."reservation_id" is null and "billing_release_drill_operation_evidence"."outbox_id" is null
        and "billing_release_drill_operation_evidence"."adjustment_id" is null and "billing_release_drill_operation_evidence"."reconciliation_report_id" is null
      ));--> statement-breakpoint
CREATE TRIGGER billing_provider_evidence_reports_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_provider_evidence_reports"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER billing_release_drill_execution_records_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_release_drill_execution_records"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
