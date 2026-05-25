import { Module } from "@nestjs/common";
import { join } from "node:path";

import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import {
  BILLING_STATE_REPOSITORY,
  FileBillingStateRepository,
} from "./billing-state.repository";
import {
  BILLING_POLAR_CLIENT,
  PolarSdkBillingClient,
  resolvePolarBillingClientConfig,
} from "./polar-billing.client";

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      provide: BILLING_STATE_REPOSITORY,
      useFactory: () => new FileBillingStateRepository(
        process.env.ZARA_BILLING_STATE_DIR ?? join(process.cwd(), ".zara", "billing"),
      ),
    },
    {
      provide: BILLING_POLAR_CLIENT,
      useFactory: () => new PolarSdkBillingClient(resolvePolarBillingClientConfig(process.env)),
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
