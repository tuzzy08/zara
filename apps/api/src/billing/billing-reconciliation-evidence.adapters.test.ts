import { describe, expect, it, vi } from "vitest";

import {
  BillingDraftInvoiceEvidenceAdapter,
  BillingPolarMeterEvidenceAdapter,
  BillingProviderUsageEvidenceAdapter,
} from "./billing-reconciliation-evidence.adapters";

describe("billing reconciliation evidence adapters", () => {
  it("loads each server-owned evidence source through its production reader port", async () => {
    const input = {
      organizationId: "tenant-a",
      catalogId: "catalog-a",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    };
    const providerReader = { readProviderUsage: vi.fn().mockResolvedValue(null) };
    const polarReader = { readPolarMeters: vi.fn().mockResolvedValue(null) };
    const invoiceReader = { readDraftInvoice: vi.fn().mockResolvedValue(null) };

    await expect(new BillingProviderUsageEvidenceAdapter(providerReader)
      .loadTenantCycleEvidence(input)).resolves.toBeNull();
    await expect(new BillingPolarMeterEvidenceAdapter(polarReader)
      .loadTenantCycleEvidence(input)).resolves.toBeNull();
    await expect(new BillingDraftInvoiceEvidenceAdapter(invoiceReader)
      .loadTenantCycleEvidence(input)).resolves.toBeNull();
    expect(providerReader.readProviderUsage).toHaveBeenCalledWith(input);
    expect(polarReader.readPolarMeters).toHaveBeenCalledWith(input);
    expect(invoiceReader.readDraftInvoice).toHaveBeenCalledWith(input);
  });
});
