DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM billing_cycles
    WHERE date_trunc('day', starts_at AT TIME ZONE 'UTC') <> starts_at AT TIME ZONE 'UTC'
       OR date_trunc('day', ends_at AT TIME ZONE 'UTC') <> ends_at AT TIME ZONE 'UTC'
  ) THEN
    RAISE EXCEPTION 'existing billing cycle has a partial UTC day';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "billing_cycles"
  ADD CONSTRAINT "billing_cycles_utc_day_boundaries_check"
  CHECK (
    date_trunc('day', starts_at AT TIME ZONE 'UTC') = starts_at AT TIME ZONE 'UTC'
    AND date_trunc('day', ends_at AT TIME ZONE 'UTC') = ends_at AT TIME ZONE 'UTC'
  );
