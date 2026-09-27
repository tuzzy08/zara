CREATE TABLE "billing_delivery_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"enabled" boolean NOT NULL,
	"catalog_id" text,
	"release_id" text,
	"effective_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"expected_decision_id" text,
	CONSTRAINT "billing_delivery_decisions_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "billing_delivery_decisions_scope_check" CHECK (("billing_delivery_decisions"."enabled" AND length(trim("billing_delivery_decisions"."catalog_id")) > 0 AND "billing_delivery_decisions"."catalog_id" IS NOT NULL
    AND length(trim("billing_delivery_decisions"."release_id")) > 0 AND "billing_delivery_decisions"."release_id" IS NOT NULL)
    OR (NOT "billing_delivery_decisions"."enabled" AND "billing_delivery_decisions"."catalog_id" IS NULL AND "billing_delivery_decisions"."release_id" IS NULL)),
	CONSTRAINT "billing_delivery_decisions_identity_check" CHECK (length(trim("billing_delivery_decisions"."id")) BETWEEN 1 AND 128
    AND length(trim("billing_delivery_decisions"."actor_user_id")) > 0 AND length(trim("billing_delivery_decisions"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "billing_outbox" ADD COLUMN "delivery_decision_id" text;--> statement-breakpoint
ALTER TABLE "billing_outbox" ADD CONSTRAINT "billing_outbox_delivery_decision_id_billing_delivery_decisions_id_fk" FOREIGN KEY ("delivery_decision_id") REFERENCES "public"."billing_delivery_decisions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION prevent_billing_delivery_decision_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Billing delivery decisions are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_delivery_decisions_immutable BEFORE UPDATE OR DELETE ON billing_delivery_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_billing_delivery_decision_change();
