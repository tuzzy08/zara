import { ConflictException } from "@nestjs/common";
import type { Pool } from "pg";

import type {
  IntegrationStateRepository,
  PersistedIntegrationStateRecord,
} from "./integrations-state.repository";

export class PostgresIntegrationStateRepository implements IntegrationStateRepository {
  constructor(private readonly pool: Pool) {}

  async listOrganizationIds() {
    const result = await this.pool.query<{ organization_id: string }>(
      "SELECT organization_id FROM integration_tenant_states ORDER BY organization_id",
    );
    return result.rows.map((row) => row.organization_id);
  }

  async load(organizationId: string): Promise<PersistedIntegrationStateRecord | null> {
    const result = await this.pool.query<{
      state: PersistedIntegrationStateRecord;
      revision: number;
    }>(
      "SELECT state, revision FROM integration_tenant_states WHERE organization_id = $1",
      [organizationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { ...row.state, organizationId, revision: row.revision };
  }

  async save(record: PersistedIntegrationStateRecord) {
    const { revision = 0, ...state } = record;
    const result = revision === 0
      ? await this.pool.query(
        `INSERT INTO integration_tenant_states (organization_id, state, revision)
         VALUES ($1, $2::jsonb, 1) ON CONFLICT (organization_id) DO NOTHING`,
        [record.organizationId, JSON.stringify(state)],
      )
      : await this.pool.query(
        `UPDATE integration_tenant_states SET state = $2::jsonb, revision = revision + 1
         WHERE organization_id = $1 AND revision = $3`,
        [record.organizationId, JSON.stringify(state), revision],
      );
    if (result.rowCount !== 1) {
      throw new ConflictException({
        code: "integration_state_conflict",
        message: "Integration state changed. Reload and retry the operation.",
      });
    }
  }
}
