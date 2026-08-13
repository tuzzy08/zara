import { Module } from "@nestjs/common";

import { PostgresPoolService } from "../database/postgres-pool.service";
import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { BillingPaygEligibilityService } from "./billing-payg-eligibility.service";
import { BillingService } from "./billing.service";
import {
  BILLING_STATE_REPOSITORY,
  PostgresBillingStateRepository,
} from "./billing-state.repository";
import {
  BILLING_POLAR_CLIENT,
  type BillingPolarClient,
} from "./polar-billing.client";
import {
  BILLING_LEDGER_REPOSITORY,
  PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";
import { TrustedPaygActiveCallFundingService } from "./trusted-payg-active-call-funding.service";
import { TrustedBillingUsageProducer } from "./trusted-billing-usage-producer";
import { TrustedPaygTerminalFinalizationService } from "./trusted-payg-terminal-finalization.service";
import { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";
import { TerminalBillingRecoveryRepository } from "./terminal-billing-recovery.repository";
import { TrustedTerminalBillingRecoveryService } from "./trusted-terminal-billing-recovery.service";
import { TerminalBillingRecoveryAlerts } from "./terminal-billing-recovery.alerts";

@Module({
  providers: [
    PostgresPoolService,
    BillingService,
    {
      provide: BILLING_STATE_REPOSITORY,
      useFactory: (postgres: PostgresPoolService) =>
        new PostgresBillingStateRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_POLAR_CLIENT,
      useValue: runtimeOnlyPolarClient(),
    },
    {
      provide: BILLING_LEDGER_REPOSITORY,
      useFactory: (postgres: PostgresPoolService) =>
        new PostgresBillingLedgerRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BillingChargeReservationRepository,
      useFactory: (postgres: PostgresPoolService) =>
        new BillingChargeReservationRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TrustedSubscriptionCallLifecycleService,
      useFactory: (postgres: PostgresPoolService) =>
        new TrustedSubscriptionCallLifecycleService(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TrustedPaygActiveCallFundingService,
      useFactory: (
        ledger: PostgresBillingLedgerRepository,
        reservations: BillingChargeReservationRepository,
        subscriptionReservations: TrustedSubscriptionCallLifecycleService,
      ) => new TrustedPaygActiveCallFundingService(
        ledger,
        reservations,
        subscriptionReservations,
      ),
      inject: [
        BILLING_LEDGER_REPOSITORY,
        BillingChargeReservationRepository,
        TrustedSubscriptionCallLifecycleService,
      ],
    },
    {
      provide: BillingPaygEligibilityService,
      useFactory: (
        ledger: PostgresBillingLedgerRepository,
        reservations: BillingChargeReservationRepository,
      ) => new BillingPaygEligibilityService(ledger, reservations),
      inject: [BILLING_LEDGER_REPOSITORY, BillingChargeReservationRepository],
    },
    {
      provide: TrustedBillingUsageProducer,
      useFactory: (ledger: PostgresBillingLedgerRepository) =>
        new TrustedBillingUsageProducer(ledger),
      inject: [BILLING_LEDGER_REPOSITORY],
    },
    {
      provide: TrustedPaygTerminalFinalizationService,
      useFactory: (
        ledger: PostgresBillingLedgerRepository,
        reservations: BillingChargeReservationRepository,
      ) => new TrustedPaygTerminalFinalizationService(ledger, reservations),
      inject: [BILLING_LEDGER_REPOSITORY, BillingChargeReservationRepository],
    },
    TerminalBillingRecoveryAlerts,
    {
      provide: TerminalBillingRecoveryRepository,
      useFactory: (postgres: PostgresPoolService) =>
        new TerminalBillingRecoveryRepository(postgres.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TrustedTerminalBillingRecoveryService,
      useFactory: (
        jobs: TerminalBillingRecoveryRepository,
        usage: TrustedBillingUsageProducer,
        payg: TrustedPaygTerminalFinalizationService,
        subscription: TrustedSubscriptionCallLifecycleService,
        alerts: TerminalBillingRecoveryAlerts,
      ) => new TrustedTerminalBillingRecoveryService(
        jobs,
        usage,
        payg,
        subscription,
        alerts,
      ),
      inject: [
        TerminalBillingRecoveryRepository,
        TrustedBillingUsageProducer,
        TrustedPaygTerminalFinalizationService,
        TrustedSubscriptionCallLifecycleService,
        TerminalBillingRecoveryAlerts,
      ],
    },
  ],
  exports: [
    PostgresPoolService,
    BillingService,
    BILLING_LEDGER_REPOSITORY,
    BillingChargeReservationRepository,
    TrustedSubscriptionCallLifecycleService,
    TrustedPaygActiveCallFundingService,
    BillingPaygEligibilityService,
    TrustedBillingUsageProducer,
    TrustedPaygTerminalFinalizationService,
    TerminalBillingRecoveryRepository,
    TrustedTerminalBillingRecoveryService,
  ],
})
export class BillingRuntimeFundingModule {}

function runtimeOnlyPolarClient(): BillingPolarClient {
  const unavailable = async () => {
    throw new Error("Polar operations are unavailable in the realtime worker.");
  };
  return {
    createdCheckouts: [],
    createdCustomerSessions: [],
    ingestedUsageEvents: [],
    createCheckout: unavailable,
    createCustomerPortal: unavailable,
    ingestUsageEvent: unavailable,
    getCustomerState: unavailable,
  } as BillingPolarClient;
}
