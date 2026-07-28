import type {
  PstnCapacityPolicy,
  PstnCapacityPolicyAuditEntry,
} from "./pstn-capacity-policy.models";

export const PSTN_CAPACITY_POLICY_REPOSITORY = Symbol(
  "PSTN_CAPACITY_POLICY_REPOSITORY",
);

export interface PstnCapacityPolicyRepository {
  load(): Promise<PstnCapacityPolicy | null>;
  save(input: {
    expectedVersion: number;
    policy: PstnCapacityPolicy;
    audit: PstnCapacityPolicyAuditEntry;
  }): Promise<boolean>;
  listAudit(limit: number): Promise<PstnCapacityPolicyAuditEntry[]>;
}

export class InMemoryPstnCapacityPolicyRepository
  implements PstnCapacityPolicyRepository
{
  private policy: PstnCapacityPolicy | null = null;
  private readonly audit: PstnCapacityPolicyAuditEntry[] = [];

  async load() {
    return this.policy === null ? null : structuredClone(this.policy);
  }

  async save(input: {
    expectedVersion: number;
    policy: PstnCapacityPolicy;
    audit: PstnCapacityPolicyAuditEntry;
  }) {
    const currentVersion = this.policy?.version ?? 1;
    if (currentVersion !== input.expectedVersion) {
      return false;
    }
    this.policy = structuredClone(input.policy);
    this.audit.unshift(structuredClone(input.audit));
    return true;
  }

  async listAudit(limit: number) {
    return structuredClone(this.audit.slice(0, limit));
  }
}
