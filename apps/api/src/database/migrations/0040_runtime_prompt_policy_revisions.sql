CREATE TABLE "runtime_prompt_policy_revisions" (
  "version" integer PRIMARY KEY NOT NULL,
  "policy" jsonb NOT NULL,
  "policy_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_prompt_policy_revision_version_check"
    CHECK (version >= 1 AND (policy->>'version')::integer = version),
  CONSTRAINT "runtime_prompt_policy_revision_hash_check"
    CHECK (policy_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_prompt_policy_current" (
  "singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "version" integer NOT NULL REFERENCES "runtime_prompt_policy_revisions"("version"),
  CONSTRAINT "runtime_prompt_policy_current_singleton_check" CHECK (singleton)
);
--> statement-breakpoint
CREATE TABLE "runtime_prompt_policy_session_pins" (
  "session_key" text PRIMARY KEY NOT NULL,
  "revision" integer NOT NULL REFERENCES "runtime_prompt_policy_revisions"("version"),
  "policy_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_runtime_prompt_policy_revision_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime prompt policy revisions are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER runtime_prompt_policy_revisions_immutable
BEFORE UPDATE OR DELETE ON runtime_prompt_policy_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_prompt_policy_revision_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_runtime_prompt_policy_session_pin_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'runtime prompt policy session pins are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER runtime_prompt_policy_session_pins_immutable
BEFORE UPDATE OR DELETE ON runtime_prompt_policy_session_pins
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_prompt_policy_session_pin_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION initialize_runtime_prompt_policy(
  initial_policy jsonb,
  initial_hash text
) RETURNS void AS $$
DECLARE
  initial_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1516354640, 1869769825);
  IF NOT EXISTS (SELECT 1 FROM runtime_prompt_policy_current WHERE singleton = true) THEN
    initial_version := (initial_policy->>'version')::integer;
    INSERT INTO runtime_prompt_policy_revisions(version, policy, policy_hash)
    VALUES (initial_version, initial_policy, initial_hash);
    INSERT INTO runtime_prompt_policy_current(singleton, version) VALUES (true, initial_version);
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION save_runtime_prompt_policy_revision(
  next_policy jsonb,
  expected_version integer,
  next_hash text
) RETURNS boolean AS $$
DECLARE
  current_version integer;
  next_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(1516354640, 1869769825);
  SELECT version INTO current_version
  FROM runtime_prompt_policy_current
  WHERE singleton = true;
  current_version := COALESCE(current_version, 1);
  next_version := expected_version + 1;

  IF current_version <> expected_version
    OR (next_policy->>'version')::integer <> next_version THEN
    RETURN false;
  END IF;

  INSERT INTO runtime_prompt_policy_revisions(version, policy, policy_hash)
  VALUES (next_version, next_policy, next_hash);
  INSERT INTO runtime_prompt_policy_current(singleton, version)
  VALUES (true, next_version)
  ON CONFLICT (singleton) DO UPDATE SET version = excluded.version;
  RETURN true;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pin_runtime_prompt_policy_revision(target_session_key text)
RETURNS TABLE(revision integer, hash text) AS $$
BEGIN
  INSERT INTO runtime_prompt_policy_session_pins(session_key, revision, policy_hash)
  SELECT target_session_key, current_policy.version, policy.policy_hash
  FROM runtime_prompt_policy_current current_policy
  JOIN runtime_prompt_policy_revisions policy ON policy.version = current_policy.version
  WHERE current_policy.singleton = true
  ON CONFLICT (session_key) DO NOTHING;

  RETURN QUERY
  SELECT session_pin.revision, session_pin.policy_hash
  FROM runtime_prompt_policy_session_pins session_pin
  WHERE session_pin.session_key = target_session_key;
END;
$$ LANGUAGE plpgsql;
