CREATE TABLE "billing_provider_tenant_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_scope_id" text NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_provider_tenant_scopes_provider_check" CHECK ("billing_provider_tenant_scopes"."provider" in ('cartesia', 'openai', 'gemini')),
	CONSTRAINT "billing_provider_tenant_scopes_interval_check" CHECK ("billing_provider_tenant_scopes"."effective_until" is null or "billing_provider_tenant_scopes"."effective_until" > "billing_provider_tenant_scopes"."effective_from")
	,CONSTRAINT "billing_provider_tenant_scopes_external_scope_check" CHECK ("external_scope_id" = btrim("external_scope_id") and length("external_scope_id") > 0)
);
--> statement-breakpoint
ALTER TABLE "billing_provider_tenant_scopes" ADD CONSTRAINT "billing_provider_tenant_scopes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_tenant_scopes_tenant_provider_effective_unique_idx" ON "billing_provider_tenant_scopes" USING btree ("tenant_id","provider","effective_from");--> statement-breakpoint
CREATE INDEX "billing_provider_tenant_scopes_tenant_provider_idx" ON "billing_provider_tenant_scopes" USING btree ("tenant_id","provider","effective_from");
--> statement-breakpoint
CREATE FUNCTION billing_provider_tenant_scopes_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.effective_until IS NULL
    AND NEW.effective_until IS NOT NULL
    AND NEW.effective_until > OLD.effective_from
    AND NEW.id = OLD.id
    AND NEW.tenant_id = OLD.tenant_id
    AND NEW.provider = OLD.provider
    AND NEW.external_scope_id = OLD.external_scope_id
    AND NEW.configuration = OLD.configuration
    AND NEW.effective_from = OLD.effective_from
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing provider tenant scopes are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_provider_tenant_scopes_immutable
BEFORE UPDATE OR DELETE ON billing_provider_tenant_scopes
FOR EACH ROW EXECUTE FUNCTION billing_provider_tenant_scopes_immutable();
