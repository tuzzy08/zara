import { requestJson } from "./apiClient";

export interface TenantBillingState {
  organizationId: string;
  provider: "polar";
  currency: "usd";
  customerExternalId: string;
  plan: {
    slug: BillingPlanSlug;
    name: string;
    status: "none" | "trialing" | "active" | "past_due" | "canceled";
    monthlyBaseUsd: number;
    includedMinutes: number;
    budgetLimitUsd: number;
    budgetUsedUsd: number;
    budgetWarning: boolean;
    currency?: "usd";
    monthlyBaseMinor?: number | null;
    includedStandardRuntimeSeconds?: number | null;
    includedPremiumRuntimeSeconds?: number | null;
  } | null;
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
    costUsd: number | null;
    costMinor?: number | null;
    disposition?: "posted" | "shadow_estimate" | "incomplete" | "non_billable" | "blocked";
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
    amountMinor?: number;
    currency: "usd";
    status: "paid" | "open" | "void" | "refunded" | "unknown";
    createdAt: string;
  }>;
  budgetPolicy?: {
    currency?: "usd";
    monthlyBudgetMinor?: number;
    monthlyBudgetUsd: number;
  } | null;
  payg: {
    packAmountMinor: number | null;
    paidCreditMinor: number;
    consumedCreditMinor: number;
    balanceMinor: number;
    reservedCreditMinor: number;
    remainingCreditMinor: number;
    sessionDebits: Array<{
      id: string;
      sessionId: string;
      amountMinor: number;
      createdAt: string;
    }>;
  };
  updatedAt: string;
}

export type BillingPlanSlug = "starter" | "growth" | "scale";

export async function fetchTenantBillingState(organizationId: string) {
  const response = await requestJson<{ billing: TenantBillingState }>(
    `/organizations/${organizationId}/billing/state`,
  );

  return response.billing;
}

export async function startPolarCheckout(organizationId: string, planSlug: BillingPlanSlug) {
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

export async function startPaygCheckout(organizationId: string) {
  const response = await requestJson<{ checkout: { checkoutUrl: string } }>(
    `/organizations/${organizationId}/billing/payg-checkout`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: "user-ops-lead",
        actorRole: "admin",
        successUrl: `${window.location.origin}/billing`,
        returnUrl: `${window.location.origin}/billing`,
      }),
    },
  );
  return response.checkout;
}
