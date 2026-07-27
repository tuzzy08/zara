-- Remove the additive worker-owner lease before rolling back premium ownership.
BEGIN;

ALTER TABLE "telephony_media_stream_tokens"
  DROP COLUMN IF EXISTS "owner_lease_expires_at";

COMMIT;
