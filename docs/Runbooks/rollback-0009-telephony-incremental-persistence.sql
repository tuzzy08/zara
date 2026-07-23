BEGIN;

DROP TABLE IF EXISTS "telephony_phone_test_checkpoints";
DROP TABLE IF EXISTS "telephony_media_stream_tokens";

DROP INDEX IF EXISTS "telephony_dispatches_tenant_call_session_unique_idx";
DROP INDEX IF EXISTS "telephony_webhook_events_tenant_connection_event_sid_unique_idx";
DROP INDEX IF EXISTS "telephony_execution_sessions_tenant_call_session_unique_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "telephony_dispatches" GROUP BY "id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Cannot restore legacy dispatch primary key: duplicate IDs exist.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "telephony_execution_sessions" GROUP BY "id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Cannot restore legacy execution-session primary key: duplicate IDs exist.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "telephony_webhook_events" GROUP BY "id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Cannot restore legacy webhook-event primary key: duplicate IDs exist.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "telephony_webhook_events"
    GROUP BY "tenant_id", "event_sid"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Cannot restore legacy webhook uniqueness: duplicate tenant event SIDs exist.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "telephony_execution_sessions"
    GROUP BY "call_session_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Cannot restore legacy execution-session uniqueness: duplicate call session IDs exist.';
  END IF;
END
$$;

ALTER TABLE "telephony_execution_commands"
  DROP CONSTRAINT IF EXISTS "telephony_execution_commands_session_fk";
ALTER TABLE "telephony_execution_sessions"
  DROP CONSTRAINT IF EXISTS "telephony_execution_sessions_dispatch_fk";

ALTER TABLE "telephony_dispatches" DROP CONSTRAINT "telephony_dispatches_tenant_id_id_pk";
ALTER TABLE "telephony_dispatches"
  ADD CONSTRAINT "telephony_dispatches_pkey" PRIMARY KEY ("id");
ALTER TABLE "telephony_execution_sessions"
  DROP CONSTRAINT "telephony_execution_sessions_tenant_id_id_pk";
ALTER TABLE "telephony_execution_sessions"
  ADD CONSTRAINT "telephony_execution_sessions_pkey" PRIMARY KEY ("id");
ALTER TABLE "telephony_webhook_events"
  DROP CONSTRAINT "telephony_webhook_events_tenant_id_id_pk";
ALTER TABLE "telephony_webhook_events"
  ADD CONSTRAINT "telephony_webhook_events_pkey" PRIMARY KEY ("id");

ALTER TABLE "telephony_execution_sessions"
  ADD CONSTRAINT "telephony_execution_sessions_dispatch_id_telephony_dispatches_id_fk"
  FOREIGN KEY ("dispatch_id") REFERENCES "telephony_dispatches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telephony_execution_commands"
  ADD CONSTRAINT "telephony_execution_commands_session_id_telephony_execution_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "telephony_execution_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "telephony_webhook_events_tenant_event_sid_unique_idx"
  ON "telephony_webhook_events" ("tenant_id", "event_sid");
CREATE UNIQUE INDEX "telephony_execution_sessions_call_session_unique_idx"
  ON "telephony_execution_sessions" ("call_session_id");

ALTER TABLE "telephony_dispatches" DROP COLUMN IF EXISTS "recording_consent";
ALTER TABLE "telephony_dispatches" DROP COLUMN IF EXISTS "runtime_path";
ALTER TABLE "telephony_execution_sessions" DROP COLUMN IF EXISTS "recording_consent";
ALTER TABLE "telephony_execution_sessions" DROP COLUMN IF EXISTS "version";

COMMIT;
