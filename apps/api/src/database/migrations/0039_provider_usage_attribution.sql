ALTER TABLE "provider_usage_connections" ADD COLUMN "call_session_id" text;--> statement-breakpoint
ALTER TABLE "provider_usage_requests" ADD COLUMN "connection_id" text;
--> statement-breakpoint
CREATE FUNCTION provider_usage_connection_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM provider_usage_connections c
    WHERE c.id = NEW.connection_id AND c.tenant_id = NEW.tenant_id
      AND c.session_id IS NOT DISTINCT FROM NEW.session_id
      AND c.external_scope_id IS NOT DISTINCT FROM NEW.external_scope_id
      AND c.provider = NEW.provider
  ) THEN
    RAISE EXCEPTION 'provider usage connection scope does not match';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_usage_connection_scope
BEFORE INSERT ON provider_usage_requests
FOR EACH ROW EXECUTE FUNCTION provider_usage_connection_scope();
