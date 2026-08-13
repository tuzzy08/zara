BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_provider_evidence_reports)
    OR EXISTS (SELECT 1 FROM billing_release_drill_execution_records)
    OR EXISTS (SELECT 1 FROM billing_release_drill_operation_evidence)
  THEN
    RAISE EXCEPTION 'Rollback 0030 blocked: provider, drill execution, or drill operation evidence exists.';
  END IF;
END
$$;

ALTER TABLE billing_release_drill_operation_evidence
  DROP COLUMN source_type,
  DROP COLUMN source_record_id,
  DROP COLUMN payg_order_id,
  DROP COLUMN payg_credit_entry_id,
  DROP COLUMN reservation_id,
  DROP COLUMN outbox_id,
  DROP COLUMN adjustment_id,
  DROP COLUMN reconciliation_report_id,
  DROP COLUMN release_control_environment,
  DROP COLUMN execution_record_id;

DROP TABLE billing_release_drill_execution_records;
DROP TABLE billing_provider_evidence_reports;

COMMIT;
