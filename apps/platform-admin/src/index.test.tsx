import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ZaraAuthClient, ZaraAuthSession, ZaraSessionSnapshot } from "@zara/auth-client";

import { PlatformAdminApp } from "./index";

describe("platform admin auth gate", () => {
  it("requires platform-admin session state before rendering platform operations", () => {
    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(null)} />)).toContain(
      "Sign in to Zara Admin",
    );

    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(tenantSession)} />)).toContain(
      "Platform access required",
    );

    expect(renderToStaticMarkup(<PlatformAdminApp authClient={createAuthClient(platformSession)} />)).toContain(
      "Platform operations",
    );
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
};

function createAuthClient(session: ZaraAuthSession | null): ZaraAuthClient {
  const snapshot: ZaraSessionSnapshot = {
    data: session,
    isPending: false,
    error: null,
  };

  return {
    useSession: () => snapshot,
    signInEmail: async () => ({ ok: true }),
    signUpEmail: async () => ({ ok: true }),
    signOut: async () => ({ ok: true }),
  };
}
