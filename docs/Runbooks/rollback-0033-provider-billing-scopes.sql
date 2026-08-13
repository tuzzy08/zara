BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_provider_tenant_scopes LIMIT 1) THEN
    RAISE EXCEPTION 'rollback 0033 blocked: provider billing scopes exist';
  END IF;
END;
$$;

DROP TABLE billing_provider_tenant_scopes;
DROP FUNCTION billing_provider_tenant_scopes_immutable();

COMMIT;
