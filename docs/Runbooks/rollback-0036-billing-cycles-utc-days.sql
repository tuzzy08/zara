BEGIN;
ALTER TABLE billing_cycles
  DROP CONSTRAINT "billing_cycles_utc_day_boundaries_check";
COMMIT;
