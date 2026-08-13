CREATE TABLE "billing_adjustments" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_adjustments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_adjustments_amount_check" CHECK ("billing_adjustments"."amount_minor" > 0),
	CONSTRAINT "billing_adjustments_currency_check" CHECK ("billing_adjustments"."currency" = 'usd')
);
--> statement-breakpoint
CREATE TABLE "billing_budget_policies" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"overage_limit_minor" bigint DEFAULT 0 NOT NULL,
	"call_minute_limit" real DEFAULT 0 NOT NULL,
	"premium_runtime_minute_limit" real DEFAULT 0 NOT NULL,
	"over_budget_behavior" text NOT NULL,
	"warning_threshold_percent" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_budget_policies_currency_check" CHECK ("billing_budget_policies"."currency" = 'usd'),
	CONSTRAINT "billing_budget_policies_overage_check" CHECK ("billing_budget_policies"."overage_limit_minor" >= 0),
	CONSTRAINT "billing_budget_policies_call_limit_check" CHECK ("billing_budget_policies"."call_minute_limit" >= 0),
	CONSTRAINT "billing_budget_policies_premium_limit_check" CHECK ("billing_budget_policies"."premium_runtime_minute_limit" >= 0),
	CONSTRAINT "billing_budget_policies_warning_check" CHECK ("billing_budget_policies"."warning_threshold_percent" between 1 and 100),
	CONSTRAINT "billing_budget_policies_version_check" CHECK ("billing_budget_policies"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_provider_check" CHECK ("billing_customers"."provider" = 'polar')
);
--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_cycles_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_cycles_range_check" CHECK ("billing_cycles"."ends_at" > "billing_cycles"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "billing_entitlements" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"provider_benefit_id" text,
	"key" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_entitlements_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_invoices_amount_check" CHECK ("billing_invoices"."amount_minor" >= 0),
	CONSTRAINT "billing_invoices_currency_check" CHECK ("billing_invoices"."currency" = 'usd')
);
--> statement-breakpoint
CREATE TABLE "billing_ledger_entries" (
	"id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"entry_type" text NOT NULL,
	"catalog_id" text,
	"currency" text NOT NULL,
	"customer_amount_minor" bigint,
	"supplier_cost_minor" bigint,
	"quantity" bigint NOT NULL,
	"unit" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_ledger_entries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_ledger_entries_currency_check" CHECK ("billing_ledger_entries"."currency" = 'usd'),
	CONSTRAINT "billing_ledger_entries_customer_amount_check" CHECK ("billing_ledger_entries"."customer_amount_minor" is null or "billing_ledger_entries"."customer_amount_minor" >= 0),
	CONSTRAINT "billing_ledger_entries_supplier_cost_check" CHECK ("billing_ledger_entries"."supplier_cost_minor" is null or "billing_ledger_entries"."supplier_cost_minor" >= 0),
	CONSTRAINT "billing_ledger_entries_quantity_check" CHECK ("billing_ledger_entries"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_outbox" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "billing_outbox_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_outbox_attempt_count_check" CHECK ("billing_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_payg_credit_entries" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"order_id" text,
	"entry_type" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payg_credit_entries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_payg_credit_entries_amount_check" CHECK ("billing_payg_credit_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_payg_orders" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"currency" text NOT NULL,
	"paid_amount_minor" bigint NOT NULL,
	"granted_credit_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payg_orders_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_payg_orders_paid_amount_check" CHECK ("billing_payg_orders"."paid_amount_minor" > 0),
	CONSTRAINT "billing_payg_orders_credit_check" CHECK ("billing_payg_orders"."granted_credit_minor" > 0),
	CONSTRAINT "billing_payg_orders_currency_check" CHECK ("billing_payg_orders"."currency" = 'usd')
);
--> statement-breakpoint
CREATE TABLE "billing_polar_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"mapping_type" text NOT NULL,
	"internal_key" text NOT NULL,
	"provider_id" text NOT NULL,
	"environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_price_catalogs" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"checksum" text NOT NULL,
	"catalog_document" jsonb NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_price_catalogs_version_check" CHECK ("billing_price_catalogs"."version" > 0),
	CONSTRAINT "billing_price_catalogs_status_check" CHECK ("billing_price_catalogs"."status" = 'active'),
	CONSTRAINT "billing_price_catalogs_currency_check" CHECK ("billing_price_catalogs"."currency" = 'usd'),
	CONSTRAINT "billing_price_catalogs_checksum_check" CHECK (char_length("billing_price_catalogs"."checksum") = 64 and "billing_price_catalogs"."checksum" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_subscriptions_version_check" CHECK ("billing_subscriptions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_tenant_states" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_receipts" (
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text NOT NULL,
	"error" text,
	CONSTRAINT "billing_webhook_receipts_tenant_id_provider_event_id_pk" PRIMARY KEY("tenant_id","provider","event_id"),
	CONSTRAINT "billing_webhook_receipts_payload_hash_check" CHECK (char_length("billing_webhook_receipts"."payload_hash") = 64 and "billing_webhook_receipts"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_ledger_entry_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."billing_ledger_entries"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_budget_policies" ADD CONSTRAINT "billing_budget_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_entitlements" ADD CONSTRAINT "billing_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_outbox" ADD CONSTRAINT "billing_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_payg_credit_entries" ADD CONSTRAINT "billing_payg_credit_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_payg_credit_entries" ADD CONSTRAINT "billing_payg_credit_entries_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."billing_payg_orders"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_payg_orders" ADD CONSTRAINT "billing_payg_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_polar_mappings" ADD CONSTRAINT "billing_polar_mappings_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_tenant_states" ADD CONSTRAINT "billing_tenant_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_webhook_receipts" ADD CONSTRAINT "billing_webhook_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_provider_customer_unique_idx" ON "billing_customers" USING btree ("provider","provider_customer_id");--> statement-breakpoint
CREATE INDEX "billing_cycles_tenant_starts_at_idx" ON "billing_cycles" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entitlements_tenant_key_unique_idx" ON "billing_entitlements" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoices_provider_order_unique_idx" ON "billing_invoices" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_ledger_entries_tenant_idempotency_unique_idx" ON "billing_ledger_entries" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_ledger_entries_tenant_occurred_at_idx" ON "billing_ledger_entries" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_outbox_delivery_idx" ON "billing_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payg_credit_entries_tenant_idempotency_unique_idx" ON "billing_payg_credit_entries" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payg_orders_provider_order_unique_idx" ON "billing_payg_orders" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_polar_mappings_catalog_key_unique_idx" ON "billing_polar_mappings" USING btree ("catalog_id","mapping_type","internal_key","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_polar_mappings_provider_environment_unique_idx" ON "billing_polar_mappings" USING btree ("provider_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_price_catalogs_version_unique_idx" ON "billing_price_catalogs" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_subscription_unique_idx" ON "billing_subscriptions" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_tenant_status_idx" ON "billing_subscriptions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "billing_webhook_receipts_status_received_at_idx" ON "billing_webhook_receipts" USING btree ("status","received_at");
--> statement-breakpoint
CREATE FUNCTION prevent_billing_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Billing record in % is immutable', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_price_catalogs_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_price_catalogs"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER billing_ledger_entries_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER billing_adjustments_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_adjustments"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
--> statement-breakpoint
CREATE TRIGGER billing_payg_credit_entries_immutable_trigger
BEFORE UPDATE OR DELETE ON "billing_payg_credit_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_billing_immutable_mutation();
