CREATE TABLE "billing_charge_release_controls" (
	"environment" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"release_id" text NOT NULL,
	"approval_id" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approval_expires_at" timestamp with time zone NOT NULL,
	"internal_canary_completed_at" timestamp with time zone NOT NULL,
	"internal_canary_expires_at" timestamp with time zone NOT NULL,
	"selected_tenant_canary_completed_at" timestamp with time zone NOT NULL,
	"selected_tenant_canary_expires_at" timestamp with time zone NOT NULL,
	"reconciliation_completed_at" timestamp with time zone NOT NULL,
	"reconciliation_expires_at" timestamp with time zone NOT NULL,
	"drills_completed_at" timestamp with time zone NOT NULL,
	"drills_expires_at" timestamp with time zone NOT NULL,
	"delivery_stopped" boolean DEFAULT true NOT NULL,
	"stop_reason" text,
	"stopped_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_charge_release_controls_production_only_check" CHECK ("billing_charge_release_controls"."environment" = 'production'),
	CONSTRAINT "billing_charge_release_controls_approval_window_check" CHECK ("billing_charge_release_controls"."approval_expires_at" > "billing_charge_release_controls"."approved_at"),
	CONSTRAINT "billing_charge_release_controls_internal_canary_window_check" CHECK ("billing_charge_release_controls"."internal_canary_expires_at" > "billing_charge_release_controls"."internal_canary_completed_at"),
	CONSTRAINT "billing_charge_release_controls_selected_tenant_canary_window_check" CHECK ("billing_charge_release_controls"."selected_tenant_canary_expires_at" > "billing_charge_release_controls"."selected_tenant_canary_completed_at"),
	CONSTRAINT "billing_charge_release_controls_reconciliation_window_check" CHECK ("billing_charge_release_controls"."reconciliation_expires_at" > "billing_charge_release_controls"."reconciliation_completed_at"),
	CONSTRAINT "billing_charge_release_controls_drills_window_check" CHECK ("billing_charge_release_controls"."drills_expires_at" > "billing_charge_release_controls"."drills_completed_at"),
	CONSTRAINT "billing_charge_release_controls_stop_reason_check" CHECK (("billing_charge_release_controls"."delivery_stopped" = false and "billing_charge_release_controls"."stop_reason" is null and "billing_charge_release_controls"."stopped_at" is null)
        or ("billing_charge_release_controls"."delivery_stopped" = true and "billing_charge_release_controls"."stop_reason" is not null and "billing_charge_release_controls"."stopped_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "billing_charge_release_controls" ADD CONSTRAINT "billing_charge_release_controls_catalog_id_billing_price_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."billing_price_catalogs"("id") ON DELETE restrict ON UPDATE cascade;