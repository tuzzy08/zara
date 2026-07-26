import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";

import { PstnCapacityObservability } from "../runtime-observability/pstn-capacity-observability";
import {
  TELEPHONY_INCREMENTAL_REPOSITORY,
  type TelephonyPremiumDispatchRepository,
} from "../telephony/telephony-incremental.repository";

interface FinalizationReconcilerRuntime {
  now(): Date;
  setInterval(
    callback: () => void | Promise<void>,
    intervalMs: number,
  ): unknown;
  clearInterval(handle: unknown): void;
}

const reconciliationIntervalMs = 30_000;
const reconciliationBatchLimit = 100;
export const PSTN_PREMIUM_FINALIZATION_RECONCILER_RUNTIME = Symbol(
  "PSTN_PREMIUM_FINALIZATION_RECONCILER_RUNTIME",
);

const systemRuntime: FinalizationReconcilerRuntime = {
  now: () => new Date(),
  setInterval(callback, intervalMs) {
    const handle = setInterval(() => void callback(), intervalMs);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

@Injectable()
export class PstnPremiumFinalizationReconciler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private intervalHandle: unknown;
  private activePass: Promise<void> | undefined;
  private readonly logger = new Logger(
    PstnPremiumFinalizationReconciler.name,
  );

  constructor(
    @Inject(TELEPHONY_INCREMENTAL_REPOSITORY)
    private readonly repository: Pick<
      TelephonyPremiumDispatchRepository,
      "reconcileExpiredPremiumCallOwners"
    >,
    @Optional()
    @Inject(PstnCapacityObservability)
    private readonly observability?: PstnCapacityObservability,
    @Optional()
    @Inject(PSTN_PREMIUM_FINALIZATION_RECONCILER_RUNTIME)
    private readonly runtime: FinalizationReconcilerRuntime = systemRuntime,
  ) {}

  async onApplicationBootstrap() {
    await this.reconcileNow();
    this.intervalHandle = this.runtime.setInterval(
      () => this.reconcileNow(),
      reconciliationIntervalMs,
    );
  }

  async beforeApplicationShutdown() {
    if (this.intervalHandle !== undefined) {
      this.runtime.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.activePass;
  }

  reconcileNow() {
    if (this.activePass !== undefined) {
      return this.activePass;
    }
    const pass = this.performReconciliation();
    this.activePass = pass;
    return pass.finally(() => {
      if (this.activePass === pass) {
        this.activePass = undefined;
      }
    });
  }

  private async performReconciliation() {
    try {
      const result = await this.repository.reconcileExpiredPremiumCallOwners({
        before: this.runtime.now().toISOString(),
        limit: reconciliationBatchLimit,
      });
      for (let index = 0; index < result.reconciledCount; index += 1) {
        this.observability?.recordFinalization?.({
          source: "lease_reconciler",
          outcome: "reconciled",
        });
      }
      if (result.reconciledCount > 0) {
        this.logger.warn(
          `[pstn-realtime-worker] expired_owner_reconciled ${JSON.stringify({
            reconciledCount: result.reconciledCount,
          })}`,
        );
      }
    } catch {
      this.observability?.recordFinalization?.({
        source: "lease_reconciler",
        outcome: "failed",
      });
      this.logger.error(
        "[pstn-realtime-worker] expired_owner_reconciliation_failed",
      );
    }
  }
}
