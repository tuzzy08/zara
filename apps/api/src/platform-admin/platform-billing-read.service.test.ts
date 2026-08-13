import { describe, expect, it, vi } from "vitest";

import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

describe("platform-admin billing read service", () => {
  it("disables platform billing-control mutation without a durable atomic writer", async () => {
    const service = new PlatformAdminService(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      { getSnapshot: () => ({}) } as never,
      {} as never,
      {} as never,
    );

    await expect(Promise.resolve().then(() => service.updateBillingControls(
      { actorUserId: "platform-admin", platformRole: "platform_admin" } as never,
      "tenant-west-africa",
      { overageLimitMinor: 1000 },
    ))).rejects.toThrow("disabled until a durable billing budget writer is available");
  });

  it("uses the production billing read model for the billing route and dashboard", async () => {
    const billing = {
      currency: "USD" as const,
      shadowEstimateMinor: 725,
      premiumShadowEstimateMinor: 225,
      deliveredChargeMinor: null,
      incompleteUsageCount: 2,
      blockedUsageCount: 1,
      tenantsOverBudget: 1,
      organizations: [],
    };
    const read = vi.fn(async () => billing);
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      {} as never,
      { read } as never,
    );
    const controller = new PlatformAdminController(service);

    await expect(controller.getBilling()).resolves.toEqual({ billing });
    await expect(controller.getDashboard()).resolves.toMatchObject({
      dashboard: {
        spend: {
          currency: "USD",
          shadowEstimateMinor: 725,
          premiumShadowEstimateMinor: 225,
          deliveredChargeMinor: null,
          incompleteUsageCount: 2,
          blockedUsageCount: 1,
          tenantsOverBudget: 1,
        },
      },
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps an empty platform billing result explicit", async () => {
    const billing = {
      currency: null,
      shadowEstimateMinor: null,
      premiumShadowEstimateMinor: null,
      deliveredChargeMinor: null,
      incompleteUsageCount: 0,
      blockedUsageCount: 0,
      tenantsOverBudget: 0,
      organizations: [],
    };
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      {} as never,
      { read: async () => billing } as never,
    );

    await expect(service.getDashboard()).resolves.toMatchObject({
      spend: {
        currency: null,
        shadowEstimateMinor: null,
        premiumShadowEstimateMinor: null,
        deliveredChargeMinor: null,
        incompleteUsageCount: 0,
        blockedUsageCount: 0,
        tenantsOverBudget: 0,
      },
    });
  });

  it("projects production billing facts into organization reads", async () => {
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      { getStatus: async () => ({ tenantId: "tenant-west-africa", status: "active" }) } as never,
      {
        read: async () => ({
          currency: "USD",
          shadowEstimateMinor: 725,
          premiumShadowEstimateMinor: 225,
          deliveredChargeMinor: null,
          incompleteUsageCount: 2,
          blockedUsageCount: 1,
          tenantsOverBudget: 0,
          organizations: [{
            organizationId: "tenant-west-africa",
            organizationName: "Tuzzy Labs",
            hasBillingData: true,
            subscription: { status: "active", planSlug: "growth" },
            usage: {
              currency: "USD",
              shadowEstimateMinor: 725,
              premiumShadowEstimateMinor: 225,
              deliveredChargeMinor: null,
              incompleteUsageCount: 2,
              blockedUsageCount: 1,
              callSeconds: 180,
              premiumRuntimeSeconds: 90,
            },
            budget: { currency: "USD", overageLimitMinor: 1000, overBudget: false },
            payg: null,
          }],
        }),
      } as never,
    );

    await expect(service.getOrganization("tenant-west-africa")).resolves.toMatchObject({
      plan: "growth",
      usage: {
        currency: "USD",
        shadowEstimateMinor: 725,
        premiumShadowEstimateMinor: 225,
      },
      billingControls: {
        currency: "USD",
        overageLimitMinor: 1000,
      },
    });
  });

  it("returns null billing fields when an organization has no billing facts", async () => {
    const service = new PlatformAdminService(
      {} as never, {} as never, {} as never, {} as never, {} as never,
      { getSnapshot: () => ({}) } as never,
      { getStatus: async () => ({ outcome: "found", status: "active" }) } as never,
      {
        read: async () => ({
          currency: null,
          shadowEstimateMinor: null,
          premiumShadowEstimateMinor: null,
          deliveredChargeMinor: null,
          incompleteUsageCount: 0,
          blockedUsageCount: 0,
          tenantsOverBudget: 0,
          organizations: [{
            organizationId: "tenant-healthdesk",
            organizationName: "Healthdesk Reception",
            hasBillingData: false,
            subscription: null,
            usage: null,
            budget: null,
            payg: null,
          }],
        }),
      } as never,
    );

    await expect(service.getOrganization("tenant-healthdesk")).resolves.toMatchObject({
      plan: null,
      usage: null,
      billingControls: null,
    });
  });
});
