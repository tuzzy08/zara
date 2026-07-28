import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

import type { PstnAdmissionReasonCode } from "./pstn-call-admission";
import type {
  PstnCapacityRejectionRepository,
} from "./pstn-capacity-rejection.repository";

@Injectable()
export class PstnCapacityRejectionService {
  constructor(
    private readonly repository: PstnCapacityRejectionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(input: {
    tenantId: string;
    callSessionId: string;
    reasonCode: PstnAdmissionReasonCode;
  }) {
    const id = createHash("sha256")
      .update(`${input.tenantId}\0${input.callSessionId}\0${input.reasonCode}`)
      .digest("hex");
    await this.repository.insert({
      id,
      tenantId: input.tenantId,
      reasonCode: input.reasonCode,
      occurredAt: this.now().toISOString(),
    });
  }

  async listForTenant(tenantId: string, limit: number) {
    const records = await this.repository.listForTenant(
      tenantId,
      Math.max(1, Math.min(limit, 50)),
    );
    return records.map(({ occurredAt, reasonCode }) => ({
      occurredAt,
      reasonCode,
    }));
  }

  async listRecent(limit: number) {
    const records = await this.repository.listRecent(
      Math.max(1, Math.min(limit, 100)),
    );
    return records.map(({ tenantId, occurredAt, reasonCode }) => ({
      tenantId,
      occurredAt,
      reasonCode,
    }));
  }
}
