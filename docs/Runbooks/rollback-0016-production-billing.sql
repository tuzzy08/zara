BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_price_catalogs)
    OR EXISTS (SELECT 1 FROM billing_customers)
    OR EXISTS (SELECT 1 FROM billing_ledger_entries)
    OR EXISTS (SELECT 1 FROM billing_payg_orders)
    OR EXISTS (SELECT 1 FROM billing_payg_credit_entries)
    OR EXISTS (SELECT 1 FROM billing_subscriptions)
    OR EXISTS (SELECT 1 FROM billing_invoices)
    OR EXISTS (SELECT 1 FROM billing_adjustments)
    OR EXISTS (SELECT 1 FROM billing_budget_policies)
    OR EXISTS (SELECT 1 FROM billing_cycles)
    OR EXISTS (SELECT 1 FROM billing_entitlements)
    OR EXISTS (SELECT 1 FROM billing_outbox)
    OR EXISTS (SELECT 1 FROM billing_polar_mappings)
    OR EXISTS (SELECT 1 FROM billing_tenant_states)
    OR EXISTS (SELECT 1 FROM billing_webhook_receipts)
  THEN
    RAISE EXCEPTION 'Rollback blocked: production billing data exists';
  END IF;
END;
$$;

DROP TABLE IF EXISTS "billing_polar_mappings";
DROP TABLE IF EXISTS "billing_outbox";
DROP TABLE IF EXISTS "billing_webhook_receipts";
DROP TABLE IF EXISTS "billing_payg_credit_entries";
DROP TABLE IF EXISTS "billing_payg_orders";
DROP TABLE IF EXISTS "billing_adjustments";
DROP TABLE IF EXISTS "billing_invoices";
DROP TABLE IF EXISTS "billing_entitlements";
DROP TABLE IF EXISTS "billing_budget_policies";
DROP TABLE IF EXISTS "billing_cycles";
DROP TABLE IF EXISTS "billing_subscriptions";
DROP TABLE IF EXISTS "billing_tenant_states";
DROP TABLE IF EXISTS "billing_ledger_entries";
DROP TABLE IF EXISTS "billing_customers";
DROP TABLE IF EXISTS "billing_price_catalogs";
DROP FUNCTION IF EXISTS prevent_billing_immutable_mutation();

COMMIT;
