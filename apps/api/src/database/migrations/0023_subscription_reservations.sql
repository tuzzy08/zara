CREATE TABLE "billing_platform_risk_limits" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"overage_limit_minor" bigint DEFAULT 0 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_platform_risk_limits_currency_check" CHECK ("billing_platform_risk_limits"."currency" = 'usd'),
	CONSTRAINT "billing_platform_risk_limits_overage_check" CHECK ("billing_platform_risk_limits"."overage_limit_minor" >= 0),
	CONSTRAINT "billing_platform_risk_limits_version_check" CHECK ("billing_platform_risk_limits"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_subscription_call_reservations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"reservation_key" text NOT NULL,
	"subscription_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"plan_slug" text NOT NULL,
	"meter_class" text NOT NULL,
	"status" text NOT NULL,
	"reserved_seconds" bigint NOT NULL,
	"reserved_included_seconds" bigint NOT NULL,
	"reserved_overage_minor" bigint NOT NULL,
	"billing_mode" text NOT NULL,
	"provider" text NOT NULL,
	"direction" text NOT NULL,
	"route_rate_id" text,
	"route_identity" jsonb,
	"route_rate_minor_per_minute" bigint,
	"reserved_telephony_minor" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"actual_seconds" bigint,
	"actual_provider_connected_seconds" bigint,
	"session_id" text,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_subscription_call_reservations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_subscription_call_reservations_meter_check" CHECK ("billing_subscription_call_reservations"."meter_class" in ('standard', 'premium')),
	CONSTRAINT "billing_subscription_call_reservations_mode_check" CHECK ("billing_subscription_call_reservations"."billing_mode" in ('byo', 'platform_managed')),
	CONSTRAINT "billing_subscription_call_reservations_route_check" CHECK (("billing_subscription_call_reservations"."billing_mode" = 'byo' and "billing_subscription_call_reservations"."route_rate_id" is null and "billing_subscription_call_reservations"."route_identity" is null and "billing_subscription_call_reservations"."route_rate_minor_per_minute" is null and "billing_subscription_call_reservations"."reserved_telephony_minor" = 0) or ("billing_subscription_call_reservations"."billing_mode" = 'platform_managed' and "billing_subscription_call_reservations"."route_rate_id" is not null and "billing_subscription_call_reservations"."route_identity" is not null and "billing_subscription_call_reservations"."route_rate_minor_per_minute" >= 0 and "billing_subscription_call_reservations"."reserved_telephony_minor" >= 0)),
	CONSTRAINT "billing_subscription_call_reservations_status_check" CHECK ("billing_subscription_call_reservations"."status" in ('active', 'expired', 'finalized')),
	CONSTRAINT "billing_subscription_call_reservations_values_check" CHECK ("billing_subscription_call_reservations"."reserved_seconds" > 0 and "billing_subscription_call_reservations"."reserved_included_seconds" >= 0 and "billing_subscription_call_reservations"."reserved_included_seconds" <= "billing_subscription_call_reservations"."reserved_seconds" and "billing_subscription_call_reservations"."reserved_overage_minor" >= 0),
	CONSTRAINT "billing_subscription_call_reservations_actual_check" CHECK ("billing_subscription_call_reservations"."actual_seconds" is null or ("billing_subscription_call_reservations"."actual_seconds" >= 0 and "billing_subscription_call_reservations"."actual_seconds" <= "billing_subscription_call_reservations"."reserved_seconds"))
);
--> statement-breakpoint
CREATE TABLE "billing_subscription_reservation_accounts" (
	"tenant_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"meter_class" text NOT NULL,
	"reserved_included_seconds" bigint DEFAULT 0 NOT NULL,
	"reserved_overage_minor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_subscription_reservation_accounts_tenant_id_cycle_id_meter_class_pk" PRIMARY KEY("tenant_id","cycle_id","meter_class"),
	CONSTRAINT "billing_subscription_reservation_accounts_meter_check" CHECK ("billing_subscription_reservation_accounts"."meter_class" in ('standard', 'premium')),
	CONSTRAINT "billing_subscription_reservation_accounts_values_check" CHECK ("billing_subscription_reservation_accounts"."reserved_included_seconds" >= 0 and "billing_subscription_reservation_accounts"."reserved_overage_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "plan_slug" text;--> statement-breakpoint
ALTER TABLE "billing_platform_risk_limits" ADD CONSTRAINT "billing_platform_risk_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations" ADD CONSTRAINT "billing_subscription_call_reservations_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations" ADD CONSTRAINT "billing_subscription_call_reservations_subscription_fk" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."billing_subscriptions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_subscription_call_reservations" ADD CONSTRAINT "billing_subscription_call_reservations_cycle_fk" FOREIGN KEY ("tenant_id","cycle_id") REFERENCES "public"."billing_cycles"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_subscription_reservation_accounts" ADD CONSTRAINT "billing_subscription_reservation_accounts_cycle_fk" FOREIGN KEY ("tenant_id","cycle_id") REFERENCES "public"."billing_cycles"("tenant_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_call_reservations_tenant_key_unique" ON "billing_subscription_call_reservations" USING btree ("tenant_id","reservation_key");--> statement-breakpoint
CREATE INDEX "billing_subscription_call_reservations_expiry_idx" ON "billing_subscription_call_reservations" USING btree ("status","expires_at");
