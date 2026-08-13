import { Injectable, Logger } from "@nestjs/common";

type DeliveryOutcome = "delivered" | "retried" | "dead_lettered";

@Injectable()
export class BillingOutboxObservability {
  private readonly logger = new Logger(BillingOutboxObservability.name);
  private delivered = 0;
  private retried = 0;
  private deadLettered = 0;
  private lateEvents = 0;
  private mismatches = 0;
  private deadLetterAlerts = 0;
  private lateUsageAlerts = 0;

  recordDelivery(outcome: DeliveryOutcome) {
    if (outcome === "delivered") {
      this.delivered += 1;
      return;
    }
    if (outcome === "retried") {
      this.retried += 1;
      return;
    }
    this.deadLettered += 1;
    this.deadLetterAlerts += 1;
    this.logger.error("[billing] polar_outbox_dead_letter_alert");
  }

  recordReconciliation(input: { lateCount: number; mismatchCount: number }) {
    this.lateEvents += input.lateCount;
    this.mismatches += input.mismatchCount;
    if (input.lateCount > 0) {
      this.lateUsageAlerts += 1;
      this.logger.warn("[billing] polar_usage_late_alert");
    }
  }

  getSnapshot() {
    return {
      deliveries: {
        delivered: this.delivered,
        retried: this.retried,
        deadLettered: this.deadLettered,
      },
      reconciliation: {
        lateEvents: this.lateEvents,
        mismatches: this.mismatches,
      },
      alerts: {
        deadLetter: this.deadLetterAlerts,
        lateUsage: this.lateUsageAlerts,
      },
    };
  }
}
