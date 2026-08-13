import type { BillingPolarClient } from "./polar-billing.client";
import type {
  BillingOutboxEntry,
  PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";
import type { BillingOutboxObservability } from "./billing-outbox-observability";

type OutboxRepository = Pick<
  PostgresBillingLedgerRepository,
  "claimDueOutbox" | "recoverStaleOutbox" | "markOutboxDelivered" | "markOutboxFailed"
>;

type PolarUsageClient = Pick<BillingPolarClient, "ingestUsageEvent">;

export interface BillingPolarOutboxWorkerConfig {
  deliveryEnabled: boolean;
  batchSize: number;
  maxAttempts: number;
  retryDelayMs: number;
  releaseId: string;
  processingTimeoutMs?: number | undefined;
}

export interface BillingChargeDeliveryGuard {
  assertDeliveryAllowed(now: string): Promise<unknown>;
}

interface BillingOutboxClock {
  now(): string;
}

const systemClock: BillingOutboxClock = {
  now: () => new Date().toISOString(),
};

export class BillingPolarOutboxWorker {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly polar: PolarUsageClient,
    private readonly config: BillingPolarOutboxWorkerConfig,
    private readonly observability?: Pick<BillingOutboxObservability, "recordDelivery">,
    private readonly releaseGuard?: BillingChargeDeliveryGuard,
    private readonly clock: BillingOutboxClock = systemClock,
  ) {}

  async runOnce(now: string) {
    if (!this.config.deliveryEnabled) {
      return emptyResult(true);
    }
    if (this.releaseGuard === undefined) {
      throw new Error("The production charge-release gate is not configured.");
    }
    await this.releaseGuard.assertDeliveryAllowed(now);
    await this.repository.recoverStaleOutbox(now);
    const processingLeaseUntil = new Date(
      Date.parse(now) + (this.config.processingTimeoutMs ?? 300_000),
    ).toISOString();
    const events = await this.repository.claimDueOutbox(
      now,
      this.config.batchSize,
      processingLeaseUntil,
      this.config.releaseId,
    );
    let delivered = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const event of events) {
      await this.releaseGuard.assertDeliveryAllowed(this.clock.now());
      try {
        const payload = parseUsagePayload(event);
        await this.polar.ingestUsageEvent({
          externalCustomerId: payload.externalCustomerId,
          externalId: payload.externalEventId,
          name: payload.meterKey,
          units: payload.quantity,
          timestamp: payload.occurredAt,
          metadata: payload.metadata,
        });
        await this.repository.markOutboxDelivered(
          event.organizationId,
          event.id,
          now,
        );
        this.observability?.recordDelivery("delivered");
        delivered += 1;
      } catch (error) {
        const deadLetter = event.attemptCount >= this.config.maxAttempts;
        await this.repository.markOutboxFailed({
          organizationId: event.organizationId,
          id: event.id,
          error: error instanceof Error ? error.message : "Polar delivery failed.",
          nextAttemptAt: new Date(
            Date.parse(now) + this.config.retryDelayMs * 2 ** (event.attemptCount - 1),
          ).toISOString(),
          deadLetter,
        });
        if (deadLetter) {
          this.observability?.recordDelivery("dead_lettered");
          deadLettered += 1;
        } else {
          this.observability?.recordDelivery("retried");
          retried += 1;
        }
      }
    }
    return {
      claimed: events.length,
      delivered,
      retried,
      deadLettered,
      disabled: false,
    };
  }
}

function emptyResult(disabled: boolean) {
  return { claimed: 0, delivered: 0, retried: 0, deadLettered: 0, disabled };
}

function parseUsagePayload(event: BillingOutboxEntry) {
  const payload = event.payload;
  const meterKey = requireText(payload.meterKey, "meterKey");
  const deliveryMode = requireText(payload.deliveryMode, "deliveryMode");
  const creditEntryId = optionalText(payload.creditEntryId);
  const metadata =
    creditEntryId === undefined
      ? {
          ledgerEntryId: requireText(payload.ledgerEntryId, "ledgerEntryId"),
          deliveryMode,
        }
      : {
          creditEntryId,
          sessionId: requireText(payload.sessionId, "sessionId"),
          deliveryMode,
        };
  if (creditEntryId !== undefined && meterKey !== "payg_charge_minor") {
    throw new Error("PAYG credit entries must use the payg_charge_minor meter.");
  }
  return {
    externalCustomerId: requireText(payload.externalCustomerId, "externalCustomerId"),
    externalEventId: requireText(payload.externalEventId, "externalEventId"),
    meterKey,
    quantity: requireInteger(payload.quantity, "quantity"),
    occurredAt: requireText(payload.occurredAt, "occurredAt"),
    metadata,
  };
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Outbox payload ${field} is required.`);
  }
  return value;
}

function requireInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Outbox payload ${field} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
