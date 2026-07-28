import type { Pool } from "pg";

import type { PstnAdmissionReasonCode } from "./pstn-call-admission";
import type {
  PstnCapacityRejectionRecord,
  PstnCapacityRejectionRepository,
} from "./pstn-capacity-rejection.repository";

export class PostgresPstnCapacityRejectionRepository
  implements PstnCapacityRejectionRepository
{
  constructor(private readonly pool: Pool) {}

  async insert(record: PstnCapacityRejectionRecord) {
    await this.pool.query(
      `insert into pstn_capacity_rejections (
         id,
         tenant_id,
         reason_code,
         occurred_at
       )
       values ($1, $2, $3, $4::timestamptz)
       on conflict (id) do nothing`,
      [
        record.id,
        record.tenantId,
        record.reasonCode,
        record.occurredAt,
      ],
    );
  }

  async listForTenant(tenantId: string, limit: number) {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      reason_code: PstnAdmissionReasonCode;
      occurred_at: Date | string;
    }>(
      `select id, tenant_id, reason_code, occurred_at
       from pstn_capacity_rejections
       where tenant_id = $1
       order by occurred_at desc
       limit $2`,
      [tenantId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      reasonCode: row.reason_code,
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : new Date(row.occurred_at).toISOString(),
    }));
  }

  async listRecent(limit: number) {
    const result = await this.pool.query<{
      id: string;
      tenant_id: string;
      reason_code: PstnAdmissionReasonCode;
      occurred_at: Date | string;
    }>(
      `select id, tenant_id, reason_code, occurred_at
       from pstn_capacity_rejections
       order by occurred_at desc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      reasonCode: row.reason_code,
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : new Date(row.occurred_at).toISOString(),
    }));
  }
}
