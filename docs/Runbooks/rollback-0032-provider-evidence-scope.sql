BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_provider_evidence_reports) THEN
    RAISE EXCEPTION 'Rollback 0032 blocked: catalog-scoped provider evidence exists.';
  END IF;
END
$$;

DROP INDEX billing_provider_evidence_reports_tenant_catalog_cycle_provider_source_unique_idx;
ALTER TABLE billing_provider_evidence_reports DROP COLUMN catalog_id;
CREATE UNIQUE INDEX billing_provider_evidence_reports_provider_source_unique_idx
  ON billing_provider_evidence_reports (provider, source_report_id);

COMMIT;
