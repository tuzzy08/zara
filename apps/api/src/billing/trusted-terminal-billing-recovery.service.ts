import type { TrustedBillingUsageProducer, TrustedTerminalCallFact } from "./trusted-billing-usage-producer";
import type { TrustedPaygTerminalCallFact, TrustedPaygTerminalFinalizationService } from "./trusted-payg-terminal-finalization.service";
import type { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";
import { TerminalBillingRecoveryAlerts } from "./terminal-billing-recovery.alerts";
import {
  TerminalBillingRecoveryRepository,
  type SubscriptionTerminalSettlementFact,
  type TerminalBillingRecoveryJob,
} from "./terminal-billing-recovery.repository";

type UsageEffect = Pick<TrustedBillingUsageProducer, "recordTerminalCall">;
type PaygEffect = Pick<TrustedPaygTerminalFinalizationService, "finalizeTerminalCall">;
type SubscriptionEffect = Pick<TrustedSubscriptionCallLifecycleService, "finalizeByReservationKey">;

export type TrustedTerminalBillingRecoveryInput = {
  id: string;
  idempotencyKey: string;
  usageFact: TrustedTerminalCallFact;
  settlement:
    | { commercialMode: "payg"; fact: TrustedPaygTerminalCallFact }
    | { commercialMode: "subscription"; fact: SubscriptionTerminalSettlementFact };
  now: string;
};

export class TrustedTerminalBillingRecoveryService {
  constructor(
    private readonly jobs: TerminalBillingRecoveryRepository,
    private readonly usage: UsageEffect,
    private readonly payg: PaygEffect,
    private readonly subscription: SubscriptionEffect,
    private readonly alerts: Pick<TerminalBillingRecoveryAlerts, "terminalRecoveryDeadLettered">
      = new TerminalBillingRecoveryAlerts(),
  ) {}

  async submit(input: TrustedTerminalBillingRecoveryInput) {
    assertInput(input);
    const job = await this.jobs.enqueue({
      id: input.id,
      organizationId: input.usageFact.organizationId,
      idempotencyKey: input.idempotencyKey,
      callSessionId: input.usageFact.callSessionId,
      reservationId: reservationId(input.settlement),
      commercialMode: input.settlement.commercialMode,
      usageFact: input.usageFact,
      settlementFact: input.settlement.fact,
      now: input.now,
    });
    if (job.status === "completed") return job;
    await this.tryProcess(job.organizationId, job.idempotencyKey, input.now);
    const stored = await this.jobs.getJob(job.organizationId, job.idempotencyKey);
    if (stored === null) throw new Error("The terminal billing recovery job disappeared.");
    return stored;
  }

  async runDue(now: string) {
    const due = await this.jobs.listDue(now);
    for (const job of due) {
      await this.tryProcess(job.organizationId, job.idempotencyKey, now);
    }
  }

  private async tryProcess(organizationId: string, idempotencyKey: string, now: string) {
    const job = await this.jobs.claimJob(organizationId, idempotencyKey, now);
    if (job === null) return;
    try {
      const settlement = await this.settle(job);
      let usageFact = job.usageFact;
      if (job.commercialMode === "subscription") {
        const paygAppliedMinor = readPaygAppliedMinor(settlement);
        const pinned = await this.jobs.pinPaygAppliedMinor(job, paygAppliedMinor);
        if (!pinned) return;
        usageFact = { ...usageFact, paygAppliedMinor };
      }
      await this.usage.recordTerminalCall(usageFact);
      await this.jobs.markCompleted(job, now);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Terminal billing recovery failed.";
      if (job.attemptCount >= 5) {
        const deadLettered = await this.jobs.markDeadLetter(job, now, message);
        if (deadLettered) {
          this.alerts.terminalRecoveryDeadLettered({
            commercialMode: job.commercialMode,
            attemptCount: job.attemptCount,
          });
        }
      } else {
        await this.jobs.markPending(job, now, message);
      }
    }
  }

  private settle(job: TerminalBillingRecoveryJob) {
    if (job.commercialMode === "payg") {
      return this.payg.finalizeTerminalCall(job.settlementFact as TrustedPaygTerminalCallFact);
    }
    return this.subscription.finalizeByReservationKey(
      job.settlementFact as SubscriptionTerminalSettlementFact,
    );
  }
}

function readPaygAppliedMinor(value: unknown) {
  const amount = value !== null && typeof value === "object"
    ? (value as { paygAppliedMinor?: unknown }).paygAppliedMinor
    : undefined;
  if (!Number.isSafeInteger(amount) || Number(amount) < 0) {
    throw new Error("Subscription finalization did not return a PAYG applied amount.");
  }
  return Number(amount);
}

function reservationId(input: TrustedTerminalBillingRecoveryInput["settlement"]) {
  return input.commercialMode === "payg" ? input.fact.reservationId : input.fact.reservationKey;
}

function assertInput(input: TrustedTerminalBillingRecoveryInput) {
  const usage = input.usageFact;
  const settlement = input.settlement.fact;
  if (!input.id.trim() || !input.idempotencyKey.trim() || !Number.isFinite(Date.parse(input.now))) {
    throw new Error("Terminal billing recovery identity and time are required.");
  }
  if (
    usage.organizationId !== settlement.organizationId
    || usage.callSessionId !== settlementSessionId(input.settlement)
    || usage.outcome !== settlement.outcome
    || usage.commercialMode !== input.settlement.commercialMode
  ) {
    throw new Error("Terminal billing recovery facts do not match.");
  }
  if (input.settlement.commercialMode === "payg") {
    const fact = input.settlement.fact;
    if (
      usage.runtimePath !== fact.runtimePath
      || usage.runtimeSeconds !== fact.runtimeSeconds
      || usage.ownershipMode !== fact.ownershipMode
      || usage.provider !== fact.provider
      || usage.direction !== fact.direction
      || usage.occurredAt !== fact.occurredAt
    ) {
      throw new Error("PAYG terminal billing recovery facts do not match.");
    }
  } else {
    const fact = input.settlement.fact;
    if (
      usage.runtimeSeconds !== fact.actualSeconds
      || usage.providerConnectedSeconds !== fact.providerConnectedSeconds
      || usage.runtimePath !== fact.runtimePath
      || usage.ownershipMode !== fact.ownershipMode
      || usage.provider !== fact.provider
      || usage.direction !== fact.direction
      || usage.catalogId !== fact.catalogId
      || usage.planSlug !== fact.planSlug
      || usage.occurredAt !== fact.now
    ) {
      throw new Error("Subscription terminal billing recovery facts do not match.");
    }
  }
}

function settlementSessionId(settlement: TrustedTerminalBillingRecoveryInput["settlement"]) {
  return settlement.commercialMode === "payg"
    ? settlement.fact.callSessionId
    : settlement.fact.sessionId;
}
