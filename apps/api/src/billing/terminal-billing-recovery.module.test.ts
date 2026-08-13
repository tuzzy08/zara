import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { PostgresPoolService } from "../database/postgres-pool.service";
import { BillingModule } from "./billing.module";
import { TerminalBillingRecoveryRepository } from "./terminal-billing-recovery.repository";
import { TerminalBillingRecoveryScheduler } from "./terminal-billing-recovery.scheduler";
import { TrustedTerminalBillingRecoveryService } from "./trusted-terminal-billing-recovery.service";
import { TrustedCallCommercialModeResolver } from "./trusted-call-commercial-mode-resolver";

describe("terminal billing recovery module graph", () => {
  it("registers recovery only in the control-plane BillingModule", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BillingModule] })
      .overrideProvider(PostgresPoolService)
      .useValue({ pool: { connect: async () => { throw new Error("not used"); } } })
      .compile();
    try {
      expect(moduleRef.get(TerminalBillingRecoveryRepository)).toBeInstanceOf(
        TerminalBillingRecoveryRepository,
      );
      expect(moduleRef.get(TrustedTerminalBillingRecoveryService)).toBeInstanceOf(
        TrustedTerminalBillingRecoveryService,
      );
      expect(moduleRef.get(TerminalBillingRecoveryScheduler)).toBeInstanceOf(
        TerminalBillingRecoveryScheduler,
      );
      expect(moduleRef.get(TrustedCallCommercialModeResolver)).toBeInstanceOf(
        TrustedCallCommercialModeResolver,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
