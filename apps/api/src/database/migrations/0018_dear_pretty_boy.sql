CREATE TABLE "billing_charge_reservations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"reservation_key" text NOT NULL,
	"funding_source" text NOT NULL,
	"status" text NOT NULL,
	"reserved_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_charge_reservations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "billing_charge_reservations_amount_check" CHECK ("billing_charge_reservations"."reserved_amount_minor" > 0),
	CONSTRAINT "billing_charge_reservations_currency_check" CHECK ("billing_charge_reservations"."currency" = 'usd'),
	CONSTRAINT "billing_charge_reservations_funding_source_check" CHECK ("billing_charge_reservations"."funding_source" = 'payg_credit'),
	CONSTRAINT "billing_charge_reservations_status_check" CHECK ("billing_charge_reservations"."status" = 'active'),
	CONSTRAINT "billing_charge_reservations_expiry_check" CHECK ("billing_charge_reservations"."expires_at" > "billing_charge_reservations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "billing_reservation_accounts" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"reserved_amount_minor" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_reservation_accounts_reserved_amount_check" CHECK ("billing_reservation_accounts"."reserved_amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_charge_reservations" ADD CONSTRAINT "billing_charge_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_reservation_accounts" ADD CONSTRAINT "billing_reservation_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charge_reservations_tenant_key_unique_idx" ON "billing_charge_reservations" USING btree ("tenant_id","reservation_key");--> statement-breakpoint
CREATE INDEX "billing_charge_reservations_status_expiry_idx" ON "billing_charge_reservations" USING btree ("status","expires_at");