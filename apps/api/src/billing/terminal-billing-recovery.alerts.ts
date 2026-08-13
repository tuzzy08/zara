import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class TerminalBillingRecoveryAlerts {
  private readonly logger = new Logger(TerminalBillingRecoveryAlerts.name);

  terminalRecoveryDeadLettered(input: {
    commercialMode: "payg" | "subscription";
    attemptCount: number;
  }) {
    this.logger.error(
      `[billing] terminal_recovery_dead_letter commercial_mode=${input.commercialMode} attempts=${input.attemptCount}`,
    );
  }
}
