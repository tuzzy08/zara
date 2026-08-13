BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_provider_tenant_scopes LIMIT 1) THEN
    RAISE EXCEPTION 'rollback 0034 blocked: provider billing scopes exist';
  END IF;
END;
$$;

DROP INDEX billing_provider_tenant_scopes_provider_external_scope_unique_idx;

COMMIT;
