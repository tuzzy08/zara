import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";

import {
  BillingUsageReconciliationService,
  type BillingDraftInvoiceEvidenceSource,
  type BillingPolarMeterEvidenceSource,
  type BillingProviderUsageEvidenceSource,
  type BillingReconciliationReportRepository,
} from "./billing-usage-reconciliation.service";
import type { BillingProviderEvidenceCollector } from "./billing-production-reconciliation-evidence";

interface BillingDailyReconciliationRuntime {
  now(): Date;
  setInterval(callback: () => void | Promise<void>, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const BILLING_DAILY_RECONCILIATION_RUNTIME = Symbol(
  "BILLING_DAILY_RECONCILIATION_RUNTIME",
);
export const BILLING_DAILY_RECONCILIATION_CONFIG = Symbol(
  "BILLING_DAILY_RECONCILIATION_CONFIG",
);

const dailyIntervalMs = 24 * 60 * 60_000;
const systemRuntime: BillingDailyReconciliationRuntime = {
  now: () => new Date(),
  setInterval(callback, intervalMs) {
    const handle = setInterval(() => void callback(), intervalMs);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

@Injectable()
export class BillingDailyReconciliationRunner {
  constructor(
    private readonly repository: Pick<BillingReconciliationReportRepository, "listTenantCycles">,
    private readonly reconciliation: Pick<BillingUsageReconciliationService, "reconcileTenantCycle">,
    private readonly config: {
      releaseId: string;
      catalogId: string;
      validityMs: number;
    },
    private readonly providerEvidenceCollector?: Pick<
      BillingProviderEvidenceCollector,
      "collectTenantCycle"
    >,
  ) {}

  async runOnce(now: string) {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error("Daily reconciliation time is invalid.");
    const cycles = await this.repository.listTenantCycles(now);
    const failures: unknown[] = [];
    for (const cycle of cycles.filter((item) =>
      item.catalogId === this.config.catalogId
      && Date.parse(item.cycleEndsAt) <= nowMs)) {
      let providerCollectionFailed = false;
      try {
        const collection = await this.providerEvidenceCollector?.collectTenantCycle(cycle);
        providerCollectionFailed = (collection?.failed ?? 0) > 0;
      } catch {
        // Reconciliation must persist explicit missing evidence when a provider is unavailable.
        providerCollectionFailed = true;
      }
      try {
        await this.reconciliation.reconcileTenantCycle({
          ...cycle,
          releaseId: this.config.releaseId,
          runKey: `daily:${this.config.releaseId}:${now.slice(0, 10)}`,
          validUntil: new Date(nowMs + this.config.validityMs).toISOString(),
          providerCollectionFailed,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} daily billing reconciliation report(s) failed.`);
    }
  }
}

@Injectable()
export class BillingDailyReconciliationScheduler
implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private intervalHandle: unknown;
  private activePass: Promise<void> | undefined;
  private readonly logger = new Logger(BillingDailyReconciliationScheduler.name);

  constructor(
    @Inject(BillingDailyReconciliationRunner)
    private readonly runner: Pick<BillingDailyReconciliationRunner, "runOnce">,
    @Optional()
    @Inject(BILLING_DAILY_RECONCILIATION_RUNTIME)
    private readonly runtime: BillingDailyReconciliationRuntime = systemRuntime,
  ) {}

  async onApplicationBootstrap() {
    await this.runNow();
    this.intervalHandle = this.runtime.setInterval(() => this.runNow(), dailyIntervalMs);
  }

  async beforeApplicationShutdown() {
    if (this.intervalHandle !== undefined) {
      this.runtime.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.activePass;
  }

  runNow() {
    if (this.activePass !== undefined) return this.activePass;
    const pass = this.runPass();
    this.activePass = pass;
    return pass.finally(() => {
      if (this.activePass === pass) this.activePass = undefined;
    });
  }

  private async runPass() {
    try {
      await this.runner.runOnce(this.runtime.now().toISOString());
    } catch {
      this.logger.error("[billing] daily_reconciliation_failed");
    }
  }
}

@Injectable()
export class MissingBillingProviderUsageEvidenceSource
implements BillingProviderUsageEvidenceSource {
  async loadTenantCycleEvidence() { return null; }
}

@Injectable()
export class MissingBillingPolarMeterEvidenceSource
implements BillingPolarMeterEvidenceSource {
  async loadTenantCycleEvidence() { return null; }
}

@Injectable()
export class MissingBillingDraftInvoiceEvidenceSource
implements BillingDraftInvoiceEvidenceSource {
  async loadTenantCycleEvidence() { return null; }
}
