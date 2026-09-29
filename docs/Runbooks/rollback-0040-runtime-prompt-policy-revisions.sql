BEGIN;
LOCK TABLE runtime_prompt_policy_revisions, runtime_prompt_policy_current,
  runtime_prompt_policy_session_pins IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runtime_prompt_policy_session_pins) THEN
    RAISE EXCEPTION 'cannot roll back 0040 while runtime prompt policy session pins exist';
  END IF;

  IF (SELECT count(*) FROM runtime_prompt_policy_revisions) > 1 THEN
    RAISE EXCEPTION 'cannot roll back 0040 after runtime prompt policy revisions were published';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS pin_runtime_prompt_policy_revision(text);
DROP FUNCTION IF EXISTS save_runtime_prompt_policy_revision(jsonb, integer, text);
DROP FUNCTION IF EXISTS initialize_runtime_prompt_policy(jsonb, text);
DROP TRIGGER IF EXISTS runtime_prompt_policy_session_pins_immutable
  ON runtime_prompt_policy_session_pins;
DROP FUNCTION IF EXISTS prevent_runtime_prompt_policy_session_pin_change();
DROP TRIGGER IF EXISTS runtime_prompt_policy_revisions_immutable
  ON runtime_prompt_policy_revisions;
DROP FUNCTION IF EXISTS prevent_runtime_prompt_policy_revision_change();
DROP TABLE runtime_prompt_policy_session_pins;
DROP TABLE runtime_prompt_policy_current;
DROP TABLE runtime_prompt_policy_revisions;
COMMIT;
