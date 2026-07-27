import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.ZARA_TEST_POSTGRES_URL;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe.skipIf(connectionString === undefined)("telephony migration rolling compatibility", () => {
  let pool: Pool;
  const tenantId = `migration-0012-${randomUUID()}`;

  beforeAll(async () => {
    const { Pool: PostgresPool } = await import("pg");
    pool = new PostgresPool({ connectionString, max: 2 });
    await pool.query(
      `insert into tenants (id, slug, name, status, default_locale, created_at, updated_at)
       values ($1, $1, $1, 'active', 'en', current_timestamp, current_timestamp)`,
      [tenantId],
    );
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query("delete from tenants where id = $1", [tenantId]);
      await pool.end();
    }
  });

  it("keeps the legacy dedupe table writable through migration and rollback", async () => {
    const migration = await readFile(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0012_superb_stellaris.sql",
      ),
      "utf8",
    );
    const rollback = await readFile(
      resolve(
        repositoryRoot,
        "docs/Runbooks/rollback-0012-obsolete-webhook-dedupe.sql",
      ),
      "utf8",
    );

    await pool.query(migration);
    await pool.query(
      `insert into telephony_processed_webhook_events (
         id, tenant_id, event_sid, processed_at
       ) values ($1, $2, $3, current_timestamp)`,
      [`${tenantId}:after-migration`, tenantId, "EV-after-migration"],
    );

    await pool.query(rollback);
    await pool.query(
      `insert into telephony_processed_webhook_events (
         id, tenant_id, event_sid, processed_at
       ) values ($1, $2, $3, current_timestamp)`,
      [`${tenantId}:after-rollback`, tenantId, "EV-after-rollback"],
    );

    await expect(
      pool.query(
        `select event_sid
         from telephony_processed_webhook_events
         where tenant_id = $1
         order by event_sid`,
        [tenantId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { event_sid: "EV-after-migration" },
        { event_sid: "EV-after-rollback" },
      ],
    });
  });

  it("repairs databases where the previous destructive migration already ran", async () => {
    const remediation = await readFile(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0013_telephony_outbound_abuse_posture.sql",
      ),
      "utf8",
    );
    await pool.query('drop table "telephony_processed_webhook_events" cascade');

    await pool.query(remediation);
    await pool.query(
      `insert into telephony_processed_webhook_events (
         id, tenant_id, event_sid, processed_at
       ) values ($1, $2, $3, current_timestamp)`,
      [`${tenantId}:after-repair`, tenantId, "EV-after-repair"],
    );

    await expect(
      pool.query(
        `select event_sid
         from telephony_processed_webhook_events
         where tenant_id = $1`,
        [tenantId],
      ),
    ).resolves.toMatchObject({
      rows: [{ event_sid: "EV-after-repair" }],
    });
  });

  it("rolls back only the additive abuse marker after rejecting active blocks", async () => {
    const migration = await readFile(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0013_telephony_outbound_abuse_posture.sql",
      ),
      "utf8",
    );
    const rollback = await readFile(
      resolve(
        repositoryRoot,
        "docs/Runbooks/rollback-0013-telephony-outbound-abuse-posture.sql",
      ),
      "utf8",
    );
    const connectionId = `${tenantId}:rollback-0013`;
    const client = await pool.connect();

    try {
      await client.query(migration);
      await client.query(
        `insert into telephony_connections (
           id, tenant_id, label, ownership_mode, provider, region, status,
           health_status, recording_policy, block_routing_on_health_failure,
           webhook_status, created_by, outbound_abuse_blocked
         ) values (
           $1, $2, 'Rollback 0013', 'byo_provider_account', 'twilio', 'us1',
           'disabled', 'failed', '{}'::jsonb, true, 'configured',
           'migration-check', true
         )`,
        [connectionId, tenantId],
      );

      await expect(client.query(rollback)).rejects.toThrow(
        "Rollback blocked: outbound abuse posture is active",
      );
      await client.query("rollback");

      await client.query(
        `update telephony_connections
         set outbound_abuse_blocked = false
         where tenant_id = $1 and id = $2`,
        [tenantId, connectionId],
      );
      await client.query(rollback);
      await client.query(
        `insert into telephony_processed_webhook_events (
           id, tenant_id, event_sid, processed_at
         ) values ($1, $2, $3, current_timestamp)`,
        [
          `${tenantId}:after-0013-rollback`,
          tenantId,
          "EV-after-0013-rollback",
        ],
      );

      await expect(
        client.query(
          `select
             to_regclass('public.telephony_processed_webhook_events') as compatibility_table,
             exists (
               select 1
               from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'telephony_connections'
                 and column_name = 'outbound_abuse_blocked'
             ) as has_outbound_abuse_blocked,
             (
               select count(*)
               from telephony_processed_webhook_events
               where tenant_id = $1 and event_sid = $2
             ) as compatibility_write_count`,
          [tenantId, "EV-after-0013-rollback"],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            compatibility_table: "telephony_processed_webhook_events",
            has_outbound_abuse_blocked: false,
            compatibility_write_count: "1",
          },
        ],
      });
    } finally {
      await client.query("rollback");
      await client.query(migration);
      client.release();
    }
  });

  it("restores the pre-0011 global identities and accepts previous-revision writes", async () => {
    const rollback = await readFile(
      resolve(
        repositoryRoot,
        "docs/Runbooks/rollback-0011-telephony-tenant-composite-identities.sql",
      ),
      "utf8",
    );
    const migration = await readFile(
      resolve(
        repositoryRoot,
        "apps/api/src/database/migrations/0011_telephony_tenant_composite_identities.sql",
      ),
      "utf8",
    );
    const callId = `${tenantId}:rollback-0011`;
    const connectionId = `${callId}:connection`;
    const client = await pool.connect();
    let rollbackApplied = false;

    try {
      await client.query(
        `insert into telephony_connections (
           id, tenant_id, label, ownership_mode, provider, region, status,
           health_status, recording_policy, block_routing_on_health_failure,
           webhook_status, created_by
         ) values (
           $1, $2, 'Rollback 0011', 'byo_provider_account', 'twilio', 'us1',
           'active', 'healthy', '{}'::jsonb, true, 'configured',
           'migration-check'
         )`,
        [connectionId, tenantId],
      );
      await client.query(
        `insert into telephony_dispatches (
           id, tenant_id, direction, disposition, reason, call_session_id,
           connection_id, recording, to_phone_number, from_phone_number,
           created_at, source
         ) values (
           $1, $2, 'inbound', 'routed', 'rollback-0011', $3,
           $4, '{}'::jsonb, '+15555550100', '+15555550101',
           current_timestamp, 'twilio'
         )`,
        [`${callId}:dispatch`, tenantId, callId, connectionId],
      );
      await client.query(
        `insert into telephony_execution_sessions (
           id, tenant_id, dispatch_id, call_session_id, connection_id, provider,
           ownership_mode, direction, status, to_phone_number,
           from_phone_number, test_call, bridge_kind, bridge_target,
           media_path, diagnostics, lifecycle_state, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, 'twilio', 'byo_provider_account',
           'inbound', 'active', '+15555550100', '+15555550101',
           false, 'media-stream', 'rollback-target',
           'pstn-premium-realtime', '[]'::jsonb,
           '{"stage":"active","sequence":1}'::jsonb,
           current_timestamp, current_timestamp
         )`,
        [
          `${callId}:session`,
          tenantId,
          `${callId}:dispatch`,
          callId,
          connectionId,
        ],
      );

      await client.query(rollback);
      rollbackApplied = true;
      await client.query(
        `insert into telephony_execution_commands (
           id, tenant_id, session_id, dispatch_id, call_session_id,
           provider, action, status, target, payload, requested_at
         ) values (
           $1, $2, $3, $4, $5, 'twilio', 'hangup', 'requested',
           'caller', '{}'::jsonb, current_timestamp
         )`,
        [
          `${callId}:command`,
          tenantId,
          `${callId}:session`,
          `${callId}:dispatch`,
          callId,
        ],
      );
      await client.query(
        `insert into telephony_call_control_events (
           id, tenant_id, dispatch_id, call_session_id, event_type,
           at, summary, payload
         ) values (
           $1, $2, $3, $4, 'hangup_requested',
           current_timestamp, 'Previous revision control write',
           '{}'::jsonb
         )`,
        [
          `${callId}:control`,
          tenantId,
          `${callId}:dispatch`,
          callId,
        ],
      );

      await expect(
        client.query(
          `select
             (
               select string_agg(attribute.attname, ',' order by key.ordinality)
               from pg_constraint constraint_record
               cross join lateral unnest(constraint_record.conkey)
                 with ordinality as key(attribute_number, ordinality)
               join pg_attribute attribute
                 on attribute.attrelid = constraint_record.conrelid
                and attribute.attnum = key.attribute_number
               where constraint_record.conrelid =
                 'telephony_execution_commands'::regclass
                 and constraint_record.contype = 'p'
             ) as execution_command_primary_key_columns,
             (
               select string_agg(attribute.attname, ',' order by key.ordinality)
               from pg_constraint constraint_record
               cross join lateral unnest(constraint_record.conkey)
                 with ordinality as key(attribute_number, ordinality)
               join pg_attribute attribute
                 on attribute.attrelid = constraint_record.conrelid
                and attribute.attnum = key.attribute_number
               where constraint_record.conrelid =
                 'telephony_call_control_events'::regclass
                 and constraint_record.contype = 'p'
             ) as call_control_primary_key_columns,
             (
               select count(*)
               from telephony_execution_commands
               where id = $1
             ) as previous_revision_command_write_count,
             (
               select count(*)
               from telephony_call_control_events
               where id = $2
             ) as previous_revision_control_write_count`,
          [`${callId}:command`, `${callId}:control`],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            execution_command_primary_key_columns: "id",
            call_control_primary_key_columns: "id",
            previous_revision_command_write_count: "1",
            previous_revision_control_write_count: "1",
          },
        ],
      });
    } finally {
      try {
        await client.query("rollback");
        await client.query(
          `delete from telephony_call_control_events
           where tenant_id = $1 and call_session_id = $2`,
          [tenantId, callId],
        );
        await client.query(
          `delete from telephony_execution_commands
           where tenant_id = $1 and call_session_id = $2`,
          [tenantId, callId],
        );
        await client.query(
          `delete from telephony_execution_sessions
           where tenant_id = $1 and call_session_id = $2`,
          [tenantId, callId],
        );
        await client.query(
          `delete from telephony_dispatches
           where tenant_id = $1 and call_session_id = $2`,
          [tenantId, callId],
        );
        await client.query(
          `delete from telephony_connections
           where tenant_id = $1 and id = $2`,
          [tenantId, connectionId],
        );
        if (rollbackApplied) {
          await client.query(migration);
        }
      } finally {
        client.release();
      }
    }
  });
});
