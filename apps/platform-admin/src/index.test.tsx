import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ZaraAuthClient, ZaraAuthContext, ZaraAuthSession, ZaraSessionSnapshot } from "@zara/auth-client";

import { buildPlatformBillingView, PlatformAdminApp } from "./index";

describe("platform admin auth gate", () => {
  it("requires platform-admin session state before rendering platform operations", () => {
    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(null)} />)).toContain(
      "Checking Zara Admin session",
    );

    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(tenantSession)} />)).toContain(
      "Platform access required",
    );

    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} />)).toContain(
      "Platform operations",
    );
  });

  it("renders safe platform-admin session and MFA states", () => {
    const expired = renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(expiredPlatformSession)} />);

    expect(expired).toContain("Session expired");
    expect(expired).toContain("Sign in again");

    const passwordOnly = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(passwordOnlyPlatformSession)} route="/runtime" />,
    );

    expect(passwordOnly).toContain("MFA or passkey required");
    expect(passwordOnly).toContain("disabled=\"\"");
    expect(passwordOnly).toContain("Sign out");
  });

  it("renders an independent staff shell with platform operations routes", () => {
    const dashboard = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(platformSession)} route="/dashboard" />,
    );

    expect(dashboard).toContain("Zara Staff");
    expect(dashboard).toContain("System health");
    expect(dashboard).toContain("Abuse queue");
    expect(dashboard).toContain("href=\"/organizations\"");

    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/organizations" />),
    ).toContain("Tenant operations");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/telephony" />),
    ).toContain("Telephony operations");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/telephony" />),
    ).toContain("Provision platform connection");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/integrations" />),
    ).toContain("Integration operations");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/agents" />),
    ).toContain("Specialist agents");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/runtime" />),
    ).toContain("Provider health");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/billing" />),
    ).toContain("Usage and billing controls");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/audit" />),
    ).toContain("Platform audit log");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/impersonation" />),
    ).toContain("Impersonation workflow");
    expect(
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/abuse" />),
    ).toContain("Abuse and compliance review");

    const unsafeImpersonation = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(passwordOnlyPlatformSession)} route="/impersonation" />,
    );
    expect(unsafeImpersonation).toContain("MFA or passkey required");

    const runtime = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(platformSession)} route="/runtime" />,
    );

    expect(runtime).toContain("AI runtime health");
    expect(runtime).toContain("Runtime eval gate");
    expect(runtime).toContain("npm run eval:runtime");
    expect(runtime).toContain("npm run eval:pstn");
  });
});

describe("platform billing display", () => {
  it("renders production billing facts without invented values", () => {
    expect(buildPlatformBillingView({
      currency: "USD",
      shadowEstimateMinor: 725,
      premiumShadowEstimateMinor: 225,
      deliveredChargeMinor: null,
      incompleteUsageCount: 2,
      blockedUsageCount: 1,
      tenantsOverBudget: 0,
      organizations: [{
        organizationId: "tenant-paid",
        organizationName: "Paid tenant",
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
        payg: {
          currency: "USD",
          paidCreditMinor: 500,
          totalCreditMinor: 325,
          consumedCreditMinor: 175,
          reservedCreditMinor: 100,
          availableCreditMinor: 225,
        },
      }],
    })).toMatchObject({
      metrics: [
        { label: "Shadow estimate", value: "$7.25 USD", detail: expect.any(String) },
        { label: "Delivered charges", value: "No delivered charges", detail: expect.any(String) },
        { label: "Incomplete usage", value: "2", detail: expect.any(String) },
        { label: "Blocked usage", value: "1", detail: expect.any(String) },
        { label: "Over budget", value: "0", detail: expect.any(String) },
      ],
      rows: [{
        tenant: "Paid tenant",
        plan: "Growth",
        usage: "$7.25 USD shadow estimate · No delivered charges · 2 incomplete · 1 blocked",
        budget: "$10.00 USD overage limit",
        payg: "$2.25 USD available · $3.25 USD total · $5.00 USD paid · $1.00 USD reserved · $1.75 USD consumed",
      }],
    });
    const view = buildPlatformBillingView({
      currency: null,
      shadowEstimateMinor: null,
      premiumShadowEstimateMinor: null,
      deliveredChargeMinor: null,
      incompleteUsageCount: 0,
      blockedUsageCount: 0,
      tenantsOverBudget: 0,
      organizations: [{
        organizationId: "tenant-empty",
        organizationName: "New tenant",
        hasBillingData: false,
        subscription: null,
        usage: null,
        budget: null,
        payg: null,
      }],
    });

    expect(JSON.stringify(view)).toContain("No billing data");
    expect(JSON.stringify(view)).not.toContain("$0.00");
    expect(JSON.stringify(view)).not.toContain("posted");
    const multiOrderView = buildPlatformBillingView({
      currency: "USD",
      shadowEstimateMinor: null,
      premiumShadowEstimateMinor: null,
      deliveredChargeMinor: null,
      incompleteUsageCount: 0,
      blockedUsageCount: 0,
      tenantsOverBudget: 0,
      organizations: [{
        organizationId: "tenant-multi-order",
        organizationName: "Multi-order tenant",
        hasBillingData: true,
        subscription: null,
        usage: null,
        budget: null,
        payg: {
          currency: "USD",
          paidCreditMinor: 500,
          totalCreditMinor: 500,
          consumedCreditMinor: 0,
          reservedCreditMinor: 0,
          availableCreditMinor: 500,
        },
      }],
    });

    expect(multiOrderView.rows[0]?.payg).toContain("$5.00 USD paid");
    expect(multiOrderView.rows[0]?.payg).toContain("$5.00 USD available");
  });
});

