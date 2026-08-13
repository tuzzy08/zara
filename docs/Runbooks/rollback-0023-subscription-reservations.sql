DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_subscription_call_reservations)
     OR EXISTS (SELECT 1 FROM billing_subscription_reservation_accounts)
     OR EXISTS (SELECT 1 FROM billing_platform_risk_limits)
     OR EXISTS (SELECT 1 FROM billing_subscriptions WHERE plan_slug IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback blocked: subscription reservation data exists';
  END IF;
END $$;

DROP TABLE "billing_subscription_call_reservations";
DROP TABLE "billing_subscription_reservation_accounts";
DROP TABLE "billing_platform_risk_limits";
ALTER TABLE "billing_subscriptions" DROP COLUMN "plan_slug";
