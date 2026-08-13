ALTER TABLE "billing_charge_reservations" ADD COLUMN "charge_context" jsonb;--> statement-breakpoint
ALTER TABLE "billing_charge_reservations" ADD CONSTRAINT "billing_charge_reservations_charge_context_check" CHECK ("charge_context" IS NULL OR jsonb_typeof("charge_context") = 'object') NOT VALID;--> statement-breakpoint
ALTER TABLE "billing_charge_reservations" VALIDATE CONSTRAINT "billing_charge_reservations_charge_context_check";--> statement-breakpoint
CREATE OR REPLACE FUNCTION billing_enforce_reservation_catalog_pin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.catalog_id IS NULL THEN
    RAISE EXCEPTION 'New billing reservations require a catalog pin';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.charge_context IS NULL THEN
    RAISE EXCEPTION 'New billing reservations require a charge context pin';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.catalog_id IS DISTINCT FROM OLD.catalog_id THEN
    RAISE EXCEPTION 'Billing reservation catalog pins are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.charge_context IS DISTINCT FROM OLD.charge_context THEN
    RAISE EXCEPTION 'Billing reservation charge context pins are immutable';
  END IF;

  RETURN NEW;
END;
$$;
