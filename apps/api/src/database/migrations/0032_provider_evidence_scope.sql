DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_provider_evidence_reports) THEN
    RAISE EXCEPTION 'Migration 0032 blocked: provider evidence exists without a truthful catalog scope. Preserve and migrate that evidence before retrying.';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "billing_provider_evidence_reports_provider_source_unique_idx";--> statement-breakpoint
ALTER TABLE "billing_provider_evidence_reports" ADD COLUMN "catalog_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_provider_evidence_reports" ADD CONSTRAINT "billing_provider_evidence_reports_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_evidence_reports_tenant_catalog_cycle_provider_source_unique_idx" ON "billing_provider_evidence_reports" USING btree ("tenant_id","catalog_id","cycle_starts_at","cycle_ends_at","provider","source_report_id");
