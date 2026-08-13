BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM billing_provider_tenant_scopes LIMIT 1) THEN
    RAISE EXCEPTION 'rollback 0035 blocked: provider billing scopes exist';
  END IF;
END $$;
DROP TRIGGER billing_provider_tenant_scope_owner_guard ON billing_provider_tenant_scopes;
DROP FUNCTION billing_provider_tenant_scope_owner_guard();
CREATE UNIQUE INDEX billing_provider_tenant_scopes_provider_external_scope_unique_idx
  ON billing_provider_tenant_scopes (provider, external_scope_id);
COMMIT;
