import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ZaraAuthClient, ZaraAuthContext, ZaraAuthSession, ZaraSessionSnapshot } from "@zara/auth-client";

import { PlatformAdminApp } from "./index";

describe("platform admin auth gate", () => {
  it("requires platform-admin session state before rendering platform operations", () => {
    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(null)} />)).toContain(
      "Sign in to Zara Admin",
    );
    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(null)} />)).toContain(
      "name=\"email\"",
    );
    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(null)} />)).toContain(
      "name=\"password\"",
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
      renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} route="/integrations" />),
    ).toContain("Integration operations");
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
  });

  it("renders runtime prompt policy editing controls for platform admins", () => {
    const runtime = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(platformSession)} route="/runtime" />,
    );

    expect(runtime).toContain("Runtime prompt policy");
    expect(runtime).toContain("Guardrails");
    expect(runtime).toContain("Billing role template");
    expect(runtime).toContain("name=\"reason\"");
    expect(runtime).toContain("Save prompt policy");
  });

  it("renders platform-staff AI observability and runtime eval gate status", () => {
    const runtime = renderToStaticMarkup(
      <PlatformAdminApp authClient={createAuthClient(platformSession)} route="/runtime" />,
    );

    expect(runtime).toContain("AI runtime health");
    expect(runtime).toContain("Intent fallback rate");
    expect(runtime).toContain("Classifier confidence");
    expect(runtime).toContain("LangSmith export health");
    expect(runtime).toContain("Runtime eval gate");
    expect(runtime).toContain("npm run eval:runtime");
    expect(runtime).toContain("PSTN call quality");
    expect(runtime).toContain("First response p95");
    expect(runtime).toContain("No-frame timeouts");
    expect(runtime).toContain("npm run eval:pstn");
    expect(runtime).toContain("Platform staff only");
    expect(runtime).not.toMatch(/raw transcript|unredacted|credential|secret/i);
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