const tenantSession: ZaraAuthSession = {
  user: {
    id: "user-tenant-admin",
    name: "Tenant admin",
    email: "tenant@example.com",
  },
  organization: {
    id: "tenant-west-africa",
    name: "Tuzzy Labs",
    role: "admin",
  },
};

const platformSession: ZaraAuthSession = {
  user: {
    id: "user-platform-admin",
    name: "Platform admin",
    email: "platform@example.com",
  },
  organization: null,
  platformRole: "platform_admin",
  platformAuth: {
    role: "platform_admin",
    assuranceLevel: "mfa",
    sessionAgeSeconds: 300,
    mfaVerified: true,
    passkeyVerified: false,
    mutationAllowed: true,
    supportActionAllowed: true,
    impersonationSafe: true,
    reason: "assured",
  },
};

const passwordOnlyPlatformSession: ZaraAuthSession = {
  user: {
    id: "user-platform-admin",
    name: "Platform admin",
    email: "platform@example.com",
  },
  organization: null,
  platformRole: "platform_admin",
  platformAuth: {
    role: "platform_admin",
    assuranceLevel: "password",
    sessionAgeSeconds: 300,
    mfaVerified: false,
    passkeyVerified: false,
    mutationAllowed: false,
    supportActionAllowed: false,
    impersonationSafe: false,
    reason: "mfa_required",
  },
};

const expiredPlatformSession: ZaraAuthSession = {
  user: {
    id: "user-platform-admin",
    name: "Platform admin",
    email: "platform@example.com",
  },
  organization: null,
  platformRole: "platform_admin",
  platformAuth: {
    role: "platform_admin",
    assuranceLevel: "mfa",
    sessionAgeSeconds: 30_001,
    mfaVerified: true,
    passkeyVerified: false,
    mutationAllowed: false,
    supportActionAllowed: false,
    impersonationSafe: false,
    reason: "session_expired",
  },
};

function createAuthClient(session: ZaraAuthSession | null): ZaraAuthClient {
  const snapshot: ZaraSessionSnapshot = {
    data: session,
    isPending: false,
    error: null,
  };

  return {
    useSession: () => snapshot,
    getContext: async () => toAuthContext(snapshot.data),
    signInEmail: async () => ({ ok: true }),
    signUpEmail: async () => ({ ok: true }),
    selectOrganization: async () => ({ ok: false, message: "Organization selection is not used in this test." }),
    requestPasswordReset: async () => ({ ok: true }),
    resetPassword: async () => ({ ok: true }),
    requestEmailVerification: async () => ({ ok: true }),
    listSessions: async () => ({ ok: true, sessions: [] }),
    revokeSession: async () => ({ ok: true }),
    createInvitation: async () => ({ ok: false, message: "Invitations are not used in this test." }),
    listInvitations: async () => ({ ok: true, invitations: [] }),
    revokeInvitation: async () => ({ ok: false, message: "Invitations are not used in this test." }),
    acceptInvitation: async () => ({ ok: false, message: "Invitations are not used in this test." }),
    signOut: async () => ({ ok: true }),
  };
}

function toAuthContext(session: ZaraAuthSession | null): ZaraAuthContext {
  return {
    authenticated: session !== null,
    user: session?.user ?? null,
    activeOrganization: session?.organization ?? null,
    memberships: session?.organization === null || session === null
      ? []
      : [
          {
            organizationId: session.organization.id,
            organizationName: session.organization.name,
            role: session.organization.role,
          },
        ],
    activeWorkspace: null,
    platformRole: session?.platformRole ?? null,
    platformAuth: session?.platformAuth ?? signedOutPlatformAuth(),
    permissions: {
      tenant: [],
      platform: [],
    },
  };
}

function signedOutPlatformAuth(): ZaraAuthContext["platformAuth"] {
  return {
    role: null,
    assuranceLevel: "none",
    sessionAgeSeconds: null,
    mfaVerified: false,
    passkeyVerified: false,
    mutationAllowed: false,
    supportActionAllowed: false,
    impersonationSafe: false,
    reason: "signed_out",
  };
}
