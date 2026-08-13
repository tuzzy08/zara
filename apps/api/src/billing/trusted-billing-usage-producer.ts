import { createHash } from "node:crypto";

import type {
  BillingLedgerEntry,
  BillingOutboxEntry,
  BillingPriceCatalog,
  PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";

type LedgerRepository = Pick<
  PostgresBillingLedgerRepository,
  "appendLedgerEntry" | "appendLedgerEntryWithOutbox" | "getEffectivePriceCatalog" | "getPriceCatalog"
>;

export interface TrustedTerminalCallFact {
  organizationId: string;
  workspaceId?: string | undefined;
  callSessionId: string;
  providerConnectionId: string;
  provider: string;
  direction: "inbound" | "outbound";
  ownershipMode: "platform-managed" | "byo";
  routeMode: "live_route" | "test_route";
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime";
  outcome: "completed" | "transferred" | "failed";
  catalogId?: string | undefined;
  commercialMode: "payg" | "subscription";
  paygAppliedMinor?: number | undefined;
  planSlug?: string | undefined;
  routeRateId?: string | undefined;
  runtimeSeconds: number;
  providerConnectedSeconds?: number | undefined;
  supplierRuntimeCostMinor?: number | undefined;
  supplierTelephonyCostMinor?: number | undefined;
  occurredAt: string;
}

export interface TrustedUsageProductionResult {
  recorded: number;
  duplicates: number;
  incomplete: number;
}

export interface TrustedBrowserSandboxRuntimeFact {
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  source: "browser_sandbox";
  runtimePath: "standard" | "premium-realtime";
  runtimeSeconds: number;
  catalogId: string;
  occurredAt: string;
}

export class TrustedBillingUsageProducer {
  constructor(private readonly ledger: LedgerRepository) {}

  private async appendUsageEntry(entry: BillingLedgerEntry) {
    if (
      entry.metadata.billingDisposition !== "shadow"
      || entry.metadata.commercialMode !== "subscription"
    ) {
      return this.ledger.appendLedgerEntry(entry);
    }
    const outboxEntry = createUsageOutboxEntry(entry);
    const result = await this.ledger.appendLedgerEntryWithOutbox({
      ledgerEntry: entry,
      outboxEntry,
    });
    return result.ledger;
  }

  async recordRuntimeSession(
    fact: TrustedBrowserSandboxRuntimeFact,
  ): Promise<TrustedUsageProductionResult> {
    const catalog = await this.resolveCatalog(fact.catalogId, fact.occurredAt);
    const runtimePath = fact.runtimePath === "standard"
      ? "pstn-sandwich"
      : "pstn-premium-realtime";
    const result = await this.ledger.appendLedgerEntry({
      id: stableEntryId("runtime", fact.sessionId),
      organizationId: fact.organizationId,
      idempotencyKey: `trusted-runtime:${fact.sessionId}:${runtimeKey(runtimePath)}`,
      entryType: "runtime_charge",
      ...(catalog === null ? {} : { catalogId: catalog.id }),
      currency: catalog?.currency ?? "usd",
      quantity: requireInteger(fact.runtimeSeconds, "runtimeSeconds"),
      unit: "second",
      occurredAt: fact.occurredAt,
      metadata: {
        workspaceId: fact.workspaceId,
        sessionId: fact.sessionId,
        source: fact.source,
        billingClass: runtimeBillingClass(runtimePath),
        billingDisposition: "non_billable",
        nonBillableReason: "browser_sandbox_v1",
        chargeDelivery: "shadow",
      },
      createdAt: fact.occurredAt,
    });
    return {
      recorded: result.duplicate ? 0 : 1,
      duplicates: result.duplicate ? 1 : 0,
      incomplete: 0,
    };
  }

  async recordTerminalCall(
    fact: TrustedTerminalCallFact,
  ): Promise<TrustedUsageProductionResult> {
    const paygAppliedMinor = fact.paygAppliedMinor === undefined
      ? 0
      : requireInteger(fact.paygAppliedMinor, "paygAppliedMinor");
    if (fact.commercialMode === "payg" && paygAppliedMinor !== 0) {
      throw new Error("PAYG usage cannot include subscription PAYG net settlement.");
    }
    const paygNettedSubscription = fact.commercialMode === "subscription"
      && paygAppliedMinor > 0;
    const catalog = await this.resolveCatalog(fact.catalogId, fact.occurredAt);
    if (catalog === null) {
      return this.recordTerminalCallWithoutCatalog(fact);
    }
    const runtimeRate = readRuntimeRate(catalog, fact);
    const runtimeIncompleteReasons = runtimeRate === undefined
      ? ["missing_customer_runtime_rate"]
      : [];
    if (paygNettedSubscription) {
      runtimeIncompleteReasons.push("subscription_payg_net_settlement_unavailable");
    }
    const commonMetadata = {
      ...(fact.workspaceId === undefined ? {} : { workspaceId: fact.workspaceId }),
      callSessionId: fact.callSessionId,
      providerConnectionId: fact.providerConnectionId,
      provider: fact.provider,
      direction: fact.direction,
      connectionOwnership: fact.ownershipMode,
      routeMode: fact.routeMode,
      usageContext: fact.routeMode === "test_route" ? "phone_test" : "live_call",
      outcome: fact.outcome,
      commercialMode: fact.commercialMode,
      ...(fact.planSlug === undefined ? {} : { planSlug: fact.planSlug }),
      chargeDelivery: paygNettedSubscription ? "blocked" : "shadow",
      ...(paygAppliedMinor === 0 ? {} : { paygAppliedMinor }),
    };
    const results = [await this.appendUsageEntry({
      id: stableEntryId("runtime", fact.callSessionId),
      organizationId: fact.organizationId,
      idempotencyKey: `trusted-call:${fact.callSessionId}:${runtimeKey(fact.runtimePath)}`,
      entryType: "runtime_charge",
      catalogId: catalog.id,
      currency: catalog.currency,
      ...(runtimeRate === undefined
        ? {}
        : { customerAmountMinor: prorateAndRoundUp(fact.runtimeSeconds, runtimeRate) }),
      ...(fact.supplierRuntimeCostMinor === undefined
        ? {}
        : { supplierCostMinor: fact.supplierRuntimeCostMinor }),
      quantity: fact.runtimeSeconds,
      unit: "second",
      occurredAt: fact.occurredAt,
      metadata: {
        ...commonMetadata,
        billingClass: runtimeBillingClass(fact.runtimePath),
        runtimePath: fact.runtimePath,
        billingDisposition:
          runtimeIncompleteReasons.length === 0 ? "shadow" : "incomplete",
        ...(runtimeIncompleteReasons.length === 0
          ? {}
          : { incompleteReasons: runtimeIncompleteReasons }),
      },
      createdAt: fact.occurredAt,
    })];

    if (fact.ownershipMode === "platform-managed") {
      const telephonyIncompleteReasons: string[] = [];
      if (paygNettedSubscription) {
        telephonyIncompleteReasons.push("subscription_payg_net_settlement_unavailable");
      }
      const connectedSeconds = fact.providerConnectedSeconds === undefined
        ? 0
        : requireInteger(fact.providerConnectedSeconds, "providerConnectedSeconds");
      if (fact.providerConnectedSeconds === undefined) {
        telephonyIncompleteReasons.push("missing_provider_connected_seconds");
      }
      const routeRateId = optionalText(fact.routeRateId)
        ?? findTelephonyRouteId(catalog, fact.provider, fact.direction);
      const route = routeRateId === undefined
        ? undefined
        : readTelephonyRoute(catalog, routeRateId);
      if (routeRateId === undefined || route === undefined) {
        telephonyIncompleteReasons.push("missing_customer_telephony_rate");
      }
      const failedWithoutProviderConnection =
        fact.outcome === "failed" && connectedSeconds === 0;
      const roundedCustomerMinutes = Math.ceil(connectedSeconds / 60);
      results.push(await this.appendUsageEntry({
        id: stableEntryId("telephony", fact.callSessionId),
        organizationId: fact.organizationId,
        idempotencyKey: `trusted-call:${fact.callSessionId}:platform-telephony`,
        entryType: "telephony_charge",
        catalogId: catalog.id,
        currency: catalog.currency,
        ...(telephonyIncompleteReasons.length > 0 || route === undefined
          ? {}
          : {
              customerAmountMinor:
                roundedCustomerMinutes * route.customerRateMinorPerMinute,
            }),
        ...(fact.supplierTelephonyCostMinor === undefined
          ? {}
          : { supplierCostMinor: fact.supplierTelephonyCostMinor }),
        quantity: connectedSeconds,
        unit: "connected_second",
        occurredAt: fact.occurredAt,
        metadata: {
          ...commonMetadata,
          billingClass: "platform_telephony_charge_minor",
          connectionOwnership: fact.ownershipMode,
          ...(routeRateId === undefined ? {} : { routeRateId }),
          roundedCustomerMinutes,
          billingDisposition:
            telephonyIncompleteReasons.length > 0
              ? "incomplete"
              : failedWithoutProviderConnection
                ? "non_billable"
                : "shadow",
          ...(failedWithoutProviderConnection
            ? { nonBillableReason: "failed_without_provider_connection" }
            : {}),
          ...(telephonyIncompleteReasons.length === 0
            ? {}
            : { incompleteReasons: telephonyIncompleteReasons }),
        },
        createdAt: fact.occurredAt,
      }));
    }

    const duplicates = results.filter((result) => result.duplicate).length;
    return {
      recorded: results.length - duplicates,
      duplicates,
      incomplete:
        (runtimeIncompleteReasons.length === 0 ? 0 : 1)
        + results.filter((result) =>
          result.entry.metadata.billingDisposition === "incomplete"
          && result.entry.entryType === "telephony_charge"
        ).length,
    };
  }

  private async resolveCatalog(catalogId: string | undefined, occurredAt: string) {
    const catalog = catalogId === undefined
      ? await this.ledger.getEffectivePriceCatalog(occurredAt)
      : await this.ledger.getPriceCatalog(catalogId);
    return catalog;
  }

  private async recordTerminalCallWithoutCatalog(
    fact: TrustedTerminalCallFact,
  ): Promise<TrustedUsageProductionResult> {
    const commonMetadata = {
      ...(fact.workspaceId === undefined ? {} : { workspaceId: fact.workspaceId }),
      callSessionId: fact.callSessionId,
      providerConnectionId: fact.providerConnectionId,
      provider: fact.provider,
      direction: fact.direction,
      connectionOwnership: fact.ownershipMode,
      routeMode: fact.routeMode,
      usageContext: fact.routeMode === "test_route" ? "phone_test" : "live_call",
      outcome: fact.outcome,
      commercialMode: fact.commercialMode,
      chargeDelivery: fact.paygAppliedMinor === undefined || fact.paygAppliedMinor === 0
        ? "shadow" : "blocked",
      ...(fact.paygAppliedMinor === undefined || fact.paygAppliedMinor === 0
        ? {} : { paygAppliedMinor: fact.paygAppliedMinor }),
      billingDisposition: "incomplete",
      incompleteReasons: ["missing_effective_price_catalog"],
    };
    const results = [await this.ledger.appendLedgerEntry({
      id: stableEntryId("runtime", fact.callSessionId),
      organizationId: fact.organizationId,
      idempotencyKey: `trusted-call:${fact.callSessionId}:${runtimeKey(fact.runtimePath)}`,
      entryType: "runtime_charge",
      currency: "usd",
      ...(fact.supplierRuntimeCostMinor === undefined
        ? {}
        : { supplierCostMinor: fact.supplierRuntimeCostMinor }),
      quantity: requireInteger(fact.runtimeSeconds, "runtimeSeconds"),
      unit: "second",
      occurredAt: fact.occurredAt,
      metadata: {
        ...commonMetadata,
        billingClass: runtimeBillingClass(fact.runtimePath),
        runtimePath: fact.runtimePath,
      },
      createdAt: fact.occurredAt,
    })];
    if (fact.ownershipMode === "platform-managed") {
      results.push(await this.ledger.appendLedgerEntry({
        id: stableEntryId("telephony", fact.callSessionId),
        organizationId: fact.organizationId,
        idempotencyKey: `trusted-call:${fact.callSessionId}:platform-telephony`,
        entryType: "telephony_charge",
        currency: "usd",
        ...(fact.supplierTelephonyCostMinor === undefined
          ? {}
          : { supplierCostMinor: fact.supplierTelephonyCostMinor }),
        quantity: fact.providerConnectedSeconds === undefined
          ? 0
          : requireInteger(fact.providerConnectedSeconds, "providerConnectedSeconds"),
        unit: "connected_second",
        occurredAt: fact.occurredAt,
        metadata: {
          ...commonMetadata,
          billingClass: "platform_telephony_charge_minor",
        },
        createdAt: fact.occurredAt,
      }));
    }
    const duplicates = results.filter((result) => result.duplicate).length;
    return {
      recorded: results.length - duplicates,
      duplicates,
      incomplete: results.length,
    };
  }
}

function readRuntimeRate(
  catalog: BillingPriceCatalog,
  fact: TrustedTerminalCallFact,
) {
  const rateTable = fact.commercialMode === "payg"
    ? requireRecord(catalog.document.payg, "catalog.payg")
    : readSubscriptionPlan(catalog, optionalText(fact.planSlug));
  if (rateTable === undefined) return undefined;
  const field = fact.runtimePath === "pstn-sandwich"
    ? "standardRuntimePerMinuteMinor"
    : "premiumRuntimePerMinuteMinor";
  return rateTable[field] === undefined
    ? undefined
    : requireInteger(rateTable[field], `catalog runtime rate ${field}`);
}

function readSubscriptionPlan(
  catalog: BillingPriceCatalog,
  planSlug: string | undefined,
) {
  if (catalog.document.plans === undefined || planSlug === undefined) return undefined;
  const plans = requireRecord(catalog.document.plans, "catalog.plans");
  const plan = plans[planSlug];
  return plan === undefined
    ? undefined
    : requireRecord(plan, `catalog.plans.${planSlug}`);
}

function readTelephonyRoute(catalog: BillingPriceCatalog, routeRateId: string) {
  if (catalog.document.telephonyRoutes === undefined) return undefined;
  const routes = requireRecord(catalog.document.telephonyRoutes, "catalog.telephonyRoutes");
  if (routes[routeRateId] === undefined) return undefined;
  const route = requireRecord(routes[routeRateId], `catalog.telephonyRoutes.${routeRateId}`);
  if (route.customerRateMinorPerMinute === undefined) return undefined;
  return {
    customerRateMinorPerMinute: requireInteger(
      route.customerRateMinorPerMinute,
      `catalog.telephonyRoutes.${routeRateId}.customerRateMinorPerMinute`,
    ),
  };
}

function findTelephonyRouteId(
  catalog: BillingPriceCatalog,
  provider: string,
  direction: TrustedTerminalCallFact["direction"],
) {
  if (catalog.document.telephonyRoutes === undefined) return undefined;
  const routes = requireRecord(catalog.document.telephonyRoutes, "catalog.telephonyRoutes");
  const matches = Object.entries(routes).filter(([, value]) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const route = value as Record<string, unknown>;
    return route.provider === provider && route.direction === direction;
  });
  return matches.length === 1 ? matches[0]?.[0] : undefined;
}

