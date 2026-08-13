DROP INDEX "billing_provider_tenant_scopes_provider_external_scope_unique_idx";
--> statement-breakpoint
CREATE FUNCTION billing_provider_tenant_scope_owner_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.provider || ':' || NEW.external_scope_id, 0));
  IF EXISTS (SELECT 1 FROM billing_provider_tenant_scopes existing
    WHERE existing.provider = NEW.provider
      AND existing.external_scope_id = NEW.external_scope_id
      AND existing.tenant_id <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'provider billing scope belongs to another tenant';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_provider_tenant_scope_owner_guard
BEFORE INSERT OR UPDATE ON billing_provider_tenant_scopes
FOR EACH ROW EXECUTE FUNCTION billing_provider_tenant_scope_owner_guard();
