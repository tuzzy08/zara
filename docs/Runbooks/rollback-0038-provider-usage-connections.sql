BEGIN;
LOCK TABLE provider_usage_connections IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM provider_usage_connections) THEN
    RAISE EXCEPTION 'provider connection records exist; retain the table and roll back application code only';
  END IF;
END $$;
DROP TABLE provider_usage_connections;
DROP FUNCTION provider_usage_connections_immutable();
COMMIT;
