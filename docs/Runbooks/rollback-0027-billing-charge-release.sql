BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_charge_release_controls) THEN
    RAISE EXCEPTION 'Rollback 0027 blocked: charge-release approval or evidence exists.';
  END IF;
END
$$;

DROP TABLE billing_charge_release_controls;

COMMIT;
