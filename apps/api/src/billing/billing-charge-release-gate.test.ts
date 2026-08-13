import { describe, expect, it } from "vitest";

import {
  BillingChargeReleaseGate,
  type BillingChargeReleaseRecord,
} from "./billing-charge-release-gate";

describe("BillingChargeReleaseGate", () => {
  it("rejects enabled delivery when no persisted approval and evidence record exists", async () => {
    const gate = new BillingChargeReleaseGate({
      findProductionRelease: async () => undefined,
    });

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("No production charge-release approval is recorded.");
  });

  it("rejects evidence that belongs to a different release candidate", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      releaseId: "release-old",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("Charge-release evidence does not match the release candidate.");
  });

  it("rejects an approval without a recorded identity", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      approvalId: "",
      approvedBy: "",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The production charge approval identity is incomplete.");
  });

  it("rejects a failed reconciliation even when its timestamps are current", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      reconciliationResult: "mismatch",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The bound reconciliation did not pass.");
  });

  it("rejects selected-tenant canary evidence without tenant consent", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      selectedTenantConsentId: "",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The selected-tenant canary consent is missing.");
  });

  it("rejects a canary report bound under the wrong canary type", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      internalCanaryType: "selected_tenant",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The bound internal-tenant canary has the wrong type.");
  });

  it("rejects evidence scoped to another catalog", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      drillCatalogId: "catalog-old",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The bound drill report does not match the release scope.");
  });

  it("requires separate current billing, security, and release approvals", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      securityApprovalRole: "billing",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The security approval is missing or invalid.");
  });

  it("rejects an approval from another release scope", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      billingApprovalReleaseId: "release-old",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The billing approval does not match the release scope.");
  });

  it("rejects canary evidence dated after the gate check", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      selectedTenantCanaryCompletedAt: "2026-08-12T12:00:01.000Z",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow("The selected-tenant canary is not current.");
  });

  it.each([
    ["approvalExpiresAt", "The production charge approval is not current."],
    ["internalCanaryExpiresAt", "The internal-tenant canary is not current."],
    ["selectedTenantCanaryExpiresAt", "The selected-tenant canary is not current."],
    ["reconciliationExpiresAt", "The successful reconciliation is not current."],
    ["drillsExpiresAt", "The charge release drills are not current."],
  ] as const)("rejects stale %s evidence", async (field, message) => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      [field]: "2026-08-12T12:00:00.000Z",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow(message);
  });

  it("rejects a recorded charge stop", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord({
      deliveryStopped: true,
      stopReason: "Provider totals differ from Zara totals.",
    })));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).rejects.toThrow(
      "Charge delivery is stopped: Provider totals differ from Zara totals.",
    );
  });

  it("allows current matching evidence only when the explicit flag is enabled", async () => {
    const gate = new BillingChargeReleaseGate(repository(validRecord()));

    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: false,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).resolves.toEqual({ allowed: false, reason: "feature_flag_disabled" });
    await expect(gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: "catalog-v1",
      releaseId: "release-248",
      now: "2026-08-12T12:00:00.000Z",
    })).resolves.toEqual({ allowed: true, reason: "approved" });
  });
});

function repository(record: BillingChargeReleaseRecord) {
  return { findProductionRelease: async () => record };
}

function validRecord(
  overrides: Partial<BillingChargeReleaseRecord> = {},
): BillingChargeReleaseRecord {
  return {
    environment: "production",
    catalogId: "catalog-v1",
    releaseId: "release-248",
    approvalId: "approval-248",
    approvedBy: "billing-owner@zara.ai",
    approvedAt: "2026-08-12T10:00:00.000Z",
    approvalExpiresAt: "2026-08-13T10:00:00.000Z",
    billingApprovalId: "approval-billing-248",
    billingApprovalRole: "billing",
    billingApprovedBy: "billing-owner@zara.ai",
    billingApprovedAt: "2026-08-12T10:00:00.000Z",
    billingApprovalExpiresAt: "2026-08-13T10:00:00.000Z",
    billingApprovalCatalogId: "catalog-v1",
    billingApprovalReleaseId: "release-248",
    securityApprovalId: "approval-security-248",
    securityApprovalRole: "security",
    securityApprovedBy: "security-owner@zara.ai",
    securityApprovedAt: "2026-08-12T10:01:00.000Z",
    securityApprovalExpiresAt: "2026-08-13T10:01:00.000Z",
    securityApprovalCatalogId: "catalog-v1",
    securityApprovalReleaseId: "release-248",
    releaseApprovalId: "approval-release-248",
    releaseApprovalRole: "release",
    releaseApprovedBy: "release-owner@zara.ai",
    releaseApprovedAt: "2026-08-12T10:02:00.000Z",
    releaseApprovalExpiresAt: "2026-08-13T10:02:00.000Z",
    releaseApprovalCatalogId: "catalog-v1",
    releaseApprovalReleaseId: "release-248",
    internalCanaryEvidenceId: "canary-internal-248",
    internalCanaryResult: "passed",
    internalCanaryType: "internal",
    internalCanaryCatalogId: "catalog-v1",
    internalCanaryReleaseId: "release-248",
    internalCanaryTenantId: "tenant-zara-internal",
    internalCanaryCompletedAt: "2026-08-12T10:05:00.000Z",
    internalCanaryExpiresAt: "2026-08-13T10:05:00.000Z",
    selectedTenantCanaryEvidenceId: "canary-selected-248",
    selectedTenantCanaryResult: "passed",
    selectedTenantCanaryType: "selected_tenant",
    selectedTenantCanaryCatalogId: "catalog-v1",
    selectedTenantCanaryReleaseId: "release-248",
    selectedTenantId: "tenant-selected",
    selectedTenantConsentId: "consent-selected-248",
    selectedTenantCanaryApprovedEvents: [{
      outboxId: "outbox-1",
      ledgerEntryId: "ledger-1",
    }],
    selectedTenantCanaryCompletedAt: "2026-08-12T10:10:00.000Z",
    selectedTenantCanaryExpiresAt: "2026-08-13T10:10:00.000Z",
    reconciliationEvidenceId: "reconciliation-248",
    reconciliationResult: "matched",
    reconciliationCatalogId: "catalog-v1",
    reconciliationReleaseId: "release-248",
    reconciliationTenantId: "tenant-selected",
    reconciliationCompletedAt: "2026-08-12T10:15:00.000Z",
    reconciliationExpiresAt: "2026-08-13T10:15:00.000Z",
    drillEvidenceId: "drills-248",
    drillResult: "passed",
    drillCatalogId: "catalog-v1",
    drillReleaseId: "release-248",
    drillTenantId: "tenant-selected",
    drillsCompletedAt: "2026-08-12T10:20:00.000Z",
    drillsExpiresAt: "2026-08-13T10:20:00.000Z",
    deliveryStopped: false,
    stopReason: undefined,
    ...overrides,
  };
}
