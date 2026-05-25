import { requestJson } from "./apiClient";

export interface TenantBillingState {
  organizationId: string;
  provider: "polar";
  customerExternalId: string;
  plan: {
    slug: "starter" | "growth" | "scale";
    name: string;
    status: "none" | "trialing" | "active" | "past_due" | "canceled";
    monthlyBaseUsd: number;
    includedMinutes: number;
    budgetLimitUsd: number;
    budgetUsedUsd: number;
    budgetWarning: boolean;
  };
  subscription: {
    provider: "polar";
    providerCustomerId?: string;
    providerSubscriptionId?: string;
    status: "none" | "trialing" | "active" | "past_due" | "canceled";
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
  };
  usage: Array<{
    id: string;
    label: string;
    used: number;
    limit?: number;
    unit: string;
    costUsd: number;
  }>;
  entitlements: Array<{
    id: string;
    label: string;
    status: "granted" | "revoked";
  }>;
  invoices: Array<{
    id: string;
    providerOrderId: string;
    invoiceNumber: string;
    amountUsd: number;
    status: "paid" | "open" | "void";
    createdAt: string;
  }>;
  updatedAt: string;
}

export async function fetchTenantBillingState(organizationId: string) {
  const response = await requestJson<{ billing: TenantBillingState }>(
    `/organizations/${organizationId}/billing/state`,
  );

  return response.billing;
}

export async function startPolarCheckout(organizationId: string, planSlug: TenantBillingState["plan"]["slug"]) {
  const response = await requestJson<{ checkout: { checkoutUrl: string } }>(
    `/organizations/${organizationId}/billing/checkout`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        planSlug,
        successUrl: `${window.location.origin}/billing`,
        returnUrl: `${window.location.origin}/billing`,
      }),
    },
  );

  return response.checkout;
}

export async function openPolarCustomerPortal(organizationId: string) {
  const response = await requestJson<{ portal: { customerPortalUrl: string } }>(
    `/organizations/${organizationId}/billing/customer-portal`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        returnUrl: `${window.location.origin}/billing`,
      }),
    },
  );

  return response.portal;
}
