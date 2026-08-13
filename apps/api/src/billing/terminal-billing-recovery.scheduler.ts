import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";

import { TrustedTerminalBillingRecoveryService } from "./trusted-terminal-billing-recovery.service";

interface TerminalBillingRecoverySchedulerRuntime {
  now(): Date;
  setInterval(callback: () => void | Promise<void>, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export const TERMINAL_BILLING_RECOVERY_SCHEDULER_RUNTIME = Symbol(
  "TERMINAL_BILLING_RECOVERY_SCHEDULER_RUNTIME",
);

const systemRuntime: TerminalBillingRecoverySchedulerRuntime = {
  now: () => new Date(),
  setInterval(callback, intervalMs) {
    const handle = setInterval(() => void callback(), intervalMs);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

@Injectable()
export class TerminalBillingRecoveryScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private intervalHandle: unknown;
  private activePass: Promise<void> | undefined;
  private readonly logger = new Logger(TerminalBillingRecoveryScheduler.name);

  constructor(
    @Inject(TrustedTerminalBillingRecoveryService)
    private readonly recovery: Pick<TrustedTerminalBillingRecoveryService, "runDue">,
    @Optional()
    @Inject(TERMINAL_BILLING_RECOVERY_SCHEDULER_RUNTIME)
    private readonly runtime: TerminalBillingRecoverySchedulerRuntime = systemRuntime,
  ) {}

  async onApplicationBootstrap() {
    await this.runNow();
    this.intervalHandle = this.runtime.setInterval(() => this.runNow(), 30_000);
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
    const pass = this.recoverDueJobs();
    this.activePass = pass;
    return pass.finally(() => {
      if (this.activePass === pass) this.activePass = undefined;
    });
  }

  private async recoverDueJobs() {
    try {
      await this.recovery.runDue(this.runtime.now().toISOString());
    } catch {
      this.logger.error("[billing] terminal_recovery_pass_failed");
    }
  }
}
