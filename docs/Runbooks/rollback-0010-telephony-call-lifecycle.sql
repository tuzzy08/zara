BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "telephony_phone_test_checkpoints"
    GROUP BY "tenant_id", "test_route_session_id", "checkpoint"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'Cannot restore waiting-session checkpoint uniqueness: duplicate checkpoints exist.';
  END IF;
END
$$;

DROP INDEX IF EXISTS "telephony_phone_test_checkpoints_tenant_call_checkpoint_unique_idx";
CREATE UNIQUE INDEX "telephony_phone_test_checkpoints_tenant_test_checkpoint_unique_idx"
  ON "telephony_phone_test_checkpoints" ("tenant_id", "test_route_session_id", "checkpoint");

ALTER TABLE "telephony_execution_sessions"
  DROP COLUMN IF EXISTS "lifecycle_state";

COMMIT;
