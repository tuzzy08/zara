import { Module } from "@nestjs/common";

import { PostgresPoolService } from "../database/postgres-pool.service";
import { DatabaseModule } from "../database/database.module";
import { AuditLogModule } from "../compliance/audit-log.module";
import { PostgresTelephonyStateRepository } from "../telephony/postgres-telephony-state.repository";
import { resolveTelephonySecretVaultConfig } from "../telephony/telephony-env";
import { TelephonySecretVault } from "../telephony/telephony-secret-vault";
import {
  ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE,
  BillingController,
} from "./billing.controller";
import { BillingService } from "./billing.service";
import {
  BILLING_STATE_REPOSITORY,
  PostgresBillingStateRepository,
} from "./billing-state.repository";
import {
  BILLING_POLAR_CLIENT,
  PolarSdkBillingClient,
  resolvePolarBillingClientConfig,
} from "./polar-billing.client";
import {
  BILLING_LEDGER_REPOSITORY,
  PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";
import { TrustedBillingUsageProducer } from "./trusted-billing-usage-producer";
import { BillingPolarOutboxWorker } from "./billing-polar-outbox.worker";
import { BillingOutboxOperationsService } from "./billing-outbox-operations.service";
import { validateBillingChargeDeliveryConfig } from "./billing-polar-outbox.config";
import {
  BILLING_RECONCILIATION_REPORT_REPOSITORY,
  BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE,
  BILLING_POLAR_METER_EVIDENCE_SOURCE,
  BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE,
  BillingUsageReconciliationService,
} from "./billing-usage-reconciliation.service";
import { BillingPolarOutboxScheduler } from "./billing-polar-outbox.scheduler";
import { BillingOutboxObservability } from "./billing-outbox-observability";
import { BillingCustomerStateReconciliationService } from "./billing-customer-state-reconciliation.service";
import { BillingCustomerStateReconciliationScheduler } from "./billing-customer-state-reconciliation.scheduler";
import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { TrustedPaygCallLifecycleService } from "./trusted-payg-call-lifecycle.service";
import { BillingPaygReservationQuoteService } from "./billing-payg-reservation-quote.service";
import { TrustedPaygTerminalFinalizationService } from "./trusted-payg-terminal-finalization.service";
import { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";
import { BillingPaygEligibilityService } from "./billing-payg-eligibility.service";
import { TrustedPaygActiveCallFundingService } from "./trusted-payg-active-call-funding.service";
import { TerminalBillingRecoveryRepository } from "./terminal-billing-recovery.repository";
import { TrustedTerminalBillingRecoveryService } from "./trusted-terminal-billing-recovery.service";
import { TerminalBillingRecoveryScheduler } from "./terminal-billing-recovery.scheduler";
import { TrustedCallCommercialModeResolver } from "./trusted-call-commercial-mode-resolver";
import { TerminalBillingRecoveryAlerts } from "./terminal-billing-recovery.alerts";
import {
  BILLING_READ_MODEL_REPOSITORY,
  PostgresBillingReadModelRepository,
} from "./billing-read-model.repository";
import {
  BillingChargeDeliveryGuard,
  BillingChargeReleaseGate,
} from "./billing-charge-release-gate";
import { PostgresBillingChargeReleaseRepository } from "./postgres-billing-charge-release.repository";
import { PostgresBillingReconciliationReportRepository } from "./billing-reconciliation-report.repository";
import { BillingReleaseDrillQualificationService } from "./billing-release-drill-qualification.service";
import {
  BILLING_RELEASE_DRILL_REPORT_REPOSITORY,
  PostgresBillingReleaseDrillReportRepository,
} from "./billing-release-drill-report.repository";
import {
  BillingDailyReconciliationRunner,
  BillingDailyReconciliationScheduler,
} from "./billing-daily-reconciliation.scheduler";
import {
  BillingDraftInvoiceEvidenceAdapter,
  BillingPolarMeterEvidenceAdapter,
  BillingProviderUsageEvidenceAdapter,
} from "./billing-reconciliation-evidence.adapters";
import {
  BillingProviderEvidenceCollector,
  PolarBillingReconciliationReader,
  PostgresProviderEvidenceRepository,
} from "./billing-production-reconciliation-evidence";
import { BillingChargePromotionService } from "./billing-charge-promotion.service";
import { PostgresBillingChargePromotionRepository } from "./postgres-billing-charge-promotion.repository";
import {
  BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER,
  PostgresBillingReleaseDrillOperationEvidenceReader,
} from "./billing-release-drill-operation-evidence.repository";
import { TrustedBillingReleaseDrillExecutor } from "./trusted-billing-release-drill-executor";
import { TwilioBillingEvidenceSource } from "./twilio-billing-evidence.source";
import { TwilioRestCallBillingClient } from "./twilio-call-billing.client";
import { PostgresProviderBillingScopeRepository } from "./provider-billing-scope.repository";
import { CartesiaAdminUsageClient, CartesiaBillingEvidenceSource } from "./cartesia-billing-evidence.source";
import { OpenAiDirectBillingEvidenceSource } from "./openai-billing-evidence.source";
import { OpenAiOrganizationBillingClient } from "./openai-organization-billing.client";
import { GeminiCloudBillingEvidenceSource } from "./gemini-cloud-billing-evidence.source";
import {
  GoogleBigQueryBillingClient,
  GoogleCloudBigQueryExecutor,
} from "./google-bigquery-billing.client";
import type { BillingProviderEvidenceSource } from "./billing-production-reconciliation-evidence";

const BILLING_OUTBOX_WORKER_CONFIG = Symbol("BILLING_OUTBOX_WORKER_CONFIG");
const BILLING_CHARGE_PROMOTION_REPOSITORY = Symbol(
  "BILLING_CHARGE_PROMOTION_REPOSITORY",
);
export const BILLING_PROVIDER_EVIDENCE_SOURCES = Symbol(
  "BILLING_PROVIDER_EVIDENCE_SOURCES",
);

@Module({
  imports: [AuditLogModule, DatabaseModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      provide: ALLOW_LEGACY_BILLING_USAGE_TEST_FIXTURE,
      useValue: false,
    },
    {
      provide: BILLING_STATE_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingStateRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_LEDGER_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingLedgerRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_READ_MODEL_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingReadModelRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: PostgresBillingChargeReleaseRepository,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingChargeReleaseRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BillingChargeReleaseGate,
      useFactory: (repository: PostgresBillingChargeReleaseRepository) =>
        new BillingChargeReleaseGate(repository),
      inject: [PostgresBillingChargeReleaseRepository],
    },
    {
      provide: BillingChargeDeliveryGuard,
      useFactory: (gate: BillingChargeReleaseGate) => new BillingChargeDeliveryGuard(gate, {
        deliveryEnabled: process.env.BILLING_CHARGE_DELIVERY_ENABLED === "true",
        catalogId: process.env.POLAR_BILLING_CATALOG_ID?.trim() ?? "",
        releaseId: process.env.ZARA_RELEASE_ID?.trim() ?? "",
      }),
      inject: [BillingChargeReleaseGate],
    },
    {
      provide: BILLING_RECONCILIATION_REPORT_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingReconciliationReportRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_RELEASE_DRILL_REPORT_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingReleaseDrillReportRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE,
      useFactory: (reader: PostgresProviderEvidenceRepository) =>
        new BillingProviderUsageEvidenceAdapter(reader),
      inject: [PostgresProviderEvidenceRepository],
    },
    {
      provide: BILLING_POLAR_METER_EVIDENCE_SOURCE,
      useFactory: (reader: PolarBillingReconciliationReader) =>
        new BillingPolarMeterEvidenceAdapter(reader),
      inject: [PolarBillingReconciliationReader],
    },
    {
      provide: BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE,
      useFactory: (reader: PolarBillingReconciliationReader) =>
        new BillingDraftInvoiceEvidenceAdapter(reader),
      inject: [PolarBillingReconciliationReader],
    },
    {
      provide: PostgresProviderEvidenceRepository,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresProviderEvidenceRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: PostgresProviderBillingScopeRepository,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresProviderBillingScopeRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_PROVIDER_EVIDENCE_SOURCES,
      useFactory: (
        postgresPoolService: PostgresPoolService,
        ledger: PostgresBillingLedgerRepository,
        scopes: PostgresProviderBillingScopeRepository,
      ): BillingProviderEvidenceSource[] => {
        const sources: BillingProviderEvidenceSource[] = [new TwilioBillingEvidenceSource(
          new PostgresTelephonyStateRepository(postgresPoolService.pool),
          new TelephonySecretVault(resolveTelephonySecretVaultConfig(process.env)),
          ledger,
          new TwilioRestCallBillingClient(),
        )];
        const cartesiaAdminKey = process.env.CARTESIA_ADMIN_API_KEY?.trim();
        if (cartesiaAdminKey) {
          sources.push(new CartesiaBillingEvidenceSource(
            new CartesiaAdminUsageClient({ adminApiKey: cartesiaAdminKey }),
            scopes,
          ));
        }
        const openAiAdminKey = process.env.OPENAI_ADMIN_KEY?.trim();
        if (openAiAdminKey) {
          sources.push(new OpenAiDirectBillingEvidenceSource(
            scopes,
            new OpenAiOrganizationBillingClient({ adminKey: openAiAdminKey }),
          ));
        }
        sources.push(new GeminiCloudBillingEvidenceSource(
          scopes,
          new GoogleBigQueryBillingClient(new GoogleCloudBigQueryExecutor()),
        ));
        return sources;
      },
      inject: [
        PostgresPoolService,
        BILLING_LEDGER_REPOSITORY,
        PostgresProviderBillingScopeRepository,
      ],
    },
    {
      provide: BillingProviderEvidenceCollector,
      useFactory: (
        repository: PostgresProviderEvidenceRepository,
        sources: BillingProviderEvidenceSource[],
      ) => new BillingProviderEvidenceCollector(repository, sources),
      inject: [PostgresProviderEvidenceRepository, BILLING_PROVIDER_EVIDENCE_SOURCES],
    },
    {
      provide: PolarBillingReconciliationReader,
      useFactory: (
        polar: PolarSdkBillingClient,
        ledger: PostgresBillingLedgerRepository,
      ) => new PolarBillingReconciliationReader(
        polar,
        ledger,
        process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
      ),
      inject: [BILLING_POLAR_CLIENT, BILLING_LEDGER_REPOSITORY],
    },
    {
      provide: BILLING_CHARGE_PROMOTION_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingChargePromotionRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresBillingReleaseDrillOperationEvidenceReader(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TrustedBillingReleaseDrillExecutor,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new TrustedBillingReleaseDrillExecutor(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: BillingChargePromotionService,
      useFactory: (
        releases: PostgresBillingChargeReleaseRepository,
        gate: BillingChargeReleaseGate,
        promotions: PostgresBillingChargePromotionRepository,
      ) => new BillingChargePromotionService(releases, gate, promotions),
      inject: [
        PostgresBillingChargeReleaseRepository,
        BillingChargeReleaseGate,
        BILLING_CHARGE_PROMOTION_REPOSITORY,
      ],
    },
    {
      provide: BillingChargeReservationRepository,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new BillingChargeReservationRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TrustedPaygCallLifecycleService,
      useFactory: (reservations: BillingChargeReservationRepository) =>
        new TrustedPaygCallLifecycleService(reservations),
      inject: [BillingChargeReservationRepository],
    },
    {
      provide: BillingPaygReservationQuoteService,
      useFactory: (ledger: PostgresBillingLedgerRepository) =>
        new BillingPaygReservationQuoteService(ledger),
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
    {
      provide: TrustedSubscriptionCallLifecycleService,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new TrustedSubscriptionCallLifecycleService(postgresPoolService.pool),
      inject: [PostgresPoolService],
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
      provide: TerminalBillingRecoveryRepository,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new TerminalBillingRecoveryRepository(postgresPoolService.pool),
      inject: [PostgresPoolService],
    },
    {
      provide: TrustedCallCommercialModeResolver,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new TrustedCallCommercialModeResolver(postgresPoolService.pool),
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
    {
      provide: TrustedBillingUsageProducer,
      useFactory: (ledger: PostgresBillingLedgerRepository) =>
        new TrustedBillingUsageProducer(ledger),
      inject: [BILLING_LEDGER_REPOSITORY],
    },
    {
      provide: BILLING_OUTBOX_WORKER_CONFIG,
      useFactory: async (
        ledger: PostgresBillingLedgerRepository,
        releaseGuard: BillingChargeDeliveryGuard,
      ) => {
        const deliveryEnabled = process.env.BILLING_CHARGE_DELIVERY_ENABLED === "true";
        const catalogId = process.env.POLAR_BILLING_CATALOG_ID?.trim() ?? "";
        const releaseId = process.env.ZARA_RELEASE_ID?.trim() ?? "";
        const mappings = deliveryEnabled
          ? await ledger.listPolarMappings(catalogId, "production")
          : [];
        validateBillingChargeDeliveryConfig({
          deliveryEnabled,
          accessToken: process.env.POLAR_ACCESS_TOKEN ?? "",
          server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
          webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
          catalogId,
          releaseId,
          mappings,
        });
        await releaseGuard.assertDeliveryAllowed(new Date().toISOString());
        return {
          deliveryEnabled,
          releaseId,
          batchSize: 50,
          maxAttempts: 5,
          retryDelayMs: 30_000,
          processingTimeoutMs: 300_000,
        };
      },
      inject: [BILLING_LEDGER_REPOSITORY, BillingChargeDeliveryGuard],
    },
    {
      provide: BillingPolarOutboxWorker,
      useFactory: (
        ledger: PostgresBillingLedgerRepository,
        polar: PolarSdkBillingClient,
        config: {
          deliveryEnabled: boolean;
          releaseId: string;
          batchSize: number;
          maxAttempts: number;
          retryDelayMs: number;
          processingTimeoutMs: number;
        },
        observability: BillingOutboxObservability,
        releaseGuard: BillingChargeDeliveryGuard,
      ) => new BillingPolarOutboxWorker(
        ledger,
        polar,
        config,
        observability,
        releaseGuard,
      ),
      inject: [
        BILLING_LEDGER_REPOSITORY,
        BILLING_POLAR_CLIENT,
        BILLING_OUTBOX_WORKER_CONFIG,
        BillingOutboxObservability,
        BillingChargeDeliveryGuard,
      ],
    },
    BillingOutboxObservability,
    TerminalBillingRecoveryAlerts,
    BillingOutboxOperationsService,
    BillingUsageReconciliationService,
    BillingReleaseDrillQualificationService,
    {
      provide: BillingDailyReconciliationRunner,
      useFactory: (
        repository: PostgresBillingReconciliationReportRepository,
        reconciliation: BillingUsageReconciliationService,
        providerEvidenceCollector: BillingProviderEvidenceCollector,
      ) => new BillingDailyReconciliationRunner(repository, reconciliation, {
        releaseId: process.env.ZARA_RELEASE_ID?.trim() ?? "",
        catalogId: process.env.POLAR_BILLING_CATALOG_ID?.trim() ?? "",
        validityMs: 86_400_000,
      }, providerEvidenceCollector),
      inject: [
        BILLING_RECONCILIATION_REPORT_REPOSITORY,
        BillingUsageReconciliationService,
        BillingProviderEvidenceCollector,
      ],
    },
    BillingDailyReconciliationScheduler,
    BillingPolarOutboxScheduler,
    BillingCustomerStateReconciliationService,
    BillingCustomerStateReconciliationScheduler,
    TerminalBillingRecoveryScheduler,
    {
      provide: BILLING_POLAR_CLIENT,
      useFactory: () => new PolarSdkBillingClient(resolvePolarBillingClientConfig(process.env)),
    },
  ],
  exports: [
    BillingService,
    BILLING_LEDGER_REPOSITORY,
    BILLING_READ_MODEL_REPOSITORY,
    BillingChargeReservationRepository,
    TrustedPaygCallLifecycleService,
    BillingPaygReservationQuoteService,
    TrustedPaygTerminalFinalizationService,
    TrustedSubscriptionCallLifecycleService,
    BillingPaygEligibilityService,
    TrustedPaygActiveCallFundingService,
    TrustedBillingUsageProducer,
    BillingPolarOutboxWorker,
    BillingOutboxOperationsService,
    BillingUsageReconciliationService,
    BillingReleaseDrillQualificationService,
    TrustedBillingReleaseDrillExecutor,
    BILLING_RELEASE_DRILL_REPORT_REPOSITORY,
    BillingDailyReconciliationRunner,
    BillingDailyReconciliationScheduler,
    BILLING_RECONCILIATION_REPORT_REPOSITORY,
    PostgresBillingChargeReleaseRepository,
    BillingChargeReleaseGate,
    BillingChargeDeliveryGuard,
    BillingChargePromotionService,
    BillingPolarOutboxScheduler,
    BillingOutboxObservability,
    BillingCustomerStateReconciliationService,
    BillingCustomerStateReconciliationScheduler,
    TerminalBillingRecoveryRepository,
    TrustedTerminalBillingRecoveryService,
    TerminalBillingRecoveryScheduler,
    TrustedCallCommercialModeResolver,
  ],
})
export class BillingModule {}
