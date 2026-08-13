import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";

import { BillingCustomerStateReconciliationService } from "./billing-customer-state-reconciliation.service";

interface CustomerStateReconciliationRuntime {
  now(): Date;
  setInterval(callback: () => void | Promise<void>, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const BILLING_CUSTOMER_STATE_RECONCILIATION_RUNTIME = Symbol(
  "BILLING_CUSTOMER_STATE_RECONCILIATION_RUNTIME",
);

const intervalMs = 15 * 60_000;
const systemRuntime: CustomerStateReconciliationRuntime = {
  now: () => new Date(),
  setInterval(callback, delayMs) {
    const handle = setInterval(() => void callback(), delayMs);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

@Injectable()
export class BillingCustomerStateReconciliationScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private intervalHandle: unknown;
  private activePass: Promise<void> | undefined;
  private readonly logger = new Logger(BillingCustomerStateReconciliationScheduler.name);

  constructor(
    @Inject(BillingCustomerStateReconciliationService)
    private readonly reconciliation: Pick<BillingCustomerStateReconciliationService, "runOnce">,
    @Optional()
    @Inject(BILLING_CUSTOMER_STATE_RECONCILIATION_RUNTIME)
    private readonly runtime: CustomerStateReconciliationRuntime = systemRuntime,
  ) {}

  async onApplicationBootstrap() {
    await this.runNow();
    this.intervalHandle = this.runtime.setInterval(() => this.runNow(), intervalMs);
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
    const pass = this.reconcile();
    this.activePass = pass;
    return pass.finally(() => {
      if (this.activePass === pass) this.activePass = undefined;
    });
  }

  private async reconcile() {
    try {
      await this.reconciliation.runOnce(this.runtime.now().toISOString());
    } catch {
      this.logger.error("[billing] polar_customer_state_reconciliation_failed");
    }
  }
}
