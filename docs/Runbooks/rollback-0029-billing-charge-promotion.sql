BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_charge_promotion_records)
    OR EXISTS (SELECT 1 FROM billing_release_drill_operation_evidence)
  THEN
    RAISE EXCEPTION 'Rollback 0029 blocked: charge promotion or drill operation evidence exists.';
  END IF;
END
$$;

DROP TABLE billing_charge_promotion_records;
DROP TABLE billing_release_drill_operation_evidence;

COMMIT;
