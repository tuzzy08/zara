CREATE TABLE "telephony_processed_webhook_events" (
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

CREATE UNIQUE INDEX "telephony_processed_webhook_events_tenant_event_sid_unique_idx"
  ON "telephony_processed_webhook_events" USING btree ("tenant_id", "event_sid");
