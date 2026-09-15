CREATE TABLE "provider_usage_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text,
	"external_scope_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE FUNCTION provider_usage_requests_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.result IS NULL AND NEW.result IS NOT NULL
    AND (to_jsonb(NEW) - 'result') = (to_jsonb(OLD) - 'result') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'provider usage records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_usage_requests_immutable
BEFORE UPDATE OR DELETE ON provider_usage_requests
FOR EACH ROW EXECUTE FUNCTION provider_usage_requests_immutable();
