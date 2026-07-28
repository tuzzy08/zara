import type { PstnAdmissionReasonCode } from "./pstn-call-admission";

export const PSTN_CAPACITY_REJECTION_REPOSITORY = Symbol(
  "PSTN_CAPACITY_REJECTION_REPOSITORY",
);

export interface PstnCapacityRejectionRecord {
  id: string;
  tenantId: string;
  reasonCode: PstnAdmissionReasonCode;
  occurredAt: string;
}

export interface PstnCapacityRejectionRepository {
  insert(record: PstnCapacityRejectionRecord): Promise<void>;
  listForTenant(
    tenantId: string,
    limit: number,
  ): Promise<PstnCapacityRejectionRecord[]>;
  listRecent(limit: number): Promise<PstnCapacityRejectionRecord[]>;
}

export class InMemoryPstnCapacityRejectionRepository
  implements PstnCapacityRejectionRepository
{
  private readonly records = new Map<string, PstnCapacityRejectionRecord>();

  async insert(record: PstnCapacityRejectionRecord) {
    if (!this.records.has(record.id)) {
      this.records.set(record.id, structuredClone(record));
    }
  }

  async listForTenant(tenantId: string, limit: number) {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async listRecent(limit: number) {
    return [...this.records.values()]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
}
