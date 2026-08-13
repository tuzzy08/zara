import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { AuditLogService } from "../compliance/audit-log.service";
import { FileAuditLogRepository } from "../compliance/audit-log.repository";
import { BillingCustomerStateReconciliationService } from "./billing-customer-state-reconciliation.service";
import { PostgresBillingLedgerRepository } from "./postgres-billing-ledger.repository";

describe("BillingCustomerStateReconciliationService", () => {
  it("repairs a missed Polar subscription update and later cancellation", async () => {
    const database = newDb();
    database.public.none(`
      create table billing_customers (
        tenant_id text primary key,
        provider text not null,
        provider_customer_id text,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );
      create table billing_subscriptions (
        tenant_id text not null,
        id text not null,
        provider_subscription_id text not null,
        catalog_id text not null,
        status text not null,
        current_period_end timestamptz,
        cancel_at_period_end boolean not null,
        version integer not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id)
      );
      create table billing_polar_mappings (
        catalog_id text not null,
        mapping_type text not null,
        internal_key text not null,
        provider_id text not null,
        environment text not null
      );
      create table billing_entitlements (
        tenant_id text not null,
        id text not null,
        provider_benefit_id text,
        key text not null,
        status text not null,
        metadata jsonb not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant_id, id),
        unique (tenant_id, key)
      );
      insert into billing_polar_mappings values (
        'catalog-2026-08-v1', 'product', 'growth', 'polar-product-growth', 'sandbox'
      );
      insert into billing_polar_mappings values (
        'catalog-2026-08-v1', 'benefit', 'premium-realtime', 'polar-benefit-premium', 'sandbox'
      );
    `);
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool();
    const repository = new PostgresBillingLedgerRepository(pool);
    await repository.upsertTenantAccount({
      organizationId: "tenant-a",
      provider: "polar",
      providerCustomerId: "polar-customer-a",
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T01:00:00.000Z",
    });
    await repository.upsertSubscriptionProjection({
      id: "polar-subscription-a",
      organizationId: "tenant-a",
      providerSubscriptionId: "polar-subscription-a",
      catalogId: "catalog-2026-08-v1",
      status: "past_due",
      currentPeriodEnd: "2026-09-10T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      version: 1,
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T01:00:00.000Z",
    });
    const audit = new AuditLogService(
      new FileAuditLogRepository(join(tmpdir(), "zara-billing-reconciliation", randomUUID())),
    );
    let activeSubscriptions = [{
      id: "polar-subscription-a",
      productId: "polar-product-growth",
      status: "active",
      currentPeriodEnd: "2026-09-10T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      createdAt: "2026-08-10T01:00:00.000Z",
      modifiedAt: "2026-08-10T02:00:00.000Z",
    }];
    let grantedBenefits = [{
      id: "polar-grant-premium-a",
      benefitId: "polar-benefit-premium",
      benefitType: "feature_flag",
      createdAt: "2026-08-10T01:00:00.000Z",
      modifiedAt: "2026-08-10T02:00:00.000Z",
    }];
    const service = new BillingCustomerStateReconciliationService(
      repository,
      {
        async getCustomerState() {
          return {
            customerId: "polar-customer-a",
            externalCustomerId: "tenant-a",
            activeSubscriptions,
            grantedBenefits,
          };
        },
      },
      audit,
    );

    await expect(service.runOnce("2026-08-10T03:00:00.000Z")).resolves.toEqual({
      checked: 1,
      repaired: 1,
      failed: 0,
    });
    await expect(repository.listSubscriptionProjections("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        providerSubscriptionId: "polar-subscription-a",
        status: "active",
        updatedAt: "2026-08-10T02:00:00.000Z",
      }),
    ]);
    await expect(audit.list("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        action: "billing.customer_state_repaired",
        actor: { type: "system" },
        outcome: "succeeded",
        target: { type: "billing_customer", id: "polar-customer-a" },
        occurredAt: "2026-08-10T03:00:00.000Z",
      }),
    ]);
    await expect(repository.listEntitlementProjections("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        key: "premium-realtime",
        providerBenefitId: "polar-benefit-premium",
        status: "active",
      }),
    ]);

    activeSubscriptions = [];
    grantedBenefits = [];
    await expect(service.runOnce("2026-08-10T04:00:00.000Z")).resolves.toEqual({
      checked: 1,
      repaired: 1,
      failed: 0,
    });
    await expect(repository.listSubscriptionProjections("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        providerSubscriptionId: "polar-subscription-a",
        status: "revoked",
        updatedAt: "2026-08-10T04:00:00.000Z",
      }),
    ]);
    await expect(audit.list("tenant-a")).resolves.toHaveLength(2);
    await expect(repository.listEntitlementProjections("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        key: "premium-realtime",
        status: "revoked",
        updatedAt: "2026-08-10T04:00:00.000Z",
      }),
    ]);

    await expect(service.runOnce("2026-08-10T05:00:00.000Z")).resolves.toEqual({
      checked: 1,
      repaired: 0,
      failed: 0,
    });
    await expect(audit.list("tenant-a")).resolves.toHaveLength(2);

    await pool.end();
  });
});
