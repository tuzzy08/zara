-- Repair databases where the original migration 0012 already dropped the table.
-- The table remains compatibility-only; telephony_webhook_events is runtime authority.
CREATE TABLE IF NOT EXISTS "telephony_processed_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "event_sid" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "telephony_processed_webhook_events_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id")
    REFERENCES "public"."tenants"("id")
    ON DELETE cascade
    ON UPDATE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_processed_webhook_events_tenant_event_sid_unique_idx"
  ON "telephony_processed_webhook_events" USING btree ("tenant_id", "event_sid");
--> statement-breakpoint
ALTER TABLE "telephony_connections"
  ADD COLUMN IF NOT EXISTS "outbound_abuse_blocked" boolean DEFAULT false NOT NULL;
