BEGIN;
LOCK TABLE provider_usage_requests IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM provider_usage_requests) THEN
    RAISE EXCEPTION 'provider usage records exist; retain the table and roll back application code only';
  END IF;
END $$;
DROP TABLE provider_usage_requests;
DROP FUNCTION provider_usage_requests_immutable();
COMMIT;
