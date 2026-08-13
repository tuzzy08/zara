import { describe, expect, it, vi } from "vitest";

import { BillingChargePromotionService } from "./billing-charge-promotion.service";

describe("BillingChargePromotionService", () => {
  it("promotes one selected-tenant event and writes audit evidence", async () => {
    const { service, promotion } = harness();

    await expect(service.promote(approvedInput())).resolves.toEqual({
      promotionId: "promotion-1",
      duplicate: false,
    });
    expect(promotion.promote).toHaveBeenCalledOnce();
  });

  it("rejects a cross-tenant event before promotion", async () => {
    const { service, promotion } = harness();

    await expect(service.promote(approvedInput({
      organizationId: "tenant-other",
    }))).rejects.toThrow("Charge promotion is limited to the selected canary tenant.");
    expect(promotion.promote).not.toHaveBeenCalled();
  });

  it("rejects an event that is not in the selected canary approval", async () => {
    const { service, promotion } = harness();

    await expect(service.promote(approvedInput({
      outboxId: "outbox-historical",
      ledgerEntryId: "ledger-historical",
    }))).rejects.toThrow("The outbox and ledger event pair is not approved by the selected canary.");
    expect(promotion.promote).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized actor role or empty reason", async () => {
    const { service, promotion } = harness();

    await expect(service.promote(approvedInput({
      actorRole: "tenant_admin",
    }))).rejects.toThrow("Only a billing owner can promote a charge event.");
    await expect(service.promote(approvedInput({ reason: " " }))).rejects.toThrow(
      "A charge promotion reason is required.",
    );
    expect(promotion.promote).not.toHaveBeenCalled();
  });

  it("returns an exact replay without a second audit record", async () => {
    const { service, promotion } = harness({ duplicate: true });

    await expect(service.promote(approvedInput())).resolves.toEqual({
      promotionId: "promotion-1",
      duplicate: true,
    });
    expect(promotion.promote).toHaveBeenCalledOnce();
  });
});

function harness(result = { duplicate: false }) {
  const promotion = { promote: vi.fn(async () => ({ promotionId: "promotion-1", ...result })) };
  const service = new BillingChargePromotionService(
    {
      findProductionRelease: async () => ({
        selectedTenantId: "tenant-selected",
        selectedTenantConsentId: "consent-248",
        selectedTenantCanaryApprovedEvents: [{
          outboxId: "outbox-1",
          ledgerEntryId: "ledger-1",
        }],
      }),
    },
    {
      assertDeliveryAllowed: async () => ({ allowed: true, reason: "approved" }),
    },
    promotion,
  );
  return { service, promotion };
}

function approvedInput(overrides: Partial<Parameters<BillingChargePromotionService["promote"]>[0]> = {}) {
  return {
    promotionId: "promotion-1",
    organizationId: "tenant-selected",
    outboxId: "outbox-1",
    ledgerEntryId: "ledger-1",
    releaseId: "release-248",
    catalogId: "catalog-v1",
    actorUserId: "billing-owner",
    actorRole: "billing_owner" as const,
    reason: "Selected tenant charge canary.",
    promotedAt: "2026-08-12T12:00:00.000Z",
    ...overrides,
  };
}
