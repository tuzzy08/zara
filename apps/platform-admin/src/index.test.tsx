/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZaraAuthClient, ZaraAuthContext, ZaraAuthSession, ZaraSessionSnapshot } from "@zara/auth-client";

import { buildPlatformBillingView, PlatformAdminApp } from "./index";
import { MfaPanel } from "./mfa-panel";

describe("platform admin auth gate", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("requires platform-admin session state before rendering platform operations", async () => {
    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(null)} />)).toContain(
      "Checking Zara Admin session",
    );

    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(tenantSession)} />)).toContain(
      "Platform access required",
    );

    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} />)).toContain(
      "Platform operations",
    );
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      totpURI: "otpauth://totp/Zara:test?secret=JBSWY3DPEHPK3PXP&issuer=Zara", backupCodes: ["test-backup"],
    }))).mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "private", user: {} })));
    vi.stubGlobal("fetch", fetch);
    const verified = vi.fn();
    render(<MfaPanel allowSetup onVerified={verified} />);
    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create setup code" }));
    expect(await screen.findByText("test-backup")).toBeTruthy();
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByRole("img", { name: "Authenticator setup QR code" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    expect((screen.getByRole("button", { name: "Verify code" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I saved my backup codes."));
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText(/Verification failed/)).toBeTruthy();
    expect(verified).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("test-backup")).toBeNull();
    expect(screen.queryByRole("img", { name: "Authenticator setup QR code" })).toBeNull();
    cleanup();
    render(<PlatformAdminApp authClient={{ ...createAuthClient(null), signInEmail: async () => ({ ok: true, twoFactorRedirect: true }) }} />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByLabelText("Authenticator code")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up authenticator" })).toBeNull();
    cleanup();
    fetch.mockImplementation(async () => new Response("null"));
    render(<PlatformAdminApp authClient={createAuthClient(passwordOnlyPlatformSession)} route="/billing" />);
    expect(await screen.findByRole("button", { name: "Set up authenticator" })).toBeTruthy();
  });

  it("keeps billing approval owner-only and requires fresh MFA", async () => {
    const expired = renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(expiredPlatformSession)} />);

    expect(expired).toContain("Session expired");
    expect(expired).toContain("Sign in again");

    const passwordOnly = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(passwordOnlyPlatformSession)} route="/runtime" />,
    );

    expect(passwordOnly).toContain("MFA or passkey required");
    expect(passwordOnly).toContain("disabled=\"\"");
    expect(passwordOnly).toContain("Sign out");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200 })));
    for (const session of [platformSession, passwordOnlyPlatformSession, {
      ...passwordOnlyPlatformSession, platformRole: "platform_owner" as const,
      platformAuth: { ...passwordOnlyPlatformSession.platformAuth!, role: "platform_owner" as const },
    }]) {
      render(<PlatformAdminApp authClient={createAuthClient(session)} route="/billing" />);
      expect(await screen.findByRole("heading", { name: "Billing delivery" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Enable billing" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Stop billing" })).toBeNull();
      cleanup();
    }

    let decision: Record<string, unknown> | null = null;
    const writes: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        const body = JSON.parse(options.body as string) as Record<string, unknown>;
        writes.push(body);
        decision = { ...body, id: body.requestId, effectiveAt: "2026-10-10T12:00:00Z",
          releaseId: "release-one", catalogId: "catalog-one", actorUserId: "owner" };
        if (writes.length === 1) throw new TypeError("Connection lost after save");
      }
      return new Response(JSON.stringify(decision), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PlatformAdminApp authClient={createAuthClient({
      ...platformSession, platformRole: "platform_owner",
      platformAuth: { ...platformSession.platformAuth!, role: "platform_owner" },
    })} route="/billing" />);
    expect(await screen.findByText("No owner decision saved.")).toBeTruthy();
    const enable = screen.getByRole("button", { name: "Enable billing" });
    expect((enable as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Approve this release" } });
    fireEvent.click(screen.getByLabelText("I confirm this billing change."));
    fireEvent.click(enable);
    expect(await screen.findByText(/The result is not confirmed/)).toBeTruthy();
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry the same change" }));
    expect(await screen.findByText("Owner approval enabled.")).toBeTruthy();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({ enabled: true, expectedDecisionId: null, reason: "Approve this release" });
    expect(screen.getByText(/release-one/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Stop for review" } });
    fireEvent.click(screen.getByLabelText("I confirm this billing change."));
    fireEvent.click(screen.getByRole("button", { name: "Stop billing" }));
    await waitFor(() => expect(screen.getByText("Owner approval stopped.")).toBeTruthy());
    expect(writes[2]).toMatchObject({ enabled: false, expectedDecisionId: writes[0]?.requestId, reason: "Stop for review" });
    expect(writes[2]?.requestId).not.toBe(writes[0]?.requestId);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")
      .every(([, options]) => options?.credentials === "include")).toBe(true);
    fetchMock.mockImplementation(async (_url, options) => options?.method === "PATCH"
      ? new Response("{}", { status: 409 })
      : new Response(JSON.stringify(decision), { status: 200 }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Review a new approval" } });
    fireEvent.click(screen.getByLabelText("I confirm this billing change."));
    fireEvent.click(screen.getByRole("button", { name: "Enable billing" }));
    expect(await screen.findByText(/The decision changed. Review/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry the same change" })).toBeNull();
    expect((screen.getByRole("button", { name: "Enable billing" }) as HTMLButtonElement).disabled).toBe(true);
    fetchMock.mockImplementation(async (_url, options) => options?.method === "PATCH"
      ? new Response("{}", { status: 403 })
      : new Response(JSON.stringify(decision), { status: 200 }));
    fireEvent.click(screen.getByLabelText("I confirm this billing change."));
    fireEvent.click(screen.getByRole("button", { name: "Enable billing" }));
    expect(await screen.findByText(/Change refused. Verify/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry the same change" })).toBeNull();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh decision" }));
    expect(await screen.findByText(/Cannot read the owner decision/)).toBeTruthy();
    expect(screen.queryByText("Owner approval stopped.")).toBeNull();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh decision" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Refresh decision" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/Cannot read the owner decision/)).toBeTruthy();
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
