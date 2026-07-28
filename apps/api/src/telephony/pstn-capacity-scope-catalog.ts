import type { Pool } from "pg";

export const PSTN_CAPACITY_SCOPE_CATALOG = Symbol(
  "PSTN_CAPACITY_SCOPE_CATALOG",
);

export interface PstnCapacityScopeCatalogSnapshot {
  tenants: string[];
  providerAccounts: Array<{
    provider: string;
    providerAccountId: string;
    health: "healthy" | "degraded" | "unavailable";
  }>;
  providerHealth: Record<
    string,
    "healthy" | "degraded" | "unavailable"
  >;
  workers: string[];
  page: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface PstnCapacityScopeCatalog {
  listScopes(input?: {
    offset?: number;
  }): Promise<PstnCapacityScopeCatalogSnapshot>;
}

export interface PstnCapacityWorkerDirectory {
  listReadyWorkerIds(): Promise<string[]>;
}

export class InMemoryPstnCapacityScopeCatalog
  implements PstnCapacityScopeCatalog
{
  async listScopes(
    input: { offset?: number } = {},
  ): Promise<PstnCapacityScopeCatalogSnapshot> {
    return {
      tenants: [],
      providerAccounts: [],
      providerHealth: {},
      workers: [],
      page: {
        offset: input.offset ?? 0,
        limit: scopePageSize,
        hasMore: false,
      },
    };
  }
}

export class PostgresPstnCapacityScopeCatalog
  implements PstnCapacityScopeCatalog
{
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly workerDirectory: PstnCapacityWorkerDirectory,
  ) {}

  async listScopes(
    input: { offset?: number } = {},
  ): Promise<PstnCapacityScopeCatalogSnapshot> {
    const offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("PSTN capacity scope offset is invalid.");
    }
    const [tenants, providerAccounts, providerHealth, workers] =
      await Promise.all([
      this.pool.query<{ id: string }>(
        `select id
         from tenants
         where status = 'active'
         order by id
         limit ${scopePageSize + 1}
         offset ${offset}`,
      ),
      this.pool.query<{
        id: string;
        provider: string;
        external_reference: string | null;
        status: string;
        health_status: string;
        block_routing_on_health_failure: boolean;
      }>(
        `select
           id,
           provider,
           external_reference,
           status,
           health_status,
           block_routing_on_health_failure
         from telephony_connections
         order by provider, id
         limit ${scopePageSize + 1}
         offset ${offset}`,
      ),
      this.pool.query<{
        provider: string;
        health_rank: number | string;
      }>(
        `select
           provider,
           max(
             case
               when status in ('disabled', 'draft')
                 or (health_status = 'failed' and block_routing_on_health_failure)
                 then 2
               when status = 'degraded'
                 or health_status in ('warning', 'failed', 'unknown')
                 then 1
               else 0
             end
           ) as health_rank
         from telephony_connections
         group by provider
         order by provider`,
      ),
      this.workerDirectory.listReadyWorkerIds(),
    ]);
    const workerPage = [...new Set(workers)]
      .sort()
      .slice(offset, offset + scopePageSize + 1);
    const hasMore =
      tenants.rows.length > scopePageSize ||
      providerAccounts.rows.length > scopePageSize ||
      workerPage.length > scopePageSize;
    return {
      tenants: tenants.rows.slice(0, scopePageSize).map((row) => row.id),
      providerAccounts: providerAccounts.rows
        .slice(0, scopePageSize)
        .map((row) => ({
          provider: row.provider,
          providerAccountId: row.external_reference ?? row.id,
          health: resolveProviderAccountHealth(row),
        })),
      providerHealth: Object.fromEntries(
        providerHealth.rows.map((row) => [
          row.provider,
          resolveProviderHealthRank(row.health_rank),
        ]),
      ),
      workers: workerPage.slice(0, scopePageSize),
      page: {
        offset,
        limit: scopePageSize,
        hasMore,
      },
    };
  }
}

const scopePageSize = 512;

function resolveProviderHealthRank(value: number | string) {
  const rank = Number(value);
  if (rank >= 2) return "unavailable" as const;
  if (rank === 1) return "degraded" as const;
  return "healthy" as const;
}

function resolveProviderAccountHealth(row: {
  status: string;
  health_status: string;
  block_routing_on_health_failure: boolean;
}) {
  if (
    row.status === "disabled" ||
    row.status === "draft" ||
    (row.health_status === "failed" && row.block_routing_on_health_failure)
  ) {
    return "unavailable" as const;
  }
  if (
    row.status === "degraded" ||
    row.health_status === "warning" ||
    row.health_status === "failed" ||
    row.health_status === "unknown"
  ) {
    return "degraded" as const;
  }
  return "healthy" as const;
}
