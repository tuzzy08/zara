BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM billing_charge_reservations
    WHERE charge_context IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Rollback 0024 blocked: pinned billing reservation charge contexts exist';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION billing_enforce_reservation_catalog_pin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.catalog_id IS NULL THEN
    RAISE EXCEPTION 'New billing reservations require a catalog pin';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.catalog_id IS DISTINCT FROM OLD.catalog_id THEN
    RAISE EXCEPTION 'Billing reservation catalog pins are immutable';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE billing_charge_reservations
  DROP CONSTRAINT billing_charge_reservations_charge_context_check;
ALTER TABLE billing_charge_reservations DROP COLUMN charge_context;

COMMIT;
