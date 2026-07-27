ALTER TABLE "telephony_execution_sessions"
ADD COLUMN "lifecycle_state" jsonb;

UPDATE "telephony_execution_sessions"
SET "lifecycle_state" = jsonb_build_object(
  'stage',
  CASE
    WHEN "status" = 'completed' THEN 'completed'
    WHEN "status" IN ('terminated', 'blocked') THEN 'failed'
    WHEN "status" IN ('active', 'grace-active', 'failover-active') THEN 'active'
    WHEN "status" = 'transfer-pending' THEN 'handoff'
    WHEN "status" = 'closeout-pending' THEN 'draining'
    ELSE 'ringing'
  END,
  'observedAt',
  to_char("updated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

ALTER TABLE "telephony_execution_sessions"
ALTER COLUMN "lifecycle_state" SET NOT NULL;

DROP INDEX IF EXISTS "telephony_phone_test_checkpoints_tenant_test_checkpoint_unique_idx";
CREATE UNIQUE INDEX "telephony_phone_test_checkpoints_tenant_call_checkpoint_unique_idx"
  ON "telephony_phone_test_checkpoints" ("tenant_id", "call_session_id", "checkpoint");
