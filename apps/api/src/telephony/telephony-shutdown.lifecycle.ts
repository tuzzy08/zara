import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from "@nestjs/common";

import { PstnAdmissionRedisLifecycle } from "./pstn-admission.module";
import { TwilioMediaStreamsWebSocketBridge } from "./twilio-media-streams.websocket-bridge";

type ShutdownStage = "media" | "admission";

@Injectable()
export class TelephonyShutdownLifecycle implements BeforeApplicationShutdown {
  private readonly logger = new Logger(TelephonyShutdownLifecycle.name);
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly mediaBridge: TwilioMediaStreamsWebSocketBridge,
    private readonly admissionLifecycle: PstnAdmissionRedisLifecycle,
  ) {}

  beforeApplicationShutdown() {
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown() {
    const failedStages: ShutdownStage[] = [];

    await this.runStage("media", () => this.mediaBridge.shutdown(), failedStages);
    await this.runStage("admission", () => this.admissionLifecycle.shutdown(), failedStages);

    if (failedStages.length > 0) {
      this.logger.error(
        `[twilio-pstn] telephony_shutdown_incomplete ${JSON.stringify({
          failedStages,
        })}`,
      );
    }
  }

  private async runStage(
    stage: ShutdownStage,
    operation: () => Promise<void>,
    failedStages: ShutdownStage[],
  ) {
    try {
      await operation();
    } catch {
      failedStages.push(stage);
    }
  }
}
