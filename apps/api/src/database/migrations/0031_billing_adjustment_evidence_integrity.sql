DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM billing_release_drill_operation_evidence
    WHERE drill_id = 'adjustment'
  ) THEN
    RAISE EXCEPTION 'Migration 0031 blocked: pre-0031 adjustment drill evidence exists. Preserve and migrate its ledger and audit references before retrying.';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "ledger_entry_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD COLUMN "audit_log_id" text;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_ledger_entry_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."billing_ledger_entries"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_tenant_id_id_unique_idx" ON "audit_logs" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_audit_log_fk" FOREIGN KEY ("tenant_id","audit_log_id") REFERENCES "public"."audit_logs"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_release_drill_operation_evidence" ADD CONSTRAINT "billing_release_drill_operation_evidence_adjustment_source_integrity_check" CHECK (("billing_release_drill_operation_evidence"."drill_id" = 'adjustment'
          and "billing_release_drill_operation_evidence"."ledger_entry_id" is not null and "billing_release_drill_operation_evidence"."audit_log_id" is not null)
        or ("billing_release_drill_operation_evidence"."drill_id" <> 'adjustment'
          and "billing_release_drill_operation_evidence"."ledger_entry_id" is null and "billing_release_drill_operation_evidence"."audit_log_id" is null));
