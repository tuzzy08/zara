BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_subscription_call_reservations) THEN
    RAISE EXCEPTION 'Rollback 0025 blocked: subscription reservations exist';
  END IF;
  IF EXISTS (SELECT 1 FROM billing_charge_reservations WHERE terminal_outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback 0025 blocked: PAYG terminal outcomes exist';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS billing_payg_reservation_terminal_outcome_trigger
  ON billing_charge_reservations;
DROP FUNCTION IF EXISTS billing_enforce_payg_reservation_terminal_outcome();
DROP TRIGGER IF EXISTS billing_subscription_reservation_pins_trigger
  ON billing_subscription_call_reservations;
DROP FUNCTION IF EXISTS billing_enforce_subscription_reservation_pins();
ALTER TABLE billing_subscription_call_reservations
  DROP CONSTRAINT IF EXISTS billing_subscription_call_reservations_values_check;
ALTER TABLE billing_subscription_call_reservations
  DROP CONSTRAINT IF EXISTS billing_subscription_call_reservations_terminal_outcome_check;
ALTER TABLE billing_subscription_call_reservations
  DROP COLUMN IF EXISTS terminal_outcome;
ALTER TABLE billing_subscription_call_reservations
  DROP COLUMN IF EXISTS reserved_payg_minor;
ALTER TABLE billing_subscription_call_reservations
  ADD CONSTRAINT billing_subscription_call_reservations_values_check
  CHECK (
    reserved_seconds > 0
    AND reserved_included_seconds >= 0
    AND reserved_included_seconds <= reserved_seconds
    AND reserved_overage_minor >= 0
  );
ALTER TABLE billing_charge_reservations
  DROP CONSTRAINT IF EXISTS billing_charge_reservations_terminal_outcome_check;
ALTER TABLE billing_charge_reservations
  DROP COLUMN IF EXISTS terminal_outcome;

COMMIT;
