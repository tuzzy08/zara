BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM billing_terminal_recovery_jobs
    WHERE status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Rollback 0026 blocked: unfinished terminal billing recovery jobs exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM billing_subscription_call_reservations
    WHERE status = 'active' AND reserved_overage_minor > 0
  ) THEN
    RAISE EXCEPTION 'Rollback 0026 blocked: active subscription overage reservations exist';
  END IF;
END;
$$;

DROP TABLE "billing_terminal_recovery_jobs";
DROP TABLE "billing_subscription_overage_accounts";

COMMIT;
