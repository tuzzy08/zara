import { Inject, Injectable } from "@nestjs/common";

import { AuditLogService } from "../compliance/audit-log.service";
import {
  BILLING_POLAR_CLIENT,
  type BillingPolarClient,
} from "./polar-billing.client";
import {
  BILLING_LEDGER_REPOSITORY,
  type BillingEntitlementProjectionRecord,
  type BillingSubscriptionProjectionRecord,
  type PostgresBillingLedgerRepository,
} from "./postgres-billing-ledger.repository";

type CustomerStateRepository = Pick<
  PostgresBillingLedgerRepository,
  | "listTenantAccounts"
  | "findPolarMappingByProviderId"
  | "applyPolarCustomerStateProjection"
>;

@Injectable()
export class BillingCustomerStateReconciliationService {
  constructor(
    @Inject(BILLING_LEDGER_REPOSITORY)
    private readonly repository: CustomerStateRepository,
    @Inject(BILLING_POLAR_CLIENT)
    private readonly polar: Pick<BillingPolarClient, "getCustomerState">,
    private readonly audit: AuditLogService,
  ) {}

  async runOnce(reconciledAt: string) {
    const accounts = await this.repository.listTenantAccounts();
    const result = { checked: 0, repaired: 0, failed: 0 };
    for (const account of accounts) {
      result.checked += 1;
      try {
        const state = await this.polar.getCustomerState({
          externalCustomerId: account.organizationId,
        });
        if (state.externalCustomerId !== account.organizationId) {
          throw new Error("Polar customer state does not match the tenant.");
        }
        const subscriptions: BillingSubscriptionProjectionRecord[] = [];
        for (const subscription of state.activeSubscriptions) {
          const mapping = await this.repository.findPolarMappingByProviderId(
            subscription.productId,
            process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
          );
          if (mapping?.mappingType !== "product") {
            throw new Error(`Polar product ${subscription.productId} has no billing catalog mapping.`);
          }
          subscriptions.push({
            id: subscription.id,
            organizationId: account.organizationId,
            providerSubscriptionId: subscription.id,
            catalogId: mapping.catalogId,
            planSlug: mapping.internalKey,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            version: 1,
            createdAt: subscription.createdAt,
            updatedAt: subscription.modifiedAt,
          });
        }
        const entitlements: BillingEntitlementProjectionRecord[] = [];
        for (const benefit of state.grantedBenefits) {
          const mapping = await this.repository.findPolarMappingByProviderId(
            benefit.benefitId,
            process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
          );
          if (mapping?.mappingType !== "benefit") {
            throw new Error(`Polar benefit ${benefit.benefitId} has no billing catalog mapping.`);
          }
          entitlements.push({
            id: benefit.id,
            organizationId: account.organizationId,
            providerBenefitId: benefit.benefitId,
            key: mapping.internalKey,
            status: "active",
            metadata: { benefitType: benefit.benefitType },
            createdAt: benefit.createdAt,
            updatedAt: benefit.modifiedAt,
          });
        }
        const repair = await this.repository.applyPolarCustomerStateProjection({
          account: {
            ...account,
            providerCustomerId: state.customerId,
            updatedAt: reconciledAt,
          },
          subscriptions,
          entitlements,
          reconciledAt,
        });
        if (!repair.changed) continue;
        result.repaired += 1;
        await this.audit.record({
          tenantId: account.organizationId,
          action: "billing.customer_state_repaired",
          target: { type: "billing_customer", id: state.customerId },
          outcome: "succeeded",
          metadata: {
            provider: "polar",
            subscriptionCount: subscriptions.length,
            entitlementCount: entitlements.length,
            reason: "missed_webhook_reconciliation",
          },
          occurredAt: reconciledAt,
        });
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }
}
