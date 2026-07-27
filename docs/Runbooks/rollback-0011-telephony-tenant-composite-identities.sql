BEGIN;

LOCK TABLE "telephony_execution_commands", "telephony_call_control_events"
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "telephony_execution_commands"
    GROUP BY "id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot restore global telephony execution-command identity: duplicate IDs exist across tenants.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "telephony_call_control_events"
    GROUP BY "id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot restore global telephony call-control event identity: duplicate IDs exist across tenants.';
  END IF;
END
$$;

ALTER TABLE "telephony_execution_commands"
  DROP CONSTRAINT "telephony_execution_commands_tenant_id_id_pk";
ALTER TABLE "telephony_execution_commands"
  ADD CONSTRAINT "telephony_execution_commands_pkey" PRIMARY KEY ("id");

ALTER TABLE "telephony_call_control_events"
  DROP CONSTRAINT "telephony_call_control_events_tenant_id_id_pk";
ALTER TABLE "telephony_call_control_events"
  ADD CONSTRAINT "telephony_call_control_events_pkey" PRIMARY KEY ("id");

COMMIT;
