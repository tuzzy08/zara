BEGIN;
LOCK TABLE provider_usage_requests, provider_usage_connections IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM provider_usage_requests WHERE connection_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM provider_usage_connections WHERE call_session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'provider usage attribution exists; retain the columns and roll back application code only';
  END IF;
END $$;
DROP TRIGGER provider_usage_connection_scope ON provider_usage_requests;
DROP FUNCTION provider_usage_connection_scope();
ALTER TABLE provider_usage_requests DROP COLUMN connection_id;
ALTER TABLE provider_usage_connections DROP COLUMN call_session_id;
COMMIT;