function prorateAndRoundUp(seconds: number, rateMinorPerMinute: number) {
  return Math.ceil(requireInteger(seconds, "runtimeSeconds") * rateMinorPerMinute / 60);
}

function runtimeKey(runtimePath: TrustedTerminalCallFact["runtimePath"]) {
  return runtimePath === "pstn-sandwich" ? "standard-runtime" : "premium-runtime";
}

function runtimeBillingClass(runtimePath: TrustedTerminalCallFact["runtimePath"]) {
  return runtimePath === "pstn-sandwich"
    ? "standard_runtime_seconds"
    : "premium_runtime_seconds";
}

function stableEntryId(kind: "runtime" | "telephony", sourceId: string) {
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 24);
  return `billing_usage_${kind}_${digest}`;
}

function createUsageOutboxEntry(entry: BillingLedgerEntry): BillingOutboxEntry {
  const meterKey = optionalText(entry.metadata.billingClass);
  if (meterKey === undefined) {
    throw new Error(`Ledger entry ${entry.id} has no billing class.`);
  }
  const id = `polar_usage_${entry.id}`;
  return {
    id,
    organizationId: entry.organizationId,
    aggregateType: "billing_ledger_entry",
    aggregateId: entry.id,
    eventType: "polar.usage.report",
    payload: {
      externalEventId: id,
      externalCustomerId: entry.organizationId,
      ledgerEntryId: entry.id,
      meterKey,
      quantity: entry.quantity,
      unit: entry.unit,
      currency: entry.currency,
      ...(entry.customerAmountMinor === undefined
        ? {}
        : { customerAmountMinor: entry.customerAmountMinor }),
      occurredAt: entry.occurredAt,
      deliveryMode: "shadow",
    },
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: entry.createdAt,
    createdAt: entry.createdAt,
  };
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is required.`);
  }
  return value as Record<string, unknown>;
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
