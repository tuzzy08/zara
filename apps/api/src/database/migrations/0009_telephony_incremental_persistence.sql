ALTER TABLE "telephony_execution_sessions"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;
ALTER TABLE "telephony_execution_sessions"
  ADD COLUMN IF NOT EXISTS "recording_consent" jsonb;
ALTER TABLE "telephony_dispatches" ADD COLUMN IF NOT EXISTS "runtime_path" text;
ALTER TABLE "telephony_dispatches"
  ADD COLUMN IF NOT EXISTS "recording_consent" jsonb;

ALTER TABLE "telephony_execution_commands"
  DROP CONSTRAINT IF EXISTS "telephony_execution_commands_session_id_telephony_execution_sessions_id_fk";
ALTER TABLE "telephony_execution_sessions"
  DROP CONSTRAINT IF EXISTS "telephony_execution_sessions_dispatch_id_telephony_dispatches_id_fk";

ALTER TABLE "telephony_dispatches" DROP CONSTRAINT "telephony_dispatches_pkey";
ALTER TABLE "telephony_dispatches"
  ADD CONSTRAINT "telephony_dispatches_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
ALTER TABLE "telephony_execution_sessions" DROP CONSTRAINT "telephony_execution_sessions_pkey";
ALTER TABLE "telephony_execution_sessions"
  ADD CONSTRAINT "telephony_execution_sessions_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
ALTER TABLE "telephony_webhook_events" DROP CONSTRAINT "telephony_webhook_events_pkey";
ALTER TABLE "telephony_webhook_events"
  ADD CONSTRAINT "telephony_webhook_events_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");

ALTER TABLE "telephony_execution_sessions"
  ADD CONSTRAINT "telephony_execution_sessions_dispatch_fk"
  FOREIGN KEY ("tenant_id", "dispatch_id")
  REFERENCES "telephony_dispatches"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telephony_execution_commands"
  ADD CONSTRAINT "telephony_execution_commands_session_fk"
  FOREIGN KEY ("tenant_id", "session_id")
  REFERENCES "telephony_execution_sessions"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "telephony_execution_sessions_call_session_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_execution_sessions_tenant_call_session_unique_idx"
  ON "telephony_execution_sessions" ("tenant_id", "call_session_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "telephony_dispatches"
    WHERE "call_session_id" IS NOT NULL
    GROUP BY "tenant_id", "call_session_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot add incremental telephony call identity: duplicate tenant call dispatches exist.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "telephony_dispatches_tenant_call_session_unique_idx"
  ON "telephony_dispatches" ("tenant_id", "call_session_id");

DROP INDEX IF EXISTS "telephony_webhook_events_tenant_event_sid_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_webhook_events_tenant_connection_event_sid_unique_idx"
  ON "telephony_webhook_events" ("tenant_id", "connection_id", "event_sid");

CREATE TABLE IF NOT EXISTS "telephony_media_stream_tokens" (
  "tenant_id" text NOT NULL,
  "call_session_id" text NOT NULL,
  "dispatch_id" text NOT NULL,
  "connection_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  CONSTRAINT "telephony_media_stream_tokens_tenant_id_call_session_id_pk"
    PRIMARY KEY ("tenant_id", "call_session_id"),
  CONSTRAINT "telephony_media_stream_tokens_token_hash_check"
    CHECK (char_length("token_hash") = 43 AND "token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "telephony_media_stream_tokens_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "telephony_media_stream_tokens_dispatch_fk"
    FOREIGN KEY ("tenant_id", "dispatch_id")
      REFERENCES "telephony_dispatches"("tenant_id", "id")
      ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "telephony_media_stream_tokens_connection_id_telephony_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "telephony_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "telephony_media_stream_tokens_session_fk"
    FOREIGN KEY ("tenant_id", "call_session_id")
      REFERENCES "telephony_execution_sessions"("tenant_id", "call_session_id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "telephony_media_stream_tokens_tenant_token_hash_unique_idx"
  ON "telephony_media_stream_tokens" ("tenant_id", "token_hash");

CREATE TABLE IF NOT EXISTS "telephony_phone_test_checkpoints" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "phone_number_id" text NOT NULL,
  "call_session_id" text NOT NULL,
  "test_route_session_id" text NOT NULL,
  "checkpoint" text NOT NULL,
  "observed_at" timestamptz NOT NULL,
  CONSTRAINT "telephony_phone_test_checkpoints_tenant_id_id_pk"
    PRIMARY KEY ("tenant_id", "id"),
  CONSTRAINT "telephony_phone_test_checkpoints_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "telephony_phone_test_checkpoints_phone_number_id_telephony_phone_numbers_id_fk"
    FOREIGN KEY ("phone_number_id") REFERENCES "telephony_phone_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "telephony_phone_test_checkpoints_tenant_test_checkpoint_unique_idx"
  ON "telephony_phone_test_checkpoints" ("tenant_id", "test_route_session_id", "checkpoint");

-- Rollback order:
-- 1. Drop telephony_phone_test_checkpoints, then telephony_media_stream_tokens.
-- 2. Restore global primary keys and legacy foreign keys only after duplicate preflights.
-- 3. Drop tenant-scoped webhook, dispatch, and execution-session indexes.
-- 4. Drop expansion columns last; existing snapshot callers remain valid throughout expansion.
