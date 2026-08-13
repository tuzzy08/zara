import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  billingAdjustments,
  billingBudgetPolicies,
  billingChargeReservations,
  billingCustomers,
  billingCycles,
  billingEntitlements,
  billingInvoices,
  billingLedgerEntries,
  billingOutbox,
  billingPaygCreditEntries,
  billingPaygOrders,
  billingPolarMappings,
  billingPriceCatalogs,
  billingReservationAccounts,
  billingSubscriptions,
  billingTenantStates,
  billingWebhookReceipts,
} from "./schema";

describe("production billing schema", () => {
  it("defines tenant-owned customer, immutable catalog, and append-only ledger tables", () => {
    expect({
      customerTable: getTableName(billingCustomers),
      customerColumns: Object.keys(getTableColumns(billingCustomers)),
      catalogTable: getTableName(billingPriceCatalogs),
      catalogColumns: Object.keys(getTableColumns(billingPriceCatalogs)),
      ledgerTable: getTableName(billingLedgerEntries),
      ledgerColumns: Object.keys(getTableColumns(billingLedgerEntries)),
      stateTable: getTableName(billingTenantStates),
      stateColumns: Object.keys(getTableColumns(billingTenantStates)),
    }).toEqual({
      customerTable: "billing_customers",
      customerColumns: [
        "tenantId",
        "provider",
        "providerCustomerId",
        "createdAt",
        "updatedAt",
      ],
      catalogTable: "billing_price_catalogs",
      catalogColumns: [
        "id",
        "version",
        "status",
        "currency",
        "effectiveFrom",
        "checksum",
        "catalogDocument",
        "approvedBy",
        "approvedAt",
        "createdAt",
      ],
      ledgerTable: "billing_ledger_entries",
      ledgerColumns: [
        "id",
        "tenantId",
        "idempotencyKey",
        "entryType",
        "catalogId",
        "currency",
        "customerAmountMinor",
        "supplierCostMinor",
        "quantity",
        "unit",
        "occurredAt",
        "metadata",
        "createdAt",
      ],
      stateTable: "billing_tenant_states",
      stateColumns: ["tenantId", "state", "updatedAt"],
    });
  });

  it("defines tenant-owned payment, credit, webhook, and outbox records", () => {
    expect([
      tableContract(billingSubscriptions),
      tableContract(billingCycles),
      tableContract(billingBudgetPolicies),
      tableContract(billingEntitlements),
      tableContract(billingInvoices),
      tableContract(billingAdjustments),
      tableContract(billingPaygOrders),
      tableContract(billingPaygCreditEntries),
      tableContract(billingWebhookReceipts),
      tableContract(billingOutbox),
      tableContract(billingPolarMappings),
      tableContract(billingReservationAccounts),
      tableContract(billingChargeReservations),
    ]).toEqual([
      ["billing_subscriptions", ["tenantId", "id", "providerSubscriptionId", "catalogId", "planSlug", "status", "currentPeriodEnd", "cancelAtPeriodEnd", "version", "createdAt", "updatedAt"]],
      ["billing_cycles", ["tenantId", "id", "catalogId", "startsAt", "endsAt", "status", "createdAt"]],
      ["billing_budget_policies", ["tenantId", "currency", "overageLimitMinor", "callMinuteLimit", "premiumRuntimeMinuteLimit", "overBudgetBehavior", "warningThresholdPercent", "updatedBy", "updatedAt", "version"]],
      ["billing_entitlements", ["tenantId", "id", "providerBenefitId", "key", "status", "metadata", "createdAt", "updatedAt"]],
      ["billing_invoices", ["tenantId", "id", "providerOrderId", "invoiceNumber", "currency", "amountMinor", "status", "issuedAt", "metadata", "createdAt"]],
      ["billing_adjustments", ["tenantId", "id", "ledgerEntryId", "kind", "amountMinor", "currency", "reason", "createdBy", "createdAt"]],
      ["billing_payg_orders", ["tenantId", "id", "providerOrderId", "currency", "paidAmountMinor", "grantedCreditMinor", "status", "createdAt"]],
      ["billing_payg_credit_entries", ["tenantId", "id", "orderId", "entryType", "amountMinor", "idempotencyKey", "sessionId", "expiresAt", "createdAt"]],
      ["billing_webhook_receipts", ["tenantId", "provider", "eventId", "eventType", "payloadHash", "receivedAt", "processedAt", "status", "error"]],
      ["billing_outbox", ["tenantId", "id", "aggregateType", "aggregateId", "eventType", "payload", "status", "attemptCount", "nextAttemptAt", "lastError", "createdAt", "deliveredAt", "chargeReleaseId", "chargePromotedAt"]],
      ["billing_polar_mappings", ["id", "catalogId", "mappingType", "internalKey", "providerId", "environment", "createdAt"]],
      ["billing_reservation_accounts", ["tenantId", "reservedAmountMinor", "updatedAt"]],
      ["billing_charge_reservations", ["tenantId", "id", "reservationKey", "catalogId", "chargeContext", "fundingSource", "status", "reservedAmountMinor", "actualAmountMinor", "sessionId", "terminalOutcome", "currency", "expiresAt", "finalizedAt", "releasedAt", "createdAt", "updatedAt"]],
    ]);
  });
});

function tableContract(table: Parameters<typeof getTableName>[0]) {
  return [getTableName(table), Object.keys(getTableColumns(table))];
}
