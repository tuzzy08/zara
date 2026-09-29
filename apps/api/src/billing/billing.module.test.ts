import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { PostgresPoolService } from "../database/postgres-pool.service";
import { BILLING_PROVIDER_EVIDENCE_SOURCES, BillingModule } from "./billing.module";
import {
  BILLING_STATE_REPOSITORY,
  PostgresBillingStateRepository,
} from "./billing-state.repository";
import {
  BILLING_LEDGER_REPOSITORY,
  PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";
import { TrustedBillingUsageProducer } from "./trusted-billing-usage-producer";
import { BillingPolarOutboxWorker } from "./billing-polar-outbox.worker";
import { BillingOutboxOperationsService } from "./billing-outbox-operations.service";
import { BillingUsageReconciliationService } from "./billing-usage-reconciliation.service";
import { BillingPolarOutboxScheduler } from "./billing-polar-outbox.scheduler";
import { BillingChargeReservationRepository } from "./billing-charge-reservation.repository";
import { TrustedPaygCallLifecycleService } from "./trusted-payg-call-lifecycle.service";
import { BillingPaygReservationQuoteService } from "./billing-payg-reservation-quote.service";
import { TrustedPaygTerminalFinalizationService } from "./trusted-payg-terminal-finalization.service";
import { TrustedSubscriptionCallLifecycleService } from "./trusted-subscription-call-lifecycle.service";
import { BillingPaygEligibilityService } from "./billing-payg-eligibility.service";
import { TrustedPaygActiveCallFundingService } from "./trusted-payg-active-call-funding.service";
import {
  BILLING_READ_MODEL_REPOSITORY,
  PostgresBillingReadModelRepository,
} from "./billing-read-model.repository";
import {
  BillingChargeDeliveryGuard,
  BillingChargeReleaseGate,
} from "./billing-charge-release-gate";
import { PostgresBillingChargeReleaseRepository } from "./postgres-billing-charge-release.repository";
import { BillingReleaseDrillQualificationService } from "./billing-release-drill-qualification.service";
import { PostgresBillingReconciliationReportRepository } from "./billing-reconciliation-report.repository";
import {
  BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE,
  BILLING_POLAR_METER_EVIDENCE_SOURCE,
  BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE,
  BILLING_RECONCILIATION_REPORT_REPOSITORY,
} from "./billing-usage-reconciliation.service";
import {
  BILLING_RELEASE_DRILL_REPORT_REPOSITORY,
  PostgresBillingReleaseDrillReportRepository,
} from "./billing-release-drill-report.repository";
import {
  BillingDailyReconciliationRunner,
  BillingDailyReconciliationScheduler,
} from "./billing-daily-reconciliation.scheduler";
import { BillingChargePromotionService } from "./billing-charge-promotion.service";
import {
  BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER,
  PostgresBillingReleaseDrillOperationEvidenceReader,
} from "./billing-release-drill-operation-evidence.repository";
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
import { TrustedBillingReleaseDrillExecutor } from "./trusted-billing-release-drill-executor";
import { TwilioBillingEvidenceSource } from "./twilio-billing-evidence.source";

describe("BillingModule", () => {
  it("keeps the owner control available when delivery configuration is invalid", async () => {
    const prior = process.env.BILLING_CHARGE_DELIVERY_ENABLED;
    const token = process.env.POLAR_ACCESS_TOKEN;
    process.env.BILLING_CHARGE_DELIVERY_ENABLED = "true";
    delete process.env.POLAR_ACCESS_TOKEN;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [BillingModule] })
        .overrideProvider(PostgresPoolService)
        .useValue({ pool: { query: async () => ({ rows: [], rowCount: 0 }) } })
        .compile();
      await moduleRef.close();
    } finally {
      restore("BILLING_CHARGE_DELIVERY_ENABLED", prior);
      restore("POLAR_ACCESS_TOKEN", token);
    }
  });
  it("ignores the obsolete signed-report environment contract", async () => {
    const priorUrl = process.env.ASSEMBLYAI_BILLING_REPORT_URL;
    process.env.ASSEMBLYAI_BILLING_REPORT_URL = "https://obsolete.example.test/assemblyai";
    const pool = { connect: async () => { throw new Error("not used"); } };

    try {
      const moduleRef = await Test.createTestingModule({ imports: [BillingModule] })
        .overrideProvider(PostgresPoolService)
        .useValue({ pool })
        .compile();
      await moduleRef.close();
    } finally {
      restore("ASSEMBLYAI_BILLING_REPORT_URL", priorUrl);
    }
  });

  it("uses Postgres billing state in the production provider graph", async () => {
    const pool = { connect: async () => { throw new Error("not used"); } };
    const moduleRef = await Test.createTestingModule({ imports: [BillingModule] })
      .overrideProvider(PostgresPoolService)
      .useValue({ pool })
      .compile();

    try {
      expect(moduleRef.get(BILLING_STATE_REPOSITORY)).toBeInstanceOf(
        PostgresBillingStateRepository,
      );
      expect(moduleRef.get(BILLING_LEDGER_REPOSITORY)).toBeInstanceOf(
        PostgresBillingLedgerRepository,
      );
      expect(moduleRef.get(BILLING_READ_MODEL_REPOSITORY)).toBeInstanceOf(
        PostgresBillingReadModelRepository,
      );
      expect(moduleRef.get(TrustedBillingUsageProducer)).toBeInstanceOf(
        TrustedBillingUsageProducer,
      );
      expect(moduleRef.get(BillingPolarOutboxWorker)).toBeInstanceOf(
        BillingPolarOutboxWorker,
      );
      expect(moduleRef.get(BillingOutboxOperationsService)).toBeInstanceOf(
        BillingOutboxOperationsService,
      );
      expect(moduleRef.get(BillingUsageReconciliationService)).toBeInstanceOf(
        BillingUsageReconciliationService,
      );
      expect(moduleRef.get(BillingPolarOutboxScheduler)).toBeInstanceOf(
        BillingPolarOutboxScheduler,
      );
      expect(moduleRef.get(BillingChargeReservationRepository)).toBeInstanceOf(
        BillingChargeReservationRepository,
      );
      expect(moduleRef.get(TrustedPaygCallLifecycleService)).toBeInstanceOf(
        TrustedPaygCallLifecycleService,
      );
      expect(moduleRef.get(BillingPaygReservationQuoteService)).toBeInstanceOf(
        BillingPaygReservationQuoteService,
      );
      expect(moduleRef.get(TrustedPaygTerminalFinalizationService)).toBeInstanceOf(
        TrustedPaygTerminalFinalizationService,
      );
      expect(moduleRef.get(TrustedSubscriptionCallLifecycleService)).toBeInstanceOf(
        TrustedSubscriptionCallLifecycleService,
      );
      expect(moduleRef.get(BillingPaygEligibilityService)).toBeInstanceOf(
        BillingPaygEligibilityService,
      );
      expect(moduleRef.get(TrustedPaygActiveCallFundingService)).toBeInstanceOf(
        TrustedPaygActiveCallFundingService,
      );
      expect(moduleRef.get(PostgresBillingChargeReleaseRepository)).toBeInstanceOf(
        PostgresBillingChargeReleaseRepository,
      );
      expect(moduleRef.get(BillingChargeReleaseGate)).toBeInstanceOf(
        BillingChargeReleaseGate,
      );
      expect(moduleRef.get(BillingChargeDeliveryGuard)).toBeInstanceOf(
        BillingChargeDeliveryGuard,
      );
      expect(moduleRef.get(BILLING_RECONCILIATION_REPORT_REPOSITORY)).toBeInstanceOf(
        PostgresBillingReconciliationReportRepository,
      );
      expect(moduleRef.get(BillingReleaseDrillQualificationService)).toBeInstanceOf(
        BillingReleaseDrillQualificationService,
      );
      expect(moduleRef.get(BILLING_RELEASE_DRILL_REPORT_REPOSITORY)).toBeInstanceOf(
        PostgresBillingReleaseDrillReportRepository,
      );
      expect(moduleRef.get(BillingDailyReconciliationRunner)).toBeInstanceOf(
        BillingDailyReconciliationRunner,
      );
      expect(moduleRef.get(BillingDailyReconciliationScheduler)).toBeInstanceOf(
        BillingDailyReconciliationScheduler,
      );
      expect(moduleRef.get(BillingChargePromotionService)).toBeInstanceOf(
        BillingChargePromotionService,
      );
      expect(moduleRef.get(BILLING_RELEASE_DRILL_OPERATION_EVIDENCE_READER)).toBeInstanceOf(
        PostgresBillingReleaseDrillOperationEvidenceReader,
      );
      expect(moduleRef.get(BILLING_PROVIDER_USAGE_EVIDENCE_SOURCE)).toBeInstanceOf(
        BillingProviderUsageEvidenceAdapter,
      );
      expect(moduleRef.get(BILLING_POLAR_METER_EVIDENCE_SOURCE)).toBeInstanceOf(
        BillingPolarMeterEvidenceAdapter,
      );
      expect(moduleRef.get(BILLING_DRAFT_INVOICE_EVIDENCE_SOURCE)).toBeInstanceOf(
        BillingDraftInvoiceEvidenceAdapter,
      );
      expect(moduleRef.get(PostgresProviderEvidenceRepository)).toBeInstanceOf(
        PostgresProviderEvidenceRepository,
      );
      expect(moduleRef.get(BillingProviderEvidenceCollector)).toBeInstanceOf(
        BillingProviderEvidenceCollector,
      );
      expect(moduleRef.get(BILLING_PROVIDER_EVIDENCE_SOURCES)).toEqual(
        expect.arrayContaining([expect.any(TwilioBillingEvidenceSource)]),
      );
      expect(moduleRef.get(PolarBillingReconciliationReader)).toBeInstanceOf(
        PolarBillingReconciliationReader,
      );
      expect(moduleRef.get(TrustedBillingReleaseDrillExecutor)).toBeInstanceOf(
        TrustedBillingReleaseDrillExecutor,
      );
    } finally {
      await moduleRef.close();
    }
  });

  it("starts with valid configuration but keeps delivery stopped without an owner decision", async () => {
    const previous = {
      enabled: process.env.BILLING_CHARGE_DELIVERY_ENABLED,
      catalog: process.env.POLAR_BILLING_CATALOG_ID,
      release: process.env.ZARA_RELEASE_ID,
      token: process.env.POLAR_ACCESS_TOKEN,
      server: process.env.POLAR_SERVER,
      webhook: process.env.POLAR_WEBHOOK_SECRET,
    };
    Object.assign(process.env, {
      BILLING_CHARGE_DELIVERY_ENABLED: "true",
      POLAR_BILLING_CATALOG_ID: "catalog-v1",
      ZARA_RELEASE_ID: "release-248",
      POLAR_ACCESS_TOKEN: "polar-production-token",
      POLAR_SERVER: "production",
      POLAR_WEBHOOK_SECRET: "whsec-production",
    });
    let decision: Record<string, unknown> | null = null;
    const pool = {
      connect: async () => { throw new Error("not used"); },
      query: async (sql: string) => {
        if (sql.includes("billing_polar_mappings")) {
          // The owner stops while the worker validates payment settings.
          if (decision) decision = { ...decision, enabled: false };
          return { rows: productionMappings(), rowCount: 12 };
        }
        return { rows: decision ? [decision] : [], rowCount: decision ? 1 : 0 };
      },
    };

    try {
      const moduleRef = await Test.createTestingModule({ imports: [BillingModule] })
        .overrideProvider(PostgresPoolService)
        .useValue({ pool })
        .compile();
      try {
        await expect(moduleRef.get(BillingPolarOutboxWorker).runOnce(new Date().toISOString()))
          .resolves.toMatchObject({ disabled: true, delivered: 0 });
        decision = { id: "enable-1", enabled: true, catalog_id: "catalog-v1", release_id: "release-248",
          effective_at: "2026-09-27T00:00:00Z", actor_user_id: "owner", reason: "Enable", expected_decision_id: null };
        await expect(moduleRef.get(BillingPolarOutboxWorker).runOnce(new Date().toISOString()))
          .resolves.toMatchObject({ disabled: true, delivered: 0 });
      } finally { await moduleRef.close(); }
    } finally {
      restore("BILLING_CHARGE_DELIVERY_ENABLED", previous.enabled);
      restore("POLAR_BILLING_CATALOG_ID", previous.catalog);
      restore("ZARA_RELEASE_ID", previous.release);
      restore("POLAR_ACCESS_TOKEN", previous.token);
      restore("POLAR_SERVER", previous.server);
      restore("POLAR_WEBHOOK_SECRET", previous.webhook);
    }
  });
});

function productionMappings() {
  return [
    ["product", "starter"], ["product", "growth"], ["product", "scale"],
    ["credit_pack", "payg-5-usd"],
    ["meter", "standard_runtime_seconds"], ["meter", "premium_runtime_seconds"],
    ["meter", "platform_telephony_charge_minor"], ["meter", "payg_charge_minor"],
    ["meter", "subscription_charge_minor"],
    ["benefit", "premium-realtime"],
    ["price", "starter-monthly"], ["price", "growth-monthly"], ["price", "scale-monthly"],
  ].map(([mapping_type, internal_key]) => ({
    catalog_id: "catalog-v1",
    mapping_type,
    internal_key,
    provider_id: `polar-${mapping_type}-${internal_key}`,
    environment: "production",
  }));
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
