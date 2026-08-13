DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM billing_charge_reservations
    WHERE status = 'active' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Rollback blocked: active billing reservations exist';
  END IF;
END
$$;

DROP TABLE IF EXISTS "billing_charge_reservations";
DROP TABLE IF EXISTS "billing_reservation_accounts";
