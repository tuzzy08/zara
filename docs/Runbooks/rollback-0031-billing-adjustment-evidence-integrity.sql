BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM billing_release_drill_operation_evidence
    WHERE drill_id = 'adjustment'
  ) THEN
    RAISE EXCEPTION 'Rollback 0031 blocked: adjustment drill evidence exists.';
  END IF;
END
$$;

ALTER TABLE billing_release_drill_operation_evidence
  DROP COLUMN ledger_entry_id,
  DROP COLUMN audit_log_id;

DROP INDEX audit_logs_tenant_id_id_unique_idx;

COMMIT;
