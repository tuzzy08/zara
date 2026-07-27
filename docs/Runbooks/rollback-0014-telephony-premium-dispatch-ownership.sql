-- Remove premium dispatch ownership before restoring legacy call identities.
BEGIN;

DROP TABLE IF EXISTS "telephony_premium_dispatch_snapshots";

ALTER TABLE "telephony_media_stream_tokens"
  DROP CONSTRAINT IF EXISTS "telephony_media_stream_tokens_owner_pair_check";
ALTER TABLE "telephony_media_stream_tokens"
  DROP CONSTRAINT IF EXISTS "telephony_media_stream_tokens_owner_epoch_check";
ALTER TABLE "telephony_media_stream_tokens"
  DROP COLUMN IF EXISTS "owner_worker_id";
ALTER TABLE "telephony_media_stream_tokens"
  DROP COLUMN IF EXISTS "owner_epoch";

COMMIT;
