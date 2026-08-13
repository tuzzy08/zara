import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";

import { BillingPolarOutboxWorker } from "./billing-polar-outbox.worker";

interface BillingOutboxSchedulerRuntime {
  now(): Date;
  setInterval(callback: () => void | Promise<void>, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const BILLING_OUTBOX_SCHEDULER_RUNTIME = Symbol(
  "BILLING_OUTBOX_SCHEDULER_RUNTIME",
);

const intervalMs = 30_000;
const systemRuntime: BillingOutboxSchedulerRuntime = {
  now: () => new Date(),
  setInterval(callback, delayMs) {
    const handle = setInterval(() => void callback(), delayMs);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

@Injectable()
export class BillingPolarOutboxScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private intervalHandle: unknown;
  private activePass: Promise<void> | undefined;
  private readonly logger = new Logger(BillingPolarOutboxScheduler.name);

  constructor(
    @Inject(BillingPolarOutboxWorker)
    private readonly worker: Pick<BillingPolarOutboxWorker, "runOnce">,
    @Optional()
    @Inject(BILLING_OUTBOX_SCHEDULER_RUNTIME)
    private readonly runtime: BillingOutboxSchedulerRuntime = systemRuntime,
  ) {}

  async onApplicationBootstrap() {
    await this.runNow();
    this.intervalHandle = this.runtime.setInterval(
      () => this.runNow(),
      intervalMs,
    );
  }

  async beforeApplicationShutdown() {
    if (this.intervalHandle !== undefined) {
      this.runtime.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.activePass;
  }

  runNow() {
    if (this.activePass !== undefined) {
      return this.activePass;
    }
    const pass = this.deliverDueEvents();
    this.activePass = pass;
    return pass.finally(() => {
      if (this.activePass === pass) {
        this.activePass = undefined;
      }
    });
  }

  private async deliverDueEvents() {
    try {
      await this.worker.runOnce(this.runtime.now().toISOString());
    } catch {
      this.logger.error("[billing] polar_outbox_delivery_failed");
    }
  }
}
