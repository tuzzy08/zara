import { Inject, Injectable } from "@nestjs/common";

import { AuditLogService } from "../compliance/audit-log.service";
import {
  BILLING_LEDGER_REPOSITORY,
  type PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";

type OutboxOperationsRepository = Pick<
  PostgresBillingLedgerRepository,
  "replayDeadLetter"
>;

@Injectable()
export class BillingOutboxOperationsService {
  constructor(
    @Inject(BILLING_LEDGER_REPOSITORY)
    private readonly repository: OutboxOperationsRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async replayDeadLetter(input: {
    organizationId: string;
    outboxId: string;
    actorUserId: string;
    reason: string;
    occurredAt: string;
  }) {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new Error("A replay reason is required.");
    }
    let event;
    try {
      event = await this.repository.replayDeadLetter({
        organizationId: input.organizationId,
        id: input.outboxId,
        nextAttemptAt: input.occurredAt,
        reason,
      });
    } catch (error) {
      await this.auditLogService.record({
        tenantId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "billing.outbox_replay_rejected",
        target: { type: "billing_outbox", id: input.outboxId },
        outcome: "failed",
        metadata: { reason },
        occurredAt: input.occurredAt,
      });
      throw error;
    }
    await this.auditLogService.record({
      tenantId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "billing.outbox_replayed",
      target: { type: "billing_outbox", id: input.outboxId },
      outcome: "succeeded",
      metadata: { reason, attemptCount: event.attemptCount },
      occurredAt: input.occurredAt,
    });
    return event;
  }
}
