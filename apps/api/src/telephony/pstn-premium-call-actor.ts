export type PstnPremiumCallActorState =
  | "initializing"
  | "ready"
  | "active"
  | "draining"
  | "handing_off"
  | "stopped"
  | "failed";

export interface PstnPremiumCallActorProvider {
  waitUntilReady(): Promise<void>;
  getBufferedAmountBytes(): number;
  send(message: Record<string, unknown>): number | void;
  close(code?: number, reason?: string): void;
}

interface StartupMedia {
  message: Record<string, unknown>;
  durationMs: number;
  byteLength: number;
}

const defaultReadinessTimeoutMs = 5_000;
const defaultDrainTimeoutMs = 1_000;
const defaultProviderBufferedByteLimit = 256 * 1_024;
const maxStartupDurationMs = 1_000;
const maxStartupBytes = 16 * 1_024;

export class PstnPremiumCallActor {
  private state: PstnPremiumCallActorState = "initializing";
  private readonly startupMedia: StartupMedia[] = [];
  private startupDurationMs = 0;
  private startupBytes = 0;
  private readinessTimer: ReturnType<typeof setTimeout> | undefined;
  private stopPromise: Promise<void> | undefined;
  private started = false;
  private terminalNotified = false;

  constructor(private readonly input: {
    callSessionId: string;
    provider: PstnPremiumCallActorProvider;
    terminateRuntime(): void | Promise<void>;
    closeCaller(code: number, reason: string): void;
    onTerminal?: ((state: "stopped" | "failed") => void) | undefined;
    drain?: (() => void | Promise<void>) | undefined;
    drainTimeoutMs?: number | undefined;
    readinessTimeoutMs?: number | undefined;
    providerBufferedByteLimit?: number | undefined;
  }) {}

  start() {
    if (this.started) {
      return Promise.resolve();
    }
    this.started = true;
    void this.activateWhenReady();
    return Promise.resolve();
  }

  getState() {
    return this.state;
  }

  appendInbound(media: StartupMedia) {
    if (this.state === "initializing" || this.state === "ready") {
      if (
        this.startupDurationMs + media.durationMs > maxStartupDurationMs
        || this.startupBytes + media.byteLength > maxStartupBytes
      ) {
        const reason = "premium_startup_overflow";
        this.fail(reason);
        throw new Error(reason);
      }
      this.startupMedia.push(media);
      this.startupDurationMs += media.durationMs;
      this.startupBytes += media.byteLength;
      return;
    }

    if (this.state !== "active") {
      throw new Error(`Premium PSTN call '${this.input.callSessionId}' is not accepting media.`);
    }

    this.sendProviderMessage(media.message);
  }

  sendProviderMessage(message: Record<string, unknown>) {
    if (this.state !== "active") {
      throw new Error(`Premium PSTN call '${this.input.callSessionId}' is not active.`);
    }
    this.sendToProvider(message);
  }

  fail(reason: string) {
    if (this.state === "failed" || this.state === "stopped" || this.state === "draining") {
      return;
    }

    this.state = "failed";
    this.clearStartupMedia();
    this.clearReadinessTimer();
    void Promise.resolve(this.input.terminateRuntime()).catch(() => undefined);
    this.closeLegs(1011, reason);
    this.notifyTerminal("failed");
  }

  stop(reason = "pstn_stream_stopped") {
    if (this.stopPromise !== undefined) {
      return this.stopPromise;
    }
    if (this.state === "stopped" || this.state === "failed") {
      return Promise.resolve();
    }

    this.state = "draining";
    this.clearStartupMedia();
    this.clearReadinessTimer();
    this.stopPromise = this.drainAndStop(reason);
    return this.stopPromise;
  }

  private async activateWhenReady() {
    try {
      const readiness = this.input.provider.waitUntilReady();
      const timeout = new Promise<never>((_resolve, reject) => {
        this.readinessTimer = setTimeout(() => {
          reject(new Error("premium_provider_readiness_timeout"));
        }, this.input.readinessTimeoutMs ?? defaultReadinessTimeoutMs);
      });
      await Promise.race([readiness, timeout]);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "premium_provider_readiness_failed");
      return;
    }
    this.clearReadinessTimer();
    if (this.state !== "initializing") {
      return;
    }
    this.state = "ready";

    while (this.startupMedia.length > 0 && this.state === "ready") {
      const media = this.startupMedia.shift();
      if (media === undefined) {
        break;
      }
      this.startupDurationMs -= media.durationMs;
      this.startupBytes -= media.byteLength;
      try {
        this.sendToProvider(media.message);
      } catch {
        return;
      }
    }
    if (this.state === "ready") {
      this.state = "active";
      this.startupDurationMs = 0;
      this.startupBytes = 0;
    }
  }

  private clearStartupMedia() {
    this.startupMedia.length = 0;
    this.startupDurationMs = 0;
    this.startupBytes = 0;
  }

  private clearReadinessTimer() {
    if (this.readinessTimer !== undefined) {
      clearTimeout(this.readinessTimer);
      this.readinessTimer = undefined;
    }
  }

  private sendToProvider(message: Record<string, unknown>) {
    const limit = this.input.providerBufferedByteLimit ?? defaultProviderBufferedByteLimit;
    if (this.input.provider.getBufferedAmountBytes() > limit) {
      this.failAndThrowCongestion();
    }

    const reportedBufferedAmount = this.input.provider.send(message);
    const bufferedAmount = typeof reportedBufferedAmount === "number"
      ? reportedBufferedAmount
      : this.input.provider.getBufferedAmountBytes();
    if (bufferedAmount > limit) {
      this.failAndThrowCongestion();
    }
  }

  private failAndThrowCongestion(): never {
    const reason = "premium_provider_congested";
    this.fail(reason);
    throw new Error(reason);
  }

  private async drainAndStop(reason: string) {
    try {
      await this.waitForDrain();
      await this.input.terminateRuntime();
    } finally {
      this.closeLegs(1000, reason);
      this.state = "stopped";
      this.notifyTerminal("stopped");
    }
  }

  private async waitForDrain() {
    if (this.input.drain === undefined) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(this.input.drain()).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.input.drainTimeoutMs ?? defaultDrainTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private closeLegs(code: number, reason: string) {
    try {
      this.input.closeCaller(code, reason);
    } catch {
      // Continue closing the provider leg when the caller socket is already broken.
    }
    try {
      this.input.provider.close(code, reason);
    } catch {
      // Terminal state cannot depend on provider close succeeding.
    }
  }

  private notifyTerminal(state: "stopped" | "failed") {
    if (this.terminalNotified) {
      return;
    }
    this.terminalNotified = true;
    try {
      this.input.onTerminal?.(state);
    } catch {
      // Ownership cleanup cannot reopen a terminal actor.
    }
  }
}
