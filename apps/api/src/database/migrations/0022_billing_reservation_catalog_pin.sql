ALTER TABLE "billing_charge_reservations" ADD COLUMN "catalog_id" text;--> statement-breakpoint
ALTER TABLE "billing_charge_reservations" ADD CONSTRAINT "billing_charge_reservations_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
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
$$;--> statement-breakpoint
CREATE TRIGGER billing_charge_reservations_catalog_pin_trigger
BEFORE INSERT OR UPDATE ON "billing_charge_reservations"
FOR EACH ROW EXECUTE FUNCTION billing_enforce_reservation_catalog_pin();
