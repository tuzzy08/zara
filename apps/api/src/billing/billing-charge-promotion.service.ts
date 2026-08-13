import { Injectable } from "@nestjs/common";

interface ChargePromotionRelease {
  selectedTenantId: string;
  selectedTenantConsentId: string;
  selectedTenantCanaryApprovedEvents: Array<{
    outboxId: string;
    ledgerEntryId: string;
  }>;
}

interface ChargePromotionInput {
  promotionId: string;
  organizationId: string;
  outboxId: string;
  ledgerEntryId: string;
  releaseId: string;
  catalogId: string;
  actorUserId: string;
  actorRole: "billing_owner" | "tenant_admin";
  reason: string;
  promotedAt: string;
}

@Injectable()
export class BillingChargePromotionService {
  constructor(
    private readonly releases: {
      findProductionRelease(): Promise<ChargePromotionRelease | undefined>;
    },
    private readonly gate: {
      assertDeliveryAllowed(input: {
        deliveryEnabled: boolean;
        catalogId: string;
        releaseId: string;
        now: string;
      }): Promise<unknown>;
    },
    private readonly promotions: {
      promote(input: ChargePromotionInput & { reason: string }): Promise<{
        promotionId: string;
        duplicate: boolean;
      }>;
    },
  ) {}

  async promote(input: ChargePromotionInput) {
    if (input.actorRole !== "billing_owner") {
      throw new Error("Only a billing owner can promote a charge event.");
    }
    const reason = input.reason.trim();
    if (reason === "") throw new Error("A charge promotion reason is required.");
    await this.gate.assertDeliveryAllowed({
      deliveryEnabled: true,
      catalogId: input.catalogId,
      releaseId: input.releaseId,
      now: input.promotedAt,
    });
    const release = await this.releases.findProductionRelease();
    if (release === undefined) {
      throw new Error("No production charge-release approval is recorded.");
    }
    if (
      release.selectedTenantId !== input.organizationId
      || release.selectedTenantConsentId.trim() === ""
    ) {
      throw new Error("Charge promotion is limited to the selected canary tenant.");
    }
    const approved = release.selectedTenantCanaryApprovedEvents.some(
      (event) => event.outboxId === input.outboxId
        && event.ledgerEntryId === input.ledgerEntryId,
    );
    if (!approved) {
      throw new Error(
        "The outbox and ledger event pair is not approved by the selected canary.",
      );
    }
    return this.promotions.promote({ ...input, reason });
  }
}
