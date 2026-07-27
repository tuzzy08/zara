DO $$
DECLARE
  primary_key_name text;
BEGIN
  SELECT constraint_name
  INTO primary_key_name
  FROM information_schema.table_constraints
  WHERE table_schema = current_schema()
    AND table_name = 'telephony_call_control_events'
    AND constraint_type = 'PRIMARY KEY';

  IF primary_key_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE "telephony_call_control_events" DROP CONSTRAINT %I',
      primary_key_name
    );
  END IF;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  primary_key_name text;
BEGIN
  SELECT constraint_name
  INTO primary_key_name
  FROM information_schema.table_constraints
  WHERE table_schema = current_schema()
    AND table_name = 'telephony_execution_commands'
    AND constraint_type = 'PRIMARY KEY';

  IF primary_key_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE "telephony_execution_commands" DROP CONSTRAINT %I',
      primary_key_name
    );
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "telephony_call_control_events"
  ADD CONSTRAINT "telephony_call_control_events_tenant_id_id_pk"
  PRIMARY KEY ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "telephony_execution_commands"
  ADD CONSTRAINT "telephony_execution_commands_tenant_id_id_pk"
  PRIMARY KEY ("tenant_id","id");
