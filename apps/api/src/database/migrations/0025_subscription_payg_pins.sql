ALTER TABLE "billing_subscription_call_reservations"
  DROP CONSTRAINT "billing_subscription_call_reservations_values_check";
--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations"
  ADD COLUMN "reserved_payg_minor" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations"
  ADD COLUMN "terminal_outcome" text;
--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations"
  ADD CONSTRAINT "billing_subscription_call_reservations_terminal_outcome_check"
  CHECK ("terminal_outcome" IS NULL OR "terminal_outcome" IN ('completed', 'transferred', 'failed'));
--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations"
  ADD CONSTRAINT "billing_subscription_call_reservations_values_check"
  CHECK (
    "reserved_seconds" > 0
    AND "reserved_included_seconds" >= 0
    AND "reserved_included_seconds" <= "reserved_seconds"
    AND "reserved_payg_minor" >= 0
    AND "reserved_overage_minor" >= 0
  );
--> statement-breakpoint
ALTER TABLE "billing_charge_reservations"
  ADD COLUMN "terminal_outcome" text;
--> statement-breakpoint
ALTER TABLE "billing_charge_reservations"
  ADD CONSTRAINT "billing_charge_reservations_terminal_outcome_check"
  CHECK ("terminal_outcome" IS NULL OR "terminal_outcome" IN ('completed', 'transferred', 'failed'));
--> statement-breakpoint
CREATE FUNCTION billing_enforce_subscription_reservation_pins()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.subscription_id,
    NEW.cycle_id,
    NEW.catalog_id,
    NEW.plan_slug,
    NEW.meter_class,
    NEW.reserved_seconds,
    NEW.reserved_included_seconds,
    NEW.reserved_payg_minor,
    NEW.reserved_overage_minor,
    NEW.billing_mode,
    NEW.provider,
    NEW.direction,
    NEW.route_rate_id,
    NEW.route_identity,
    NEW.route_rate_minor_per_minute,
    NEW.reserved_telephony_minor
  ) IS DISTINCT FROM (
    OLD.subscription_id,
    OLD.cycle_id,
    OLD.catalog_id,
    OLD.plan_slug,
    OLD.meter_class,
    OLD.reserved_seconds,
    OLD.reserved_included_seconds,
    OLD.reserved_payg_minor,
    OLD.reserved_overage_minor,
    OLD.billing_mode,
    OLD.provider,
    OLD.direction,
    OLD.route_rate_id,
    OLD.route_identity,
    OLD.route_rate_minor_per_minute,
    OLD.reserved_telephony_minor
  ) THEN
    RAISE EXCEPTION 'Subscription reservation financial pins are immutable';
  END IF;
  IF OLD.terminal_outcome IS NOT NULL
     AND NEW.terminal_outcome IS DISTINCT FROM OLD.terminal_outcome THEN
    RAISE EXCEPTION 'Subscription reservation terminal outcome is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_subscription_reservation_pins_trigger
BEFORE UPDATE ON "billing_subscription_call_reservations"
FOR EACH ROW EXECUTE FUNCTION billing_enforce_subscription_reservation_pins();
--> statement-breakpoint
CREATE FUNCTION billing_enforce_payg_reservation_terminal_outcome()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.terminal_outcome IS NOT NULL
     AND NEW.terminal_outcome IS DISTINCT FROM OLD.terminal_outcome THEN
    RAISE EXCEPTION 'PAYG reservation terminal outcome is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_payg_reservation_terminal_outcome_trigger
BEFORE UPDATE ON "billing_charge_reservations"
FOR EACH ROW EXECUTE FUNCTION billing_enforce_payg_reservation_terminal_outcome();
