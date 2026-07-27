-- Roll back only the additive 0013 abuse marker.
-- Keep telephony_processed_webhook_events for the previous application revision.
BEGIN;

LOCK TABLE "telephony_connections" IN ACCESS EXCLUSIVE MODE;

DO $rollback$
DECLARE
  has_abuse_marker boolean;
  has_active_abuse_block boolean;
BEGIN
  IF to_regclass('public.telephony_processed_webhook_events') IS NULL THEN
    RAISE EXCEPTION
      'Rollback blocked: telephony_processed_webhook_events is required by the previous application revision';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'telephony_connections'
      AND column_name = 'outbound_abuse_blocked'
  )
  INTO has_abuse_marker;

  IF has_abuse_marker THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1
         FROM public.telephony_connections
         WHERE outbound_abuse_blocked = true
       )'
    INTO has_active_abuse_block;

    IF has_active_abuse_block THEN
      RAISE EXCEPTION
        'Rollback blocked: outbound abuse posture is active';
    END IF;
  END IF;
END
$rollback$;

ALTER TABLE "telephony_connections"
  DROP COLUMN IF EXISTS "outbound_abuse_blocked";

COMMIT;
