/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ZaraAuthActionResult,
  ZaraAuthClient,
  ZaraAuthSession,
  ZaraSessionSnapshot,
  ZaraSignInEmailInput,
  ZaraSignUpEmailInput,
} from "@zara/auth-client";
import {
  archiveWorkspace,
  createAgentRoleNode,
  createDefaultWorkspaceSeedState,
  getIntegrationProviderCatalog,
  createWorkflowGraph,
  createWorkspace,
  createWorkspaceAuditEntry,
  publishWorkflowVersion,
  renameWorkspace,
  restoreWorkspace,
  revokeWorkspaceMembership,
  setWorkspaceMembershipRole,
  slugifyWorkspaceName,
  validateWorkspaceCreate,
  type PublishedWorkflowVersion,
  type TenantRole,
  type WorkspaceSeedState,
} from "@zara/core";

vi.mock("@zara/auth-client", () => ({
  authClientPackageName: "@zara/auth-client",
  tenantAuthClient: {
    useSession: () => ({
      data: {
        user: {
          id: "user-ops-lead",
          name: "Operations lead",
          email: "ops@tuzzy.example",
        },
        organization: {
          id: "tenant-west-africa",
          name: "Tuzzy Labs",
          role: "admin",
        },
      },
      isPending: false,
      error: null,
    }),
    getContext: async () => ({
      authenticated: true,
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      activeOrganization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "admin",
      },
      memberships: [],
      activeWorkspace: {
        id: "workspace-operations",
        name: "Operations",
      },
      platformRole: null,
      platformAuth: {
        role: null,
        assuranceLevel: "none",
        sessionAgeSeconds: null,
        mfaVerified: false,
        passkeyVerified: false,
        mutationAllowed: false,
        supportActionAllowed: false,
        impersonationSafe: false,
        reason: "signed_out",
      },
      permissions: {
        tenant: [],
        platform: [],
      },
    }),
    signInEmail: async () => ({ ok: true }),
    signUpEmail: async () => ({ ok: true }),
    selectOrganization: async () => ({ ok: true }),
    requestPasswordReset: async () => ({ ok: true }),
    resetPassword: async () => ({ ok: true }),
    requestEmailVerification: async () => ({ ok: true }),
    listSessions: async () => ({
      ok: true,
      sessions: [
        {
          id: "session-current",
          current: true,
          createdAt: "2026-05-31T10:00:00.000Z",
          updatedAt: "2026-05-31T10:05:00.000Z",
          expiresAt: "2026-06-07T10:00:00.000Z",
          ipAddress: "127.0.0.1",
          userAgent: "Primary browser",
        },
      ],
    }),
    revokeSession: async () => ({ ok: true }),
    createInvitation: async (input: unknown) => {
      const response = await fetch("/api/auth/invitations", {
        body: JSON.stringify(input),
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      return await response.json();
    },
    listInvitations: async (input: { organizationId: string }) => {
      const response = await fetch(`/api/auth/invitations?organizationId=${encodeURIComponent(input.organizationId)}`, {
        credentials: "include",
      });
      return await response.json();
    },
    revokeInvitation: async (input: { invitationId: string }) => {
      const response = await fetch(`/api/auth/invitations/${encodeURIComponent(input.invitationId)}/revoke`, {
        credentials: "include",
        method: "POST",
      });
      return await response.json();
    },
    acceptInvitation: async () => ({ ok: true }),
    signOut: async () => ({ ok: true }),
  },
}));

import { App } from "./App";
import { savePublishedWorkflowVersion } from "./workflowSandboxRegistry";

function LocationPathProbe() {
  return <div data-testid="location-path">{useLocation().pathname}</div>;
}

describe("tenant dashboard shell", () => {
  let apiMock: ReturnType<typeof installApiMock>;
  let liveSandboxMock: ReturnType<typeof installLiveSandboxMock>;

  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
    liveSandboxMock = installLiveSandboxMock();
    vi.stubGlobal("WebSocket", liveSandboxMock.WebSocket);
    apiMock = installApiMock(liveSandboxMock);
    seedPublishedWorkflowForApp({
      workflowId: "workflow-inbound-support-triage",
      workspaceId: "workspace-operations",
      name: "Inbound support triage",
      createdAt: "2026-05-20T09:00:00.000Z",
    });
    seedPublishedWorkflowForApp({
      workflowId: "workflow-support-triage",
      workspaceId: "workspace-support",
      name: "Support triage",
      createdAt: "2026-05-20T09:00:00.000Z",
    });
    seedPublishedWorkflowForApp({
      workflowId: "workflow-sales-triage",
      workspaceId: "workspace-sales",
      name: "Sales triage",
      createdAt: "2026-05-20T09:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders the voice-agent agency landing for signed-out visitors", () => {
    const authClient = createTestAuthClient(null);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /AI phone agents,\s*built and managed/i })).toBeTruthy();
    expect(document.title).toBe("Zara Voice Automation | Managed AI Phone Agents");
    expect(screen.getByText("AI PHONE AGENTS")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Book strategy call" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByLabelText("Voice routing workflow mockup")).toBeTruthy();
    expect(screen.getByLabelText("Proof points")).toBeTruthy();
    expect(screen.getAllByText("(415) 555-0198").length).toBeGreaterThan(0);
    expect(screen.getByText("San Francisco, CA")).toBeTruthy();
    expect(screen.getByText("I need to book a cleaning this weekend.")).toBeTruthy();
    expect(screen.getAllByText("May 27, 2026").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Everything we handle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Built for high-impact conversations" })).toBeTruthy();
    expect(screen.getAllByLabelText("Zara voice automation logo mark").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Industry specialists icon")).toBeTruthy();
    expect(screen.getByLabelText("Fast time to value icon")).toBeTruthy();
    expect(screen.getByLabelText("Secure & compliant icon")).toBeTruthy();
    expect(screen.getByLabelText("AI Receptionist service icon")).toBeTruthy();
    expect(screen.getByLabelText("Lead Qualification service icon")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "From hello to handoff, seamlessly" })).toBeTruthy();
    expect(screen.getByText("CRM Update")).toBeTruthy();
    expect(screen.getByText("Optimize")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Simple packages for managed voice agents" })).toBeTruthy();
    expect(screen.getByText("TRUSTED BY BUSINESSES THAT CAN'T AFFORD MISSED CALLS")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ready to transform your phone into a growth engine?" })).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain("Zara Voice Automation");
  }, 15_000);

  it("renders a dedicated auth page at /login for signed-out visitors", () => {
    const authClient = createTestAuthClient(null);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Sign in to Zara" })).toBeTruthy();
    expect(document.title).toBe("Zara Tenant Login | Zara Voice Automation");
    expect(screen.getByRole("main").className).toContain("auth-screen");
    expect(screen.queryByRole("heading", { name: /AI phone agents,\s*built and managed/i })).toBeNull();
  });

  it("requests a password reset from the signed-out login screen", async () => {
    const authClient = createTestAuthClient(null);
    const requestPasswordReset = vi.fn(async () => ({ ok: true as const }));
    authClient.requestPasswordReset = requestPasswordReset;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ops@tuzzy.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith({
        email: "ops@tuzzy.example",
        redirectTo: expect.stringMatching(/\/reset-password$/),
      }),
    );
    expect(screen.getByRole("status").textContent).toBe("If that account exists, a reset link has been sent.");
  });

  it("submits reset tokens from the reset-password route", async () => {
    const authClient = createTestAuthClient(null);
    const resetPassword = vi.fn(async () => ({ ok: true as const }));
    authClient.resetPassword = resetPassword;

    render(
      <MemoryRouter initialEntries={["/reset-password?token=reset-token"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        token: "reset-token",
        newPassword: "new-password123",
      }),
    );
    expect(screen.getByRole("status").textContent).toBe("Password updated. Sign in with your new password.");
  });

  it("gates tenant routes behind login and supports sign out", async () => {
    const authClient = createTestAuthClient(null);

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <LocationPathProbe />
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Sign in to Zara" })).toBeTruthy();
    expect(screen.queryByLabelText("Tenant")).toBeNull();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ops@tuzzy.example" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open profile menu" }).textContent).toContain("Operations lead");

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-path").textContent).toBe("/");
    }, { timeout: 10_000 });
    expect(screen.getByRole("heading", { name: /AI phone agents,\s*built and managed/i })).toBeTruthy();
    expect(screen.getByTestId("location-path").textContent).toBe("/");
    expect(screen.queryByLabelText("Tenant")).toBeNull();
  });

  it("loads auth context once for a stable signed-in session", async () => {
    const session: ZaraAuthSession = {
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      organization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "admin",
      },
    };
    const authClient = createTestAuthClient(session);
    const getContext = vi.fn(async () => toAuthContext(session));
    authClient.getContext = getContext;
    authClient.useSession = () => ({
      data: {
        user: { ...session.user },
        organization: session.organization === null ? null : { ...session.organization },
      },
      isPending: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("opens the tenant shell from server-owned auth context when Better Auth omits organization details", async () => {
    const authClient = createTestAuthClient({
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      organization: null,
    });
    authClient.useSession = () => ({
      data: {
        user: {
          id: "user-ops-lead",
          name: "Operations lead",
          email: "ops@tuzzy.example",
        },
        organization: null,
      },
      isPending: false,
      error: null,
    });
    authClient.getContext = async () => ({
      authenticated: true,
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      activeOrganization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "admin",
      },
      memberships: [
        {
          organizationId: "tenant-west-africa",
          organizationName: "Tuzzy Labs",
          role: "admin",
        },
      ],
      activeWorkspace: {
        id: "workspace-support",
        name: "Support",
      },
      platformRole: null,
      platformAuth: {
        role: null,
        assuranceLevel: "none",
        sessionAgeSeconds: null,
        mfaVerified: false,
        passkeyVerified: false,
        mutationAllowed: false,
        supportActionAllowed: false,
        impersonationSafe: false,
        reason: "signed_out",
      },
      permissions: {
        tenant: ["tenant:read"],
        platform: [],
      },
    });

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(screen.queryByText("Workspace access required")).toBeNull();
  });

  it("opens the tenant shell from server-owned auth context when no Better Auth session snapshot is mounted", async () => {
    const authClient = createTestAuthClient(null);
    const getContext = vi.fn(async () => ({
      authenticated: true,
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      activeOrganization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "admin" as const,
      },
      memberships: [
        {
          organizationId: "tenant-west-africa",
          organizationName: "Tuzzy Labs",
          role: "admin" as const,
        },
      ],
      activeWorkspace: {
        id: "workspace-support",
        name: "Support",
      },
      platformRole: null,
      platformAuth: {
        role: null,
        assuranceLevel: "none" as const,
        sessionAgeSeconds: null,
        mfaVerified: false,
        passkeyVerified: false,
        mutationAllowed: false,
        supportActionAllowed: false,
        impersonationSafe: false,
        reason: "signed_out" as const,
      },
      permissions: {
        tenant: ["tenant:read"],
        platform: [],
      },
    }));
    authClient.getContext = getContext;

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Workspace access required")).toBeNull();
  });

  it("exposes tenant signup from /signup", async () => {
    const authClient = createTestAuthClient(null);

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Create your Zara account" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Builder" },
    });
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Acme Voice Ops" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "builder@tuzzy.example" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-horse-battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open profile menu" }).textContent).toContain("New Builder");
  });

  it("keeps signup recoverable after a partial onboarding failure", async () => {
    const authClient = createSignupSequenceAuthClient([
      {
        ok: false,
        message: "Organization creation failed after the user account was created. Retry to finish setup.",
      },
      { ok: true },
    ]);

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Organization creation failed after the user account was created. Retry to finish setup.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open profile menu" }).textContent).toContain("New Builder");
  });

  it("shows duplicate tenant-name onboarding errors without entering the tenant app", async () => {
    const authClient = createSignupSequenceAuthClient([
      {
        ok: false,
        message: "That tenant organization name is already in use. Choose a different name.",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    fillSignupForm();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That tenant organization name is already in use. Choose a different name.",
    );
    expect(screen.queryByLabelText("Tenant")).toBeNull();
  });

  it("shows an organization chooser for multi-tenant users before tenant routes render", async () => {
    const authClient = createOrganizationChooserAuthClient();

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Choose a tenant" })).toBeTruthy();
    expect(screen.queryByLabelText("Tenant")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose Northwind Support" }));

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open profile menu" }).textContent).toContain("Northwind Support");
  });

  it("renders the tenant shell and lets the user toggle dark mode from the profile menu", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Tenant")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Workflows" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sandbox" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Calls" })).toBeTruthy();
    expect(screen.getByTestId("shell-scroll-region")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Operations");

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));

    const themeToggle = screen.getByRole("menuitem", { name: "Dark mode" });

    expect(themeToggle).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(themeToggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
  }, 15_000);

  it("ignores the last active workspace when the signed-in user cannot access it", async () => {
    window.localStorage.setItem("zara.web.active-workspace.v1", "workspace-sales");
    window.localStorage.setItem("zara.web.active-workspace.v1:tenant-west-africa", "workspace-sales");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Operations");
    });
    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).not.toContain("Sales");
  }, 15_000);

  it("renders the dashboard with real workspace metrics instead of sidebar section links", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Operations");
    });
    expect(screen.queryByRole("navigation", { name: "Workspace sections" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Workflows section" })).toBeNull();

    expect(await screen.findByRole("article", { name: "Budget used metric" })).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Budget used metric" })).getByText("$742.18")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Active tool grants metric" })).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Memory approvals metric" })).getByText("1 pending")).toBeTruthy();
    expect(screen.getByText("Connector health")).toBeTruthy();
    expect(screen.getByText("2 of 3 healthy")).toBeTruthy();
    expect(screen.getByText("Latest dispatch")).toBeTruthy();
    expect(screen.queryByText("Answer rate")).toBeNull();
    expect(screen.queryByText("14 active")).toBeNull();
    expect(screen.queryByText("Sandbox healthy")).toBeNull();
    expect(screen.queryByText("Live call pressure is stable across support and reception.")).toBeNull();
    expect(screen.queryByText("Realtime spend")).toBeNull();
  });

  it("renders tenant integrations controls instead of the dashboard placeholder", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Integration command center" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tenant control surface" })).toBeNull();
    expect(screen.getAllByText("Zendesk Support").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Webhook HTTP").length).toBeGreaterThan(0);
    expect(screen.getByText("workflow-support-triage")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check health for Zendesk Support" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/integrations/connections/integration-zendesk/health-check"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    expect(screen.queryByText(/oauth-token/i)).toBeNull();
  });

  it("renders tenant integration tools from the API catalog without server-owned metadata", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Search tickets")).toBeTruthy();
    expect(screen.getByText("Create ticket")).toBeTruthy();
    expect(screen.getByText("Update ticket")).toBeTruthy();
    expect(screen.getByText("Look up contact")).toBeTruthy();
    expect(screen.getByText("Read availability")).toBeTruthy();
    expect(screen.getByText("Search knowledge")).toBeTruthy();
    expect(screen.getByText("Call webhook")).toBeTruthy();

    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/integrations/catalog"),
      expect.anything(),
    );
    expect(apiMock.fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/organizations/tenant-west-africa/integrations/connectors/"),
    )).toBe(false);

    const renderedText = document.body.textContent ?? "";
    expect(renderedText).not.toContain("https://api.zendesk.com");
    expect(renderedText).not.toContain("authHeaderStrategy");
    expect(renderedText).not.toContain("secretSchemaId");
    expect(renderedText).not.toContain("executorId");
  });

  it("lets tenant admins configure Zendesk credentials without an API URL field", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Integration command center" })).toBeTruthy();
    expect(screen.queryByLabelText(/api url/i)).toBeNull();

    fireEvent.change(screen.getByLabelText("Zendesk subdomain"), {
      target: { value: "tuzzy-support" },
    });
    fireEvent.change(screen.getByLabelText("Zendesk email"), {
      target: { value: "support@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Zendesk API token"), {
      target: { value: "zendesk-api-token-123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Zendesk credentials" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/integrations/zendesk/configure"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"subdomain":"tuzzy-support"'),
        }),
      ),
    );
    const configureCall = apiMock.fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/organizations/tenant-west-africa/integrations/zendesk/configure"),
    );
    expect(String(configureCall?.[1]?.body)).toContain('"email":"support@example.com"');
    expect(String(configureCall?.[1]?.body)).toContain('"apiToken":"zendesk-api-token-123456"');
    expect(String(configureCall?.[1]?.body)).not.toContain("apiUrl");
    expect(await screen.findByText(/tuzzy-support\.zendesk\.com/)).toBeTruthy();
    expect(screen.queryByText("zendesk-api-token-123456")).toBeNull();
  });

  it("shows scoped integration connections and promotes workspace-owned connections without adding grants", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations"]}>
        <App />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("Organization-wide")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("This workspace")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    const grantCountBefore = document.body.textContent?.match(/zendesk\.tickets\.search/g)?.length ?? 0;

    fireEvent.click(screen.getByRole("button", { name: "Promote Notion to organization scope" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/integrations/connections/integration-notion/promote"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"workspaceId":"workspace-operations"'),
        }),
      ),
    );

    const promoteCall = apiMock.fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/organizations/tenant-west-africa/integrations/connections/integration-notion/promote"),
    );
    expect(String(promoteCall?.[1]?.body)).toContain('"reason":"Make this connection available across organization workspaces."');
    expect(document.body.textContent?.match(/Organization-wide/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent?.match(/zendesk\.tickets\.search/g)?.length ?? 0).toBe(grantCountBefore);
  });

  it("renders tenant memory controls instead of the dashboard placeholder", async () => {
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Approved memory")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tenant control surface" })).toBeNull();
    expect(screen.getByText("Caller prefers WhatsApp follow-up after billing calls.")).toBeTruthy();
    expect(screen.getByText("Caller mentioned a new Lagos renewal contact.")).toBeTruthy();
    expect(screen.getByText("Billing disputes route to the billing specialist.")).toBeTruthy();
    expect(screen.getByText("Partial Failure")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve memory draft memory-draft-1" }));

    expect(await screen.findByText("Memory draft approved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export tenant memory" })).toBeTruthy();
  });

  it("renders tenant billing and Polar payment controls instead of the dashboard placeholder", async () => {
    render(
      <MemoryRouter initialEntries={["/billing"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Polar customer state")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tenant control surface" })).toBeNull();
    expect(screen.getAllByText("Growth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$742.18").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Premium realtime minutes").length).toBeGreaterThan(0);
    expect(screen.getByText("INV-2026-051")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Polar customer portal" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/billing/customer-portal"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    expect(screen.queryByText("POLAR_ACCESS_TOKEN")).toBeNull();
  });

  it("creates and switches workspaces from the tenant shell", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Retention desk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Retention desk");

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Support" }));

    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Support");
  });

  it("does not load invitation management data on workflow pages", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Run in sandbox" })).toBeTruthy();
    expect(apiMock.fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/invitations\?/),
      expect.anything(),
    );
  });

  it("opens an inline sandbox drawer for the current draft workflow", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Front desk triage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Validation").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Tool" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Handoff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escalation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Intent route" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exit" })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run in sandbox" }).disabled).toBe(false);
    expect(screen.queryByText("Workflow nodes")).toBeNull();
    expect(screen.queryByText("Manifest preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    const workflowSandbox = screen.getByRole("complementary", { name: "Workflow sandbox" });
    expect(workflowSandbox).toBeTruthy();
    expect(within(workflowSandbox).getAllByText("Draft test (browser)").length).toBeGreaterThan(0);
    expect(within(workflowSandbox).getByText("Inbound support triage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start draft sandbox" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use typed run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close workflow sandbox" })).toBeTruthy();
    expect(screen.queryByText("Runtime session")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use typed run" }));
    await screen.findByText("Typed sandbox is live.");
    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Can you check a billing charge before I publish this workflow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect(await screen.findByText("Billing support is ready to help with that request.")).toBeTruthy();
    expect(screen.getAllByText("Can you check a billing charge before I publish this workflow?").length).toBeGreaterThan(0);
    expect(await screen.findByText("Customer profile lookup completed in 42ms.")).toBeTruthy();
    expect(screen.getByText("Cartesia Sonic 3 first byte in 180ms")).toBeTruthy();
    expect(screen.getByText(/Estimated turn cost \$0\.0019/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close workflow sandbox" }));
    expect(screen.queryByRole("complementary", { name: "Workflow sandbox" })).toBeNull();
  }, 15_000);

  it("starts workflow sandbox sessions in the server-owned active workspace", async () => {
    const authClient = createTestAuthClient({
      user: {
        id: "user-new-owner",
        name: "New Owner",
        email: "owner@tuzzy.example",
      },
      organization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "owner",
      },
    });
    apiMock.grantWorkspaceAccess({
      workspaceId: "workspace-support",
      userId: "user-new-owner",
      role: "owner",
    });
    window.localStorage.setItem("zara.web.active-workspace.v1:tenant-west-africa", "workspace-operations");

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Run in sandbox" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Support"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Use typed run" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const createSessionCall = apiMock.fetchMock.mock.calls.find(([input, init]) => {
      const requestUrl = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://127.0.0.1:3000",
      );
      return requestUrl.pathname === "/organizations/tenant-west-africa/sandbox/live-sessions"
        && init?.method === "POST";
    });
    const createSessionBody = JSON.parse(String(createSessionCall?.[1]?.body ?? "{}")) as Record<string, unknown>;

    expect(createSessionBody.workspaceId).toBe("workspace-support");
    expect(createSessionBody.actorUserId).toBe("user-new-owner");
  }, 15_000);

  it("keeps the server-owned active workspace when workspace membership state is stale", async () => {
    const authClient = createTestAuthClient({
      user: {
        id: "user-new-owner",
        name: "New Owner",
        email: "owner@tuzzy.example",
      },
      organization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "owner",
      },
    });
    window.localStorage.setItem("zara.web.active-workspace.v1:tenant-west-africa", "workspace-operations");

    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Run in sandbox" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Support"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Use typed run" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const createSessionCall = apiMock.fetchMock.mock.calls.find(([input, init]) => {
      const requestUrl = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://127.0.0.1:3000",
      );
      return requestUrl.pathname === "/organizations/tenant-west-africa/sandbox/live-sessions"
        && init?.method === "POST";
    });
    const createSessionBody = JSON.parse(String(createSessionCall?.[1]?.body ?? "{}")) as Record<string, unknown>;

    expect(createSessionBody.workspaceId).toBe("workspace-support");
    expect(createSessionBody.actorUserId).toBe("user-new-owner");
  }, 15_000);

  it("applies the balanced runtime profile to the draft sandbox before publish", () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Workflow runtime profile"), {
      target: { value: "balanced" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    expect(screen.getAllByText("Balanced profile").length).toBeGreaterThan(0);
    expect(screen.getByText("Neural HD voice")).toBeTruthy();
  });

  it("publishes builder manifests against the browser sandbox path until a phone route is selected", () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    publishCurrentWorkflow("Browser sandbox lane");

    const storedVersions = JSON.parse(
      window.localStorage.getItem("zara.web.published-workflows.v1") ?? "[]",
    ) as Array<{
      manifestPreview: {
        telephonyProvider: string;
        budget: {
          monthlyCapUsd: number;
        };
      };
    }>;
    const publishedVersion = storedVersions.at(-1);

    expect(publishedVersion?.manifestPreview.telephonyProvider).toBe("browser-webrtc");
    expect(publishedVersion?.manifestPreview.budget.monthlyCapUsd).toBe(80);
  }, 15_000);

  it("launches the shared Phone test sandbox from the workflow page after a number is routed", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
        <LocationPathProbe />
      </MemoryRouter>,
    );

    publishCurrentWorkflow("Support billing lane");

    fireEvent.click(screen.getByRole("link", { name: "Calls" }));
    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect edge" }));
    expect(await screen.findByText("Zara Edge West")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Provision number" }));
    expect((await screen.findAllByText("+14155550110")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Workflow route for +14155550110"), {
      target: { value: "workflow-inbound-support-triage-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155550110" }));
    expect((await screen.findAllByText("Support billing lane")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("link", { name: "Workflows" }));
    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Phone test (Twilio/PSTN)" }).disabled).toBe(false),
    );
    expect(screen.getByRole("button", { name: "Draft test (browser)" })).toBeTruthy();
    expect(screen.queryByText("Routed number")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use typed route" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Phone test (Twilio/PSTN)" }));

    expect(screen.getByRole("combobox", { name: "Routed phone number" })).toBeTruthy();
    expect(screen.getByText("Zara Edge West")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Open Phone test for +14155550110" }));

    expect(screen.getByTestId("location-path").textContent).toBe("/sandbox");
    expect(await screen.findByRole("button", { name: "Phone test (Twilio/PSTN)" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Routed phone number").value).toBe("phone-number-14155550110");
  }, 15_000);

  it("loads sandbox workflows only from the active workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Support" }));
    publishCurrentWorkflow("Support billing lane");

    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sales" }));
    publishCurrentWorkflow("Sales qualification lane");

    fireEvent.click(screen.getByRole("link", { name: "Sandbox" }));

    const workflowSelect = await screen.findByLabelText<HTMLSelectElement>("Published workflow");

    expect(workflowSelect.textContent).toContain("Sales qualification lane");
    expect(workflowSelect.textContent).not.toContain("Sales qualification lane v1");
    expect(workflowSelect.textContent).not.toContain("Support billing lane");
  }, 15_000);

  it("renders the sandbox runtime surface with call controls, tools, and live cost telemetry", () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "Sandbox" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start sandbox call" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use typed sandbox" })).toBeTruthy();
    expect(screen.getByLabelText("Published workflow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh workflows" })).toBeTruthy();
    expect(screen.getByText("Available tools")).toBeTruthy();
    expect(screen.getByText("Live cost")).toBeTruthy();
    expect(screen.getByText("Runtime decision")).toBeTruthy();
  });

  it("exposes clear published browser and Phone test sandbox modes", () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Published test (browser)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Phone test (Twilio/PSTN)" })).toBeTruthy();
    expect(screen.queryByText("Routed number")).toBeNull();
  });

  it("starts a protected Phone test waiting session from the unified sandbox", async () => {
    render(
      <MemoryRouter initialEntries={["/calls"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect edge" }));
    expect(await screen.findByText("Zara Edge West")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Provision number" }));
    expect((await screen.findAllByText("+14155550110")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Workflow route for +14155550110"), {
      target: { value: "workflow-inbound-support-triage-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155550110" }));
    expect((await screen.findAllByText("Inbound support triage")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("link", { name: "Sandbox" }));
    fireEvent.click(await screen.findByRole("button", { name: "Phone test (Twilio/PSTN)" }));

    expect(await screen.findByLabelText("Routed phone number")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Allowed caller number"), {
      target: { value: "+233201110001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Phone test" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/telephony/numbers/phone-number-14155550110/pstn-test-route"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect((await screen.findAllByText("Waiting for allowed caller")).length).toBeGreaterThan(0);
    expect(screen.getByText("+233201110001")).toBeTruthy();
    expect(screen.getByText("Verified webhook")).toBeTruthy();
    expect(screen.getByText("0 of 9 checkpoints")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "End Phone test" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "End Phone test" }));
    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/complete"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect((await screen.findAllByText("Manually ended")).length).toBeGreaterThan(0);
  }, 15_000);

  it("keeps premium realtime PSTN inside the unified Phone test sandbox with native-provider labeling", async () => {
    seedPublishedWorkflowForApp({
      workflowId: "workflow-premium-concierge",
      workspaceId: "workspace-operations",
      name: "Premium concierge lane",
      createdAt: "2026-05-20T10:00:00.000Z",
      runtimeProfile: "premium-realtime",
    });

    render(
      <MemoryRouter initialEntries={["/calls"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect edge" }));
    expect(await screen.findByText("Zara Edge West")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Provision number" }));
    expect((await screen.findAllByText("+14155550110")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Workflow route for +14155550110"), {
      target: { value: "workflow-premium-concierge-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155550110" }));
    expect((await screen.findAllByText("Premium concierge lane")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("link", { name: "Sandbox" }));
    fireEvent.click(await screen.findByRole("button", { name: "Phone test (Twilio/PSTN)" }));

    expect((await screen.findAllByText("Premium realtime PSTN (native provider)")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Allowed caller number"), {
      target: { value: "+233201110001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Phone test" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/telephony/numbers/phone-number-14155550110/pstn-test-route"),
        expect.objectContaining({
          body: expect.stringContaining('"runtimeProfile":"premium-realtime"'),
          method: "POST",
        }),
      ),
    );
    expect((await screen.findAllByText("Waiting for allowed caller")).length).toBeGreaterThan(0);
  }, 15_000);

  it("shows standardized number states on Calls and launches the shared Phone test sandbox", async () => {
    render(
      <MemoryRouter initialEntries={["/calls"]}>
        <App />
        <LocationPathProbe />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect edge" }));
    expect(await screen.findByText("Zara Edge West")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Provision number" }));
    expect(await screen.findByLabelText("Workflow route for +14155550110")).toBeTruthy();
    expect(await screen.findByText("Unassigned")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Workflow route for +14155550110"), {
      target: { value: "workflow-inbound-support-triage-v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155550110" }));

    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(await screen.findByLabelText("Activation summary for +14155550110")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Launch Phone test for +14155550110" }));

    expect(screen.getByTestId("location-path").textContent).toBe("/sandbox");
    expect(await screen.findByRole("button", { name: "Phone test (Twilio/PSTN)" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Routed phone number").value).toBe("phone-number-14155550110");
  }, 15_000);

  it("starts continuous voice capture without a manual send-turn step", async () => {
    installMicrophoneMock();

    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start sandbox call" }));

    expect(await screen.findByText("Microphone live. Speak naturally; turns are detected automatically.")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Voice capture active" })).toBeTruthy();
    expect(screen.getByText("Listening for caller speech")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Capture voice turn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send voice turn" })).toBeNull();
  }, 15_000);

  it("shows agent playback feedback while sandbox audio is playing", async () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use typed sandbox" }));
    expect((await screen.findAllByText("Typed sandbox is live.")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Please connect me to billing on the live number." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    expect(await screen.findByRole("status", { name: "Agent playback active" })).toBeTruthy();
    expect(screen.getByText("Playing agent response")).toBeTruthy();
  }, 15_000);

  it("marks the end call button as destructive while a sandbox call is active", async () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "End call" }).className).not.toContain("workflow-button-danger");

    fireEvent.click(screen.getByRole("button", { name: "Use typed sandbox" }));
    expect((await screen.findAllByText("Typed sandbox is live.")).length).toBeGreaterThan(0);

    expect(screen.getByRole("button", { name: "End call" }).className).toContain("workflow-button-danger");
  }, 15_000);

  it("exposes the same active end call affordance in the workflow sandbox drawer", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run in sandbox" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "End call" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Use typed run" }));
    expect(await screen.findByText("Typed sandbox is live.")).toBeTruthy();

    const endCallButton = screen.getByRole<HTMLButtonElement>("button", { name: "End call" });

    expect(endCallButton.disabled).toBe(false);
    expect(endCallButton.className).toContain("workflow-button-danger");

    fireEvent.click(endCallButton);

    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "End call" }).disabled).toBe(true));
  }, 15_000);

  it("blocks voice recording and shows a provider setup error when sandbox keys are missing", async () => {
    installMicrophoneMock();
    liveSandboxMock.setVoiceProviderConfigured(false);

    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start sandbox call" }));

    expect((await screen.findAllByText(/Live voice sandbox requires provider credentials before recording can start/)).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(document.querySelector(".workflow-toast")?.textContent ?? "").toContain(
        "Live voice sandbox requires provider credentials before recording can start",
      ),
    );
    expect(document.querySelector(".sandbox-controls")?.textContent ?? "").not.toContain(
      "Live voice sandbox requires provider credentials before recording can start",
    );
    expect(screen.queryByRole("button", { name: "Capture voice turn" })).toBeNull();
    expect(screen.queryByRole("status", { name: "Voice capture active" })).toBeNull();

    await waitFor(() => expect(document.querySelector(".workflow-toast")).toBeNull(), { timeout: 4_000 });
    fireEvent.click(screen.getByRole("button", { name: "Start sandbox call" }));

    await waitFor(() =>
      expect(document.querySelector(".workflow-toast")?.textContent ?? "").toContain(
        "Live voice sandbox requires provider credentials before recording can start",
      ),
    );
  }, 15_000);

  it("surfaces premium runtime policy on published workflows in sandbox", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Workflow runtime profile"), {
      target: { value: "premium-realtime" },
    });
    publishCurrentWorkflow("Premium concierge lane");
    fireEvent.click(screen.getByRole("link", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Published workflow"), {
      target: { value: "workflow-inbound-support-triage:v2" },
    });

    expect(screen.getAllByText("Premium realtime").length).toBeGreaterThan(0);
    expect(screen.queryByText("Server session required")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use typed sandbox" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
  }, 15_000);

  it("reconnects a published sandbox session after refresh and replays the saved timeline", async () => {
    const firstRender = render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use typed sandbox" }));
    expect((await screen.findAllByText("Typed sandbox is live.")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Email me at ada@example.com on +14155557890." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    expect(await screen.findByText("Billing support is ready to help with that request.")).toBeTruthy();

    firstRender.unmount();

    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("Reconnected to live sandbox session.")).length).toBeGreaterThan(0);
    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions/sandbox-live-1/reconnect"),
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions/sandbox-live-1/events"),
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(screen.getAllByText("Billing support is ready to help with that request.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Email me at ada@example.com on +14155557890.").length).toBeGreaterThan(0);
  }, 15_000);

  it("shows an active sandbox monitor and replays a redacted timeline", async () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use typed sandbox" }));
    expect((await screen.findAllByText("Typed sandbox is live.")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Caller turn"), {
      target: { value: "Reach me at +14155557890 or ada@example.com." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send caller turn" }));

    expect(await screen.findByText("Billing support is ready to help with that request.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh live monitor" }));

    expect(await screen.findByText("Active sandbox calls")).toBeTruthy();
    expect(screen.getAllByText("Front desk triage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cheap tier").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Inspect sandbox-live-1/i }));

    expect(await screen.findByText("Reach me at [redacted-phone] or [redacted-email].")).toBeTruthy();
    expect(screen.getAllByText("Customer profile lookup completed in 42ms.").length).toBeGreaterThan(0);
  }, 15_000);

  it("shows the escalation queue and lets an operator accept a pending escalation", async () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh escalation queue" }));

    expect(await screen.findByText("Billing managers")).toBeTruthy();
    expect(screen.getByText("Caller asked for a billing supervisor.")).toBeTruthy();
    expect(screen.getByText(/^Due /)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Accept escalation escalation-billing-1" }));

    expect(await screen.findByText("Accepted by user-ops-lead")).toBeTruthy();
    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/sandbox/live-sessions/escalations/escalation-billing-1/accept"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  }, 15_000);

  it("lets operators connect a BYO Twilio account, import numbers, route a workflow, and run an inbound dispatch test", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    publishCurrentWorkflow("Support billing lane");

    fireEvent.click(screen.getByRole("link", { name: "Calls" }));

    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Twilio account SID"), {
      target: { value: "AC1234567890abcdef1234567890abcd" },
    });
    fireEvent.change(screen.getByLabelText("Twilio auth token"), {
      target: { value: "twilio-auth-token-1234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));

    expect(await screen.findByText("Tenant Twilio account")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Validate provider" }));
    expect((await screen.findAllByText("Healthy")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Import phone numbers" }));
    expect((await screen.findAllByText("+14155557890")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Workflow route for +14155557890"), {
      target: { value: "workflow-inbound-support-triage-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155557890" }));
    expect((await screen.findAllByText("Support billing lane")).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Activation summary for +14155557890")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Activate live route for +14155557890" }));
    expect(await screen.findByText("Live route activated.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause live route for +14155557890" }));
    expect(await screen.findByText("Live route paused.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume live route for +14155557890" }));
    expect(await screen.findByText("Live route resumed.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run inbound dispatch" }));
    expect(await screen.findByText(/Routed \+14155557890 to Support billing lane/)).toBeTruthy();
  }, 15_000);

  it("lets operators delete a telephony connection and clears its imported inventory", async () => {
    render(
      <MemoryRouter initialEntries={["/calls"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Telephony operations")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Twilio account SID"), {
      target: { value: "AC1234567890abcdef1234567890abcd" },
    });
    fireEvent.change(screen.getByLabelText("Twilio auth token"), {
      target: { value: "twilio-auth-token-1234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));
    expect(await screen.findByText("Tenant Twilio account")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import phone numbers" }));
    expect((await screen.findAllByText("+14155557890")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Delete Tenant Twilio account" }));

    expect(await screen.findByText("Telephony connection deleted.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("+14155557890")).toBeNull());
  }, 15_000);

  it("surfaces telephony heartbeats, credential rotation, and loopback execution sessions", async () => {
    render(
      <MemoryRouter initialEntries={["/workflows"]}>
        <App />
      </MemoryRouter>,
    );

    publishCurrentWorkflow("Support billing lane");

    fireEvent.click(screen.getByRole("link", { name: "Calls" }));

    fireEvent.change(screen.getByLabelText("Twilio account SID"), {
      target: { value: "AC1234567890abcdef1234567890abcd" },
    });
    fireEvent.change(screen.getByLabelText("Twilio auth token"), {
      target: { value: "twilio-auth-token-1234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));
    expect(await screen.findByText("Tenant Twilio account")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import phone numbers" }));
    expect((await screen.findAllByText("+14155557890")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Workflow route for +14155557890"), {
      target: { value: "workflow-inbound-support-triage-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save route for +14155557890" }));

    fireEvent.click(screen.getByRole("button", { name: "Run heartbeat" }));
    expect((await screen.findAllByText(/Twilio heartbeat is healthy/i)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Run loopback test call" }));
    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/telephony/connections/telephony-tenant-west-africa-1/test-call"),
        expect.objectContaining({
          method: "POST",
        }),
      ),
    );
    expect(screen.getAllByText("Ringing").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
    expect(await screen.findByText(/Rotated 1 provider credential envelope/i)).toBeTruthy();
  }, 15_000);

  it("lets workspace admins manage workspace settings, members, and audit history", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("Workspace directory")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "Operations command" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace name" }));

    expect(screen.getByRole("button", { name: "Switch workspace" }).textContent).toContain("Operations command");

    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Grant workspace role" }).disabled).toBe(false);
    });

    fireEvent.change(screen.getByLabelText("Available teammate"), {
      target: { value: "user-finance" },
    });
    fireEvent.change(screen.getByLabelText("Grant role"), {
      target: { value: "viewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant workspace role" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/organizations/tenant-west-africa/workspaces/workspace-operations/memberships/user-finance"),
        expect.objectContaining({
          method: "PUT",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive workspace" }));
    await waitFor(() => {
      expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore workspace" }));
    await waitFor(() => {
      expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Restored workspace/)).toBeTruthy();
    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/tenant-west-africa/workspaces/workspace-operations"),
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  }, 15_000);

  it("lets workspace admins invite and revoke pending teammates for the selected workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("Invite teammate")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Invite email"), {
      target: { value: "operator@tuzzy.example" },
    });
    fireEvent.change(screen.getByLabelText("Tenant role"), {
      target: { value: "operator" },
    });
    fireEvent.change(screen.getByLabelText("Workspace role"), {
      target: { value: "operator" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText("operator@tuzzy.example")).toBeTruthy();
    expect(apiMock.fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/invitations$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          organizationId: "tenant-west-africa",
          email: "operator@tuzzy.example",
          role: "operator",
          workspaceAccess: {
            workspaceId: "workspace-operations",
            role: "operator",
          },
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation for operator@tuzzy.example" }));

    await waitFor(() =>
      expect(apiMock.fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/auth\/invitations\/invitation-operator\/revoke$/),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      ),
    );
    expect(screen.getByText("Revoked")).toBeTruthy();
  }, 15_000);

  it("lets signed-in users send verification email and revoke other sessions from settings", async () => {
    const authClient = createTestAuthClient({
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      organization: {
        id: "tenant-west-africa",
        name: "Tuzzy Labs",
        role: "admin",
      },
    });
    const requestEmailVerification = vi.fn(async () => ({ ok: true as const }));
    const listSessions = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        sessions: [
          {
            id: "session-current",
            current: true,
            createdAt: "2026-05-31T10:00:00.000Z",
            updatedAt: "2026-05-31T10:05:00.000Z",
            expiresAt: "2026-06-07T10:00:00.000Z",
            ipAddress: "127.0.0.1",
            userAgent: "Primary browser",
          },
          {
            id: "session-other",
            current: false,
            createdAt: "2026-05-30T10:00:00.000Z",
            updatedAt: "2026-05-30T10:05:00.000Z",
            expiresAt: "2026-06-06T10:00:00.000Z",
            ipAddress: null,
            userAgent: "Mobile browser",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        sessions: [
          {
            id: "session-current",
            current: true,
            createdAt: "2026-05-31T10:00:00.000Z",
            updatedAt: "2026-05-31T10:05:00.000Z",
            expiresAt: "2026-06-07T10:00:00.000Z",
            ipAddress: "127.0.0.1",
            userAgent: "Primary browser",
          },
        ],
      });
    const revokeSession = vi.fn(async () => ({ ok: true as const }));
    authClient.requestEmailVerification = requestEmailVerification;
    authClient.listSessions = listSessions;
    authClient.revokeSession = revokeSession;

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Account security")).toBeTruthy();
    expect(screen.getByText("Primary browser")).toBeTruthy();
    expect(screen.getByText("Mobile browser")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send verification email" }));

    await waitFor(() =>
      expect(requestEmailVerification).toHaveBeenCalledWith({
        callbackURL: expect.stringMatching(/\/settings$/),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke session for Mobile browser" }));

    await waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith({
        sessionId: "session-other",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Mobile browser")).toBeNull());
  }, 15_000);
});

function installApiMock(liveSandboxMock: ReturnType<typeof installLiveSandboxMock>) {
  let state = createDefaultWorkspaceSeedState({
    tenantId: "tenant-west-africa",
  });
  let telephonyState = createInitialTelephonyState();
  let escalationQueue = [
    {
      escalationId: "escalation-billing-1",
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-operations",
      sessionId: "sandbox-live-1",
      nodeId: "human-escalation-billing",
      queueId: "billing-ops",
      queueName: "Billing managers",
      reason: "Caller asked for a billing supervisor.",
      requestedAt: "2026-05-19T15:00:00.000Z",
      slaDeadlineAt: "2026-05-19T15:01:00.000Z",
      status: "pending",
      fallbackMode: "callback",
      fallbackMessage: "No billing manager is free, so we will schedule a callback.",
    },
  ];
  let integrationConnections: Array<{
    id: string;
    organizationId: string;
    provider: string;
    status: string;
    connectedBy: string;
    scopes: string[];
    availability: { scope: "organization" } | { scope: "workspace"; workspaceId: string };
    accountLabel?: string;
    credentialReference: {
      id: string;
      provider: string;
      kind: string;
      preview: string;
    };
    connectedAt: string;
    revokedBy?: string;
    revokedAt?: string;
    revocationReason?: string;
    health: {
      status: string;
      checkedAt?: string;
      message?: string;
    };
    auditEvents: unknown[];
  }> = [
    {
      id: "integration-zendesk",
      organizationId: "tenant-west-africa",
      provider: "zendesk",
      status: "connected",
      connectedBy: "user-ops-lead",
      scopes: ["tickets:read", "tickets:write"],
      availability: { scope: "organization" },
      credentialReference: {
        id: "credential-zendesk",
        provider: "zendesk",
        kind: "oauth-token",
        preview: "...3456",
      },
      connectedAt: "2026-05-20T10:00:00.000Z",
      health: {
        status: "healthy",
        checkedAt: "2026-05-22T09:00:00.000Z",
        message: "Connector credentials are available.",
      },
      auditEvents: [],
    },
    {
      id: "integration-hubspot",
      organizationId: "tenant-west-africa",
      provider: "hubspot",
      status: "revoked",
      connectedBy: "user-ops-lead",
      scopes: ["crm.objects.contacts.read"],
      availability: { scope: "organization" },
      credentialReference: {
        id: "credential-hubspot",
        provider: "hubspot",
        kind: "oauth-token",
        preview: "...7890",
      },
      connectedAt: "2026-05-18T10:00:00.000Z",
      revokedAt: "2026-05-21T10:00:00.000Z",
      revocationReason: "Rotating provider account.",
      health: {
        status: "revoked",
        checkedAt: "2026-05-21T10:00:00.000Z",
        message: "Connection has been revoked.",
      },
      auditEvents: [],
    },
    {
      id: "integration-notion",
      organizationId: "tenant-west-africa",
      provider: "notion",
      status: "connected",
      connectedBy: "user-ops-lead",
      scopes: ["pages:read", "pages:write"],
      availability: { scope: "workspace", workspaceId: "workspace-operations" },
      credentialReference: {
        id: "credential-notion",
        provider: "notion",
        kind: "oauth-token",
        preview: "...2468",
      },
      connectedAt: "2026-05-20T12:00:00.000Z",
      health: {
        status: "healthy",
        checkedAt: "2026-05-22T09:00:00.000Z",
        message: "Connector credentials are available.",
      },
      auditEvents: [],
    },
  ];
  let tenantMemoryExport = createTenantMemoryExport();
  let tenantBillingState = createTenantBillingState();
  let invitations: Array<{
    id: string;
    email: string;
    organizationId: string;
    role: TenantRole;
    status: "pending" | "accepted" | "revoked";
    inviterId: string;
    expiresAt: string;
    createdAt: string;
    workspaceAccess: { workspaceId: string; role: TenantRole } | null;
    audit: unknown[];
  }> = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "http://127.0.0.1:3000",
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
    const pathname = requestUrl.pathname;

    if (pathname === "/api/auth/invitations" && method === "GET") {
      return jsonResponse(200, {
        ok: true,
        invitations: invitations.filter((invitation) => invitation.organizationId === requestUrl.searchParams.get("organizationId")),
      });
    }

    if (pathname === "/api/auth/invitations" && method === "POST") {
      const email = String(body.email ?? "").toLowerCase();
      const invitation = {
        id: `invitation-${email.split("@")[0] ?? "teammate"}`,
        email,
        organizationId: String(body.organizationId ?? "tenant-west-africa"),
        role: body.role as TenantRole,
        status: "pending" as const,
        inviterId: "user-ops-lead",
        expiresAt: "2026-06-02T10:00:00.000Z",
        createdAt: "2026-05-31T10:00:00.000Z",
        workspaceAccess: body.workspaceAccess === null || body.workspaceAccess === undefined
          ? null
          : {
              workspaceId: String(body.workspaceAccess.workspaceId),
              role: body.workspaceAccess.role as TenantRole,
            },
        audit: [],
      };

      invitations = [invitation, ...invitations.filter((candidate) => candidate.id !== invitation.id)];

      return jsonResponse(201, {
        ok: true,
        invitation,
      });
    }

    if (pathname.startsWith("/api/auth/invitations/") && pathname.endsWith("/revoke") && method === "POST") {
      const invitationId = pathname.split("/")[4]!;
      invitations = invitations.map((invitation) =>
        invitation.id === invitationId
          ? {
              ...invitation,
              status: "revoked" as const,
            }
          : invitation,
      );

      return jsonResponse(200, {
        ok: true,
        invitation: invitations.find((invitation) => invitation.id === invitationId),
      });
    }

    if (pathname === "/organizations/tenant-west-africa/workspaces/state" && method === "GET") {
      return jsonResponse(200, toWorkspaceStateBody(state));
    }

    if (pathname === "/organizations/tenant-west-africa/integrations/connections" && method === "GET") {
      const workspaceId = requestUrl.searchParams.get("workspaceId") ?? undefined;
      return jsonResponse(200, {
        connections: integrationConnections.filter((connection) =>
          workspaceId === undefined
          || connection.availability.scope === "organization"
          || connection.availability.workspaceId === workspaceId,
        ),
      });
    }

    if (pathname === "/organizations/tenant-west-africa/integrations/catalog" && method === "GET") {
      return jsonResponse(200, {
        catalog: {
          providers: getIntegrationProviderCatalog().map((provider) =>
            provider.id === "zendesk"
              ? {
                  ...provider,
                  baseUrl: "https://api.zendesk.com",
                  authHeaderStrategy: "zendesk-basic-api-token",
                  secretSchemaId: "zendesk-api-token-or-oauth-v1",
                  executorId: "connector.zendesk.v1",
                }
              : provider,
          ),
        },
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/integrations/connections/")
      && pathname.endsWith("/health-check")
      && method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      integrationConnections = integrationConnections.map((connection) =>
        connection.id === connectionId
          ? {
              ...connection,
              health: {
                status: connection.status === "revoked" ? "revoked" : "healthy",
                checkedAt: "2026-05-22T10:00:00.000Z",
                message: connection.status === "revoked" ? "Connection has been revoked." : "Connector credentials are available.",
              },
            }
          : connection,
      );

      return jsonResponse(200, {
        connection: integrationConnections.find((connection) => connection.id === connectionId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/integrations/connections/")
      && pathname.endsWith("/revoke")
      && method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      integrationConnections = integrationConnections.map((connection) =>
        connection.id === connectionId
          ? {
              ...connection,
              status: "revoked",
              revokedBy: "user-ops-lead",
              revokedAt: "2026-05-22T10:00:00.000Z",
              revocationReason: "Revoked from tenant integrations page.",
              health: {
                status: "revoked",
                checkedAt: "2026-05-22T10:00:00.000Z",
                message: "Connection has been revoked.",
              },
            }
          : connection,
      );

      return jsonResponse(200, {
        connection: integrationConnections.find((connection) => connection.id === connectionId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/integrations/connections/")
      && pathname.endsWith("/promote")
      && method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      integrationConnections = integrationConnections.map((connection) =>
        connection.id === connectionId
          ? {
              ...connection,
              availability: { scope: "organization" },
              auditEvents: [
                ...connection.auditEvents,
                {
                  action: "promoted_to_organization",
                  actorUserId: "user-ops-lead",
                  actorRole: body.actorRole,
                  workspaceId: body.workspaceId,
                  reason: body.reason,
                },
              ],
            }
          : connection,
      );

      return jsonResponse(200, {
        connection: integrationConnections.find((connection) => connection.id === connectionId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/integrations/")
      && pathname.endsWith("/connect")
      && method === "POST"
    ) {
      const provider = pathname.split("/")[4]!;

      return jsonResponse(201, {
        connect: {
          id: `oauth-${provider}`,
          organizationId: "tenant-west-africa",
          provider,
          actorUserId: "user-ops-lead",
          authorizationUrl: `https://oauth.zara.local/${provider}/authorize?state=test-state`,
          requestedScopes: body.requestedScopes ?? [],
          availability: body.connectionScope === "workspace"
            ? { scope: "workspace", workspaceId: body.workspaceId }
            : { scope: "organization" },
          status: "pending",
          expiresAt: "2026-05-22T10:10:00.000Z",
        },
      });
    }

    if (pathname === "/organizations/tenant-west-africa/integrations/zendesk/configure" && method === "POST") {
      const authToken = String(body.apiToken ?? "");
      const subdomain = String(body.subdomain ?? "");
      const availability: { scope: "organization" } | { scope: "workspace"; workspaceId: string } =
        body.connectionScope === "workspace"
          ? { scope: "workspace", workspaceId: String(body.workspaceId ?? "workspace-operations") }
          : { scope: "organization" };
      const connection = {
        id: "integration-zendesk-configured",
        organizationId: "tenant-west-africa",
        provider: "zendesk",
        status: "connected",
        connectedBy: "user-ops-lead",
        scopes: ["tickets:read", "tickets:write"],
        availability,
        accountLabel: `${subdomain}.zendesk.com`,
        credentialReference: {
          id: "credential-zendesk-configured",
          provider: "zendesk",
          kind: "api-token",
          preview: `${body.email} / ****${authToken.slice(-4)}`,
        },
        connectedAt: "2026-05-22T10:00:00.000Z",
        health: {
          status: "unknown",
        },
        auditEvents: [],
      };
      integrationConnections = [
        ...integrationConnections.filter((candidate) => candidate.id !== connection.id),
        connection,
      ];

      return jsonResponse(201, { connection });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/integrations/connectors/")
      && pathname.endsWith("/tools")
      && method === "GET"
    ) {
      const provider = pathname.split("/")[5]!;

      return jsonResponse(200, {
        tools: [
          {
            provider,
            toolId: `${provider}.tickets.search`,
            description: `Search ${provider} records before a workflow answers.`,
            requiredScopes: ["read"],
          },
        ],
      });
    }

    if (pathname === "/organizations/tenant-west-africa/integrations/webhook-tools" && method === "GET") {
      return jsonResponse(200, {
        webhookTools: [
          {
            id: "webhook-tool-status",
            organizationId: "tenant-west-africa",
            workspaceId: "workspace-operations",
            provider: "webhook-http",
            toolId: "webhook.status.lookup",
            toolName: "Webhook HTTP",
            request: {
              method: "POST",
              url: "https://api.tuzzy.example/tools/status",
              authTokenReference: "secret://webhook-http-tools/webhook-tool-status/auth-token",
            },
          },
        ],
      });
    }

    if (pathname === "/organizations/tenant-west-africa/integrations/tool-grants" && method === "GET") {
      return jsonResponse(200, {
        grants: [
          {
            id: "grant-zendesk-workflow",
            organizationId: "tenant-west-africa",
            workspaceId: requestUrl.searchParams.get("workspaceId") ?? "workspace-operations",
            workflowId: "workflow-support-triage",
            toolId: "zendesk.tickets.search",
            integrationConnectionId: "integration-zendesk",
            risk: "medium",
            approvalRequired: false,
            status: "active",
            grantedBy: "user-ops-lead",
            createdAt: "2026-05-21T11:00:00.000Z",
          },
          {
            id: "grant-hubspot-paused",
            organizationId: "tenant-west-africa",
            workspaceId: requestUrl.searchParams.get("workspaceId") ?? "workspace-operations",
            workflowId: "workflow-sales-follow-up",
            toolId: "hubspot.contacts.lookup",
            integrationConnectionId: "integration-hubspot",
            risk: "medium",
            approvalRequired: false,
            status: "paused",
            pausedReason: "integration_connection_revoked",
            grantedBy: "user-ops-lead",
            createdAt: "2026-05-21T12:00:00.000Z",
          },
        ],
      });
    }

    if (pathname === "/organizations/tenant-west-africa/memory/export" && method === "GET") {
      return jsonResponse(200, {
        export: tenantMemoryExport,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/memory/drafts/")
      && pathname.endsWith("/approve")
      && method === "POST"
    ) {
      const draftId = pathname.split("/")[5]!;
      tenantMemoryExport = {
        ...tenantMemoryExport,
        drafts: tenantMemoryExport.drafts.map((draft) =>
          draft.id === draftId ? { ...draft, status: "approved", updatedAt: "2026-05-22T10:00:00.000Z" } : draft,
        ),
      };

      return jsonResponse(201, {
        draft: tenantMemoryExport.drafts.find((draft) => draft.id === draftId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/memory/drafts/")
      && pathname.endsWith("/reject")
      && method === "POST"
    ) {
      const draftId = pathname.split("/")[5]!;
      tenantMemoryExport = {
        ...tenantMemoryExport,
        drafts: tenantMemoryExport.drafts.map((draft) =>
          draft.id === draftId ? { ...draft, status: "rejected", updatedAt: "2026-05-22T10:00:00.000Z" } : draft,
        ),
      };

      return jsonResponse(200, {
        draft: tenantMemoryExport.drafts.find((draft) => draft.id === draftId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/memory/")
      && method === "PATCH"
    ) {
      const memoryId = pathname.split("/")[4]!;
      tenantMemoryExport = {
        ...tenantMemoryExport,
        memories: tenantMemoryExport.memories.map((memory) =>
          memory.id === memoryId ? { ...memory, status: "disabled", updatedAt: "2026-05-22T10:00:00.000Z" } : memory,
        ),
      };

      return jsonResponse(200, {
        memory: tenantMemoryExport.memories.find((memory) => memory.id === memoryId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/memory/")
      && method === "DELETE"
    ) {
      const memoryId = pathname.split("/")[4]!;
      tenantMemoryExport = {
        ...tenantMemoryExport,
        memories: tenantMemoryExport.memories.map((memory) =>
          memory.id === memoryId ? { ...memory, status: "deleted", updatedAt: "2026-05-22T10:00:00.000Z" } : memory,
        ),
      };

      return jsonResponse(200, {
        memory: tenantMemoryExport.memories.find((memory) => memory.id === memoryId),
      });
    }

    if (pathname === "/organizations/tenant-west-africa/memory/retention/purge" && method === "POST") {
      return jsonResponse(200, {
        retention: {
          organizationId: "tenant-west-africa",
          purgedCounts: {
            memories: 0,
            knowledge: 0,
            embeddings: 0,
            ingestionSources: 0,
          },
        },
      });
    }

    if (pathname === "/organizations/tenant-west-africa/billing/state" && method === "GET") {
      return jsonResponse(200, {
        billing: tenantBillingState,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/billing/customer-portal" && method === "POST") {
      return jsonResponse(201, {
        portal: {
          organizationId: "tenant-west-africa",
          provider: "polar",
          customerPortalUrl: "https://polar.sh/tuzzy/portal/session",
        },
      });
    }

    if (pathname === "/organizations/tenant-west-africa/billing/checkout" && method === "POST") {
      tenantBillingState = {
        ...tenantBillingState,
        plan: {
          ...tenantBillingState.plan,
          slug: body.planSlug ?? "growth",
        },
      };

      return jsonResponse(201, {
        checkout: {
          organizationId: "tenant-west-africa",
          provider: "polar",
          planSlug: body.planSlug ?? "growth",
          checkoutUrl: "https://polar.sh/checkout/session_growth",
        },
      });
    }

    if (pathname === "/organizations/tenant-west-africa/sandbox/live-sessions" && method === "POST") {
      let session: ReturnType<typeof liveSandboxMock.createSession>;

      try {
        session = liveSandboxMock.createSession({
          organizationId: "tenant-west-africa",
          workspaceId: String(body.workspaceId ?? "workspace-operations"),
          source: String(body.source ?? "published"),
          inputMode: String(body.inputMode ?? "typed"),
          entryRoleId: String(body.entryRoleId ?? "agent-front-desk"),
          manifestId: String(body.manifest?.manifestId ?? "manifest-test"),
          publishedVersionId: String(body.manifest?.publishedVersionId ?? "workflow-test-v1"),
          runtimeProfile: String(body.manifest?.runtimeProfile ?? "cost-optimized"),
        });
      } catch (error) {
        return jsonResponse(409, {
          message: error instanceof Error ? error.message : "Live sandbox session could not be created.",
        });
      }

      return jsonResponse(201, {
        session,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/sandbox/live-sessions" && method === "GET") {
      return jsonResponse(200, {
        sessions: liveSandboxMock.listSessions({
          workspaceId: requestUrl.searchParams.get("workspaceId") ?? undefined,
          includeEnded: requestUrl.searchParams.get("includeEnded") === "true",
        }),
      });
    }

    if (pathname === "/organizations/tenant-west-africa/sandbox/live-sessions/escalations" && method === "GET") {
      const workspaceId = requestUrl.searchParams.get("workspaceId") ?? undefined;

      return jsonResponse(200, {
        escalations: escalationQueue.filter(
          (escalation) => workspaceId === undefined || escalation.workspaceId === workspaceId,
        ),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/sandbox/live-sessions/escalations/")
      && pathname.endsWith("/accept")
      && method === "POST"
    ) {
      const escalationId = pathname.split("/")[6]!;
      escalationQueue = escalationQueue.map((escalation) =>
        escalation.escalationId === escalationId
          ? {
              ...escalation,
              status: "accepted",
              acceptedByUserId: String(body.actorUserId ?? "user-ops-lead"),
              resolvedAt: "2026-05-19T15:00:40.000Z",
            }
          : escalation,
      );

      return jsonResponse(200, {
        escalation: escalationQueue.find((escalation) => escalation.escalationId === escalationId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/sandbox/live-sessions/escalations/")
      && pathname.endsWith("/decline")
      && method === "POST"
    ) {
      const escalationId = pathname.split("/")[6]!;
      escalationQueue = escalationQueue.map((escalation) =>
        escalation.escalationId === escalationId
          ? {
              ...escalation,
              status: "declined",
              declinedByUserId: String(body.actorUserId ?? "user-ops-lead"),
              declineReason: String(body.reason ?? "Declined from test."),
              resolvedAt: "2026-05-19T15:00:40.000Z",
            }
          : escalation,
      );

      return jsonResponse(200, {
        escalation: escalationQueue.find((escalation) => escalation.escalationId === escalationId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/sandbox/live-sessions/")
      && pathname.endsWith("/events")
      && method === "GET"
    ) {
      const sessionId = pathname.split("/")[5]!;

      return jsonResponse(200, {
        sessionId,
        events: liveSandboxMock.getSessionEvents(
          sessionId,
          requestUrl.searchParams.get("afterSequence") ?? undefined,
        ),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/sandbox/live-sessions/")
      && pathname.endsWith("/reconnect")
      && method === "POST"
    ) {
      const sessionId = pathname.split("/")[5]!;

      return jsonResponse(200, {
        session: liveSandboxMock.reconnectSession(sessionId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/sandbox/live-sessions/")
      && pathname.endsWith("/end")
      && method === "POST"
    ) {
      const sessionId = pathname.split("/")[5]!;
      const session = liveSandboxMock.endSession(sessionId);

      return jsonResponse(200, {
        session,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/workspaces" && method === "POST") {
      const validation = validateWorkspaceCreate({
        tenantId: "tenant-west-africa",
        name: String(body.name ?? ""),
        existingWorkspaces: state.workspaces,
      });

      if (!validation.ok) {
        return jsonResponse(409, { message: validation.message });
      }

      const slug = slugifyWorkspaceName(String(body.name));
      const workspace = createWorkspace({
        id: `workspace-${slug}`,
        tenantId: "tenant-west-africa",
        name: String(body.name),
        slug,
        createdBy: String(body.actorUserId ?? "user-ops-lead"),
      });

      state = {
        ...state,
        workspaces: [...state.workspaces, workspace],
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspace.id}-${state.auditEntries.length + 1}`,
            workspaceId: workspace.id,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "workspace.accessed",
            summary: `Created workspace ${workspace.name}.`,
            at: "2026-05-14T12:00:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(201, { state: toWorkspaceStateBody(state) });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/workspaces/") &&
      !pathname.includes("/memberships/") &&
      pathname.endsWith("/accessed") &&
      method === "POST"
    ) {
      const workspaceId = pathname.split("/")[4]!;
      const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);

      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "workspace.accessed",
            summary: `Switched active workspace to ${workspace?.name ?? workspaceId}.`,
            at: "2026-05-14T12:01:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/workspaces/") &&
      !pathname.includes("/memberships/") &&
      method === "PATCH"
    ) {
      const workspaceId = pathname.split("/")[4]!;

      try {
        switch (body.action) {
          case "rename":
            state = {
              ...state,
              workspaces: renameWorkspace({
                workspaces: state.workspaces,
                workspaceId,
                tenantId: "tenant-west-africa",
                nextName: String(body.nextName ?? ""),
              }),
            };
            break;
          case "archive":
            state = {
              ...state,
              workspaces: archiveWorkspace({
                workspaces: state.workspaces,
                workspaceId,
                tenantId: "tenant-west-africa",
                activeSessionCount: Number(body.activeSessionCount ?? 0),
              }),
            };
            break;
          case "restore":
            state = {
              ...state,
              workspaces: restoreWorkspace({
                workspaces: state.workspaces,
                workspaceId,
                tenantId: "tenant-west-africa",
              }),
            };
            break;
        }
      } catch (error) {
        return jsonResponse(409, {
          message: error instanceof Error ? error.message : "Workspace mutation failed.",
        });
      }

      const renamedWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceId);
      const actionSummary =
        body.action === "rename"
          ? `Renamed workspace to ${renamedWorkspace?.name ?? workspaceId}.`
          : body.action === "archive"
            ? `Archived workspace ${renamedWorkspace?.name ?? workspaceId}.`
            : `Restored workspace ${renamedWorkspace?.name ?? workspaceId}.`;

      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action:
              body.action === "rename"
                ? "workspace.renamed"
                : body.action === "archive"
                  ? "workspace.archived"
                  : "workspace.restored",
            summary: actionSummary,
            at: "2026-05-14T12:02:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (pathname.includes("/memberships/") && method === "PUT") {
      const [, , , , workspaceId, , userId] = pathname.split("/");

      state = {
        ...state,
        memberships: setWorkspaceMembershipRole({
          memberships: state.memberships,
          workspaceId: workspaceId!,
          tenantId: "tenant-west-africa",
          userId: userId!,
          role: body.role as TenantRole,
        }),
      };

      const userName = state.directoryUsers.find((user) => user.id === userId)?.name ?? userId;
      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId: workspaceId!,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "membership.role_changed",
            summary: `Changed ${userName} to ${String(body.role)}.`,
            at: "2026-05-14T12:03:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (pathname.includes("/memberships/") && pathname.endsWith("/revoke") && method === "POST") {
      const [, , , , workspaceId, , userId] = pathname.split("/");

      try {
        state = {
          ...state,
          memberships: revokeWorkspaceMembership({
            memberships: state.memberships,
            workspaceId: workspaceId!,
            tenantId: "tenant-west-africa",
            userId: userId!,
          }),
        };
      } catch (error) {
        return jsonResponse(409, {
          message: error instanceof Error ? error.message : "Workspace mutation failed.",
        });
      }

      const userName = state.directoryUsers.find((user) => user.id === userId)?.name ?? userId;
      state = {
        ...state,
        auditEntries: [
          createWorkspaceAuditEntry({
            id: `audit-${workspaceId}-${state.auditEntries.length + 1}`,
            workspaceId: workspaceId!,
            tenantId: "tenant-west-africa",
            actorUserId: String(body.actorUserId ?? "user-ops-lead"),
            action: "membership.revoked",
            summary: `Revoked access for ${userName}.`,
            at: "2026-05-14T12:04:00.000Z",
          }),
          ...state.auditEntries,
        ],
      };

      return jsonResponse(200, { state: toWorkspaceStateBody(state) });
    }

    if (pathname === "/runtime/realtime/sessions" && method === "POST") {
      return jsonResponse(201, {
        session: {
          sessionId: "runtime-premium-1",
          manifestId: body.manifest?.manifestId ?? "manifest-premium",
          publishedVersionId: body.manifest?.publishedVersionId ?? "workflow-premium-v1",
          activeRoleId: body.activeRoleId ?? "agent-front-desk",
          runtime: "openai-realtime",
          policy: "premium-realtime",
          model: "gpt-realtime",
          voice: "expressive",
          transportUrl: "/runtime/realtime/sessions/manifest-premium",
          expiresAt: "2026-05-14T12:30:00.000Z",
          observedEventTypes: [
            "tool.started",
            "tool.completed",
            "tool.failed",
            "agent.handoff.requested",
            "agent.handoff.completed",
          ],
        },
      });
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/state" && method === "GET") {
      return jsonResponse(200, telephonyState);
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/connections" && method === "POST") {
      const connectionId = `telephony-tenant-west-africa-${telephonyState.connections.length + 1}`;
      const authToken = String(body.authToken ?? body.secret ?? "");
      const ownershipMode = String(body.ownershipMode ?? "byo_provider_account");
      const provider = String(body.provider ?? "twilio");
      const connection = {
        id: connectionId,
        tenantId: "tenant-west-africa",
        label: String(body.label ?? "Tenant telephony connection"),
        ownershipMode,
        provider,
        region: String(body.region ?? "us-east-1"),
        status: "active",
        healthStatus: "unknown",
        recordingPolicy: body.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        blockRoutingOnHealthFailure: Boolean(body.blockRoutingOnHealthFailure ?? true),
        credentialReference: {
          id: `${connectionId}:cred`,
          provider,
          keyVersion: 1,
          preview: `****${authToken.slice(-4)}`,
        },
        externalReference: String(body.accountSid ?? ""),
        ...(body.sip
          ? {
              sip: {
                domain: String(body.sip.domain ?? ""),
                codecs: Array.isArray(body.sip.codecs) ? body.sip.codecs : [],
              },
            }
          : {}),
        webhookBaseUrl:
          ownershipMode === "byo_provider_account" ? "http://127.0.0.1/telephony/webhooks/twilio" : undefined,
        webhookStatus: ownershipMode === "byo_provider_account" ? "configured" : "missing",
        createdBy: String(body.actorUserId ?? "user-ops-lead"),
      };

      telephonyState = {
        ...telephonyState,
        connections: [...telephonyState.connections, connection],
      };

      return jsonResponse(201, {
        state: telephonyState,
        connection,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/")
      && method === "DELETE"
    ) {
      const connectionId = pathname.split("/")[5]!;

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.filter((connection) => connection.id !== connectionId),
        phoneNumbers: telephonyState.phoneNumbers.filter((phoneNumber) => phoneNumber.connectionId !== connectionId),
        healthChecks: telephonyState.healthChecks.filter((healthCheck) => healthCheck.connectionId !== connectionId),
        providerHeartbeats: telephonyState.providerHeartbeats.filter((heartbeat) => heartbeat.connectionId !== connectionId),
      };

      return jsonResponse(200, {
        state: telephonyState,
        deletedConnectionId: connectionId,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/register-number") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const connection = telephonyState.connections.find((candidate) => candidate.id === connectionId);
      const normalizedPhoneNumber = String(body.phoneNumber ?? "").trim();
      const phoneNumber = {
        id: `phone-number-${normalizedPhoneNumber.replace(/\D+/g, "")}`,
        tenantId: "tenant-west-africa",
        connectionId,
        provider: String(connection?.provider ?? "twilio"),
        provisionSource:
          connection?.ownershipMode === "byo_sip_trunk" ? "manual-did" : "platform-pool",
        externalNumberId: String(body.externalNumberId ?? `${connectionId}:${normalizedPhoneNumber}`),
        phoneNumber: normalizedPhoneNumber,
        friendlyName: String(body.friendlyName ?? "Live number"),
        voiceCapable: true,
        callerIdEligible: true,
        status: "imported",
        webhookStatus: "configured",
      };

      telephonyState = {
        ...telephonyState,
        phoneNumbers: [...telephonyState.phoneNumbers, phoneNumber],
      };

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/heartbeat") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const routedNumberCount = telephonyState.phoneNumbers.filter(
        (phoneNumber) => phoneNumber.connectionId === connectionId && phoneNumber.status === "routed",
      ).length;
      const heartbeat = {
        id: `${connectionId}:heartbeat:${telephonyState.healthChecks.length + 1}`,
        tenantId: "tenant-west-africa",
        connectionId,
        provider: "twilio",
        ownershipMode: "byo_provider_account",
        status: "healthy",
        blocking: false,
        scheduled: Boolean(body.scheduled ?? false),
        latencyMs: 112,
        routedNumberCount,
        at: "2026-05-14T12:09:00.000Z",
        message: `Twilio heartbeat is healthy with ${routedNumberCount} routed number${routedNumberCount === 1 ? "" : "s"}.`,
        diagnostics: [
          "Twilio REST credential probe completed successfully.",
          `${routedNumberCount} routed number${routedNumberCount === 1 ? "" : "s"} available for provider dispatch.`,
        ],
      };
      const healthCheck = {
        id: `${connectionId}:health:${telephonyState.healthChecks.length + 1}`,
        connectionId,
        status: "healthy",
        blocking: false,
        checkedAt: heartbeat.at,
        message: heartbeat.message,
        scheduled: heartbeat.scheduled,
        latencyMs: heartbeat.latencyMs,
        diagnostics: heartbeat.diagnostics,
      };

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.map((connection) =>
          connection.id === connectionId
            ? { ...connection, healthStatus: "healthy", status: "active" }
            : connection,
        ),
        healthChecks: [healthCheck, ...telephonyState.healthChecks],
        providerHeartbeats: [heartbeat, ...telephonyState.providerHeartbeats],
      };

      return jsonResponse(201, {
        state: telephonyState,
        heartbeat,
        healthCheck,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/validate") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const connection = telephonyState.connections.find((candidate) => candidate.id === connectionId);
      const hasAttachedNumber = telephonyState.phoneNumbers.some((phoneNumber) => phoneNumber.connectionId === connectionId);
      const healthCheck = {
        id: `${connectionId}:health:${telephonyState.healthChecks.length + 1}`,
        connectionId,
        status: hasAttachedNumber || connection?.ownershipMode !== "byo_sip_trunk" ? "healthy" : "warning",
        blocking: false,
        checkedAt: "2026-05-14T12:10:00.000Z",
        message:
          hasAttachedNumber || connection?.ownershipMode !== "byo_sip_trunk"
            ? "Provider credential check passed."
            : "Attach at least one SIP DID before validating route health.",
      };

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.map((connection) =>
          connection.id === connectionId
            ? { ...connection, healthStatus: healthCheck.status, status: "active" }
            : connection,
        ),
        healthChecks: [healthCheck, ...telephonyState.healthChecks],
      };

      return jsonResponse(200, {
        state: telephonyState,
        healthCheck,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/import-twilio-numbers") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const importedNumbers = [
        {
          id: "phone-number-pn-support-7890",
          tenantId: "tenant-west-africa",
          connectionId,
          provider: "twilio",
          provisionSource: "provider-import",
          externalNumberId: "PN78901001",
          phoneNumber: "+14155557890",
          friendlyName: "Support line",
          voiceCapable: true,
          callerIdEligible: true,
          status: "imported",
          webhookStatus: "pending",
        },
        {
          id: "phone-number-pn-reception-7890",
          tenantId: "tenant-west-africa",
          connectionId,
          provider: "twilio",
          provisionSource: "provider-import",
          externalNumberId: "PN78902002",
          phoneNumber: "+14156667890",
          friendlyName: "Reception line",
          voiceCapable: true,
          callerIdEligible: true,
          status: "imported",
          webhookStatus: "pending",
        },
      ].filter(
        (candidate) => !telephonyState.phoneNumbers.some((phoneNumber) => phoneNumber.id === candidate.id),
      );

      telephonyState = {
        ...telephonyState,
        phoneNumbers: [...telephonyState.phoneNumbers, ...importedNumbers],
      };

      return jsonResponse(201, {
        state: telephonyState,
        importedNumbers,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/connections/") &&
      pathname.endsWith("/test-call") &&
      method === "POST"
    ) {
      const connectionId = pathname.split("/")[5]!;
      const phoneNumber = telephonyState.phoneNumbers.find((candidate) => candidate.id === body.phoneNumberId);
      const liveRoute = phoneNumber?.liveRoute as TestTelephonyLiveRoute | undefined;
      const dispatch = {
        id: `${String(body.callSid ?? "CA-test")}:manual`,
        tenantId: "tenant-west-africa",
        direction: "inbound",
        disposition: "routed",
        reason: `Routed ${String(phoneNumber?.phoneNumber ?? "")} to ${String(liveRoute?.workflowLabel ?? "")}.`,
        callSessionId: `${String(body.callSid ?? "CA-test")}:telephony`,
        phoneNumberId: phoneNumber?.id,
        connectionId,
        publishedVersionId: liveRoute?.publishedVersionId,
        workspaceId: liveRoute?.workspaceId,
        workflowLabel: liveRoute?.workflowLabel,
        recording: phoneNumber?.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        toPhoneNumber: String(phoneNumber?.phoneNumber ?? ""),
        fromPhoneNumber: String(body.fromPhoneNumber ?? ""),
        createdAt: "2026-05-14T12:10:00.000Z",
        source: "manual",
      };
      const session = {
        id: `${dispatch.callSessionId}:execution`,
        tenantId: "tenant-west-africa",
        dispatchId: dispatch.id,
        callSessionId: dispatch.callSessionId,
        connectionId,
        provider: "twilio",
        ownershipMode: "byo_provider_account",
        direction: "inbound",
        status: "ringing",
        toPhoneNumber: dispatch.toPhoneNumber,
        fromPhoneNumber: dispatch.fromPhoneNumber,
        workflowLabel: dispatch.workflowLabel,
        workspaceId: dispatch.workspaceId,
        testCall: true,
        diagnostics: [
          "Twilio programmable voice accepted the ingress session.",
          "Credential-backed provider bridge is ready for test audio.",
        ],
        createdAt: "2026-05-14T12:10:00.000Z",
        updatedAt: "2026-05-14T12:10:00.000Z",
      };

      telephonyState = {
        ...telephonyState,
        dispatches: [dispatch, ...telephonyState.dispatches],
        executionSessions: [session, ...telephonyState.executionSessions],
      };

      return jsonResponse(201, {
        state: telephonyState,
        dispatch,
        session,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.endsWith("/routing") &&
      method === "PATCH"
    ) {
      const numberId = pathname.split("/")[5]!;

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) =>
          phoneNumber.id === numberId
            ? {
                ...phoneNumber,
                status: "routed",
                webhookStatus: "configured",
                liveRoute: {
                  mode: "live_route",
                  publishedVersionId: String(body.publishedVersionId ?? ""),
                  workflowLabel: String(body.workflowLabel ?? ""),
                  workspaceId: String(body.workspaceId ?? "workspace-operations"),
                  runtimeProfile: String(body.runtimeProfile ?? "cost-optimized"),
                  createdAt: "2026-05-14T12:09:00.000Z",
                  activationStatus: "pending_activation",
                },
                recordingPolicy: body.recordingPolicy,
              }
            : phoneNumber,
        ),
      };

      return jsonResponse(200, {
        state: telephonyState,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.endsWith("/live-route/activate") &&
      method === "POST"
    ) {
      const numberId = pathname.split("/")[5]!;
      const activatedAt = "2026-05-28T14:28:00.000Z";

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) => {
          const liveRoute = phoneNumber.liveRoute as TestTelephonyLiveRoute | undefined;

          return phoneNumber.id === numberId && liveRoute !== undefined
            ? {
                ...phoneNumber,
                liveRoute: {
                  ...liveRoute,
                  activationStatus: "active",
                  activatedAt,
                },
              }
            : phoneNumber;
        }),
      };

      const phoneNumber = telephonyState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId);
      const liveRoute = phoneNumber?.liveRoute as TestTelephonyLiveRoute | undefined;

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber,
        activation: {
          status: "activated",
          activatedAt,
          activatedBy: String(body.actorUserId ?? "user-ops-lead"),
          summary: {
            number: phoneNumber?.phoneNumber,
            workflowName: liveRoute?.workflowLabel,
            publishedVersionId: liveRoute?.publishedVersionId,
            runtimeProfile: liveRoute?.runtimeProfile,
            subscriptionPosture: {
              status: "active",
            },
            budgetPosture: {
              action: "allow",
            },
          },
        },
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.endsWith("/live-route/pause") &&
      method === "POST"
    ) {
      const numberId = pathname.split("/")[5]!;

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) => {
          const liveRoute = phoneNumber.liveRoute as TestTelephonyLiveRoute | undefined;

          return phoneNumber.id === numberId && liveRoute !== undefined
            ? {
                ...phoneNumber,
                liveRoute: {
                  ...liveRoute,
                  activationStatus: "paused",
                  pausedAt: "2026-05-28T14:29:00.000Z",
                },
              }
            : phoneNumber;
        }),
      };

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber: telephonyState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.endsWith("/live-route/resume") &&
      method === "POST"
    ) {
      const numberId = pathname.split("/")[5]!;

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) => {
          const liveRoute = phoneNumber.liveRoute as TestTelephonyLiveRoute | undefined;

          return phoneNumber.id === numberId && liveRoute !== undefined
            ? {
                ...phoneNumber,
                liveRoute: {
                  ...liveRoute,
                  activationStatus: "active",
                  activatedAt: "2026-05-28T14:30:00.000Z",
                },
              }
            : phoneNumber;
        }),
      };

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber: telephonyState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId),
        activation: {
          status: "activated",
        },
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.endsWith("/pstn-test-route") &&
      method === "POST"
    ) {
      const numberId = pathname.split("/")[5]!;
      const sessionId = `${numberId}:pstn-test:1779978000000`;

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) =>
          phoneNumber.id === numberId
            ? {
                ...phoneNumber,
                testRoute: {
                  mode: "test_route",
                  publishedVersionId: String(body.publishedVersionId ?? ""),
                  workflowLabel: String(body.workflowLabel ?? ""),
                  workspaceId: String(body.workspaceId ?? "workspace-operations"),
                  runtimeProfile: String(body.runtimeProfile ?? "cost-optimized"),
                  allowedCallerNumbers: Array.isArray(body.allowedCallerNumbers) ? body.allowedCallerNumbers : [],
                  createdAt: "2026-05-28T14:20:00.000Z",
                  waitingSession: {
                    id: sessionId,
                    status: "waiting",
                    allowedCallerNumbers: Array.isArray(body.allowedCallerNumbers) ? body.allowedCallerNumbers : [],
                    checklist: {
                      verifiedWebhook: false,
                      allowedCallerMatched: false,
                      mediaWebSocketConnected: false,
                      inboundFrameReceived: false,
                      transcriptCreated: false,
                      agentResponseGenerated: false,
                      outboundAudioSent: false,
                      cleanEnd: false,
                      noFatalError: false,
                    },
                    createdAt: "2026-05-28T14:20:00.000Z",
                    expiresAt: String(body.expiresAt ?? "2026-05-28T14:35:00.000Z"),
                  },
                },
              }
            : phoneNumber,
        ),
      };

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber: telephonyState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId),
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/numbers/") &&
      pathname.includes("/pstn-test-route/") &&
      pathname.endsWith("/complete") &&
      method === "POST"
    ) {
      const pathParts = pathname.split("/");
      const numberId = pathParts[5]!;
      const sessionId = decodeURIComponent(pathParts[7] ?? "");
      const completedAt = "2026-05-28T14:25:00.000Z";

      telephonyState = {
        ...telephonyState,
        phoneNumbers: telephonyState.phoneNumbers.map((phoneNumber) => {
          const testRoute = phoneNumber.testRoute as
            | {
                publishedVersionId: string;
                runtimeProfile: string;
                createdAt: string;
                waitingSession: {
                  id: string;
                  checklist: Record<string, boolean>;
                };
              }
            | undefined;
          const phoneTestResults = phoneNumber.phoneTestResults as Array<Record<string, unknown>> | undefined;

          if (phoneNumber.id !== numberId || testRoute?.waitingSession.id !== sessionId) {
            return phoneNumber;
          }

          const waitingSession = {
            ...testRoute.waitingSession,
            status: "manually_ended" as const,
          };
          const result = {
            id: `${sessionId}:manually_ended`,
            tenantId: "tenant-west-africa",
            numberId,
            sessionId,
            status: "manually_ended" as const,
            reason: String(body.reason ?? "Operator ended the Phone test from sandbox."),
            checklist: waitingSession.checklist,
            publishedVersionId: testRoute.publishedVersionId,
            runtimeProfile: testRoute.runtimeProfile,
            createdAt: testRoute.createdAt,
            completedAt,
          };

          return {
            ...phoneNumber,
            testRoute: {
              ...testRoute,
              waitingSession,
            },
            phoneTestResults: [result, ...(phoneTestResults ?? [])],
          };
        }),
      };

      return jsonResponse(201, {
        state: telephonyState,
        phoneNumber: telephonyState.phoneNumbers.find((phoneNumber) => phoneNumber.id === numberId),
      });
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/dispatch/inbound" && method === "POST") {
      const phoneNumber = telephonyState.phoneNumbers.find((candidate) => candidate.phoneNumber === body.toPhoneNumber);
      const liveRoute = phoneNumber?.liveRoute as TestTelephonyLiveRoute | undefined;
      const liveRouteActive = liveRoute?.activationStatus === "active";
      const connection = telephonyState.connections.find(
        (candidate) => candidate.id === phoneNumber?.connectionId,
      );
      const dispatch = {
        id: `${String(body.callSid ?? "CA-test")}:manual`,
        tenantId: "tenant-west-africa",
        direction: "inbound",
        disposition: liveRouteActive ? "routed" : liveRoute ? "blocked" : "fallback",
        reason: liveRouteActive
          ? `Routed ${String(body.toPhoneNumber)} to ${String(liveRoute.workflowLabel)}.`
          : liveRoute
            ? "Live route setup exists but answering is not active."
            : "No published workflow route is assigned to this number.",
        callSessionId: liveRouteActive ? `${String(body.callSid ?? "CA-test")}:telephony` : undefined,
        phoneNumberId: phoneNumber?.id,
        connectionId: phoneNumber?.connectionId,
        publishedVersionId: liveRoute?.publishedVersionId,
        workspaceId: liveRoute?.workspaceId,
        workflowLabel: liveRoute?.workflowLabel,
        runtimeProfile: liveRoute?.runtimeProfile,
        recording: phoneNumber?.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        toPhoneNumber: String(body.toPhoneNumber ?? ""),
        fromPhoneNumber: String(body.fromPhoneNumber ?? ""),
        createdAt: "2026-05-14T12:11:00.000Z",
        source: "manual",
      };
      const bridgeKind =
        connection?.ownershipMode === "platform_managed"
          ? "platform-edge"
          : connection?.ownershipMode === "byo_sip_trunk"
            ? "sip-trunk"
            : "twilio-programmable-voice";
      const bridgeAction =
        bridgeKind === "platform-edge"
          ? "platform.edge.accept-call"
          : bridgeKind === "sip-trunk"
            ? "sip.invite.accept"
            : "twilio.calls.answer";

      telephonyState = {
        ...telephonyState,
        dispatches: [dispatch, ...telephonyState.dispatches],
        executionSessions:
          dispatch.disposition === "routed"
            ? [
                {
                  id: `${dispatch.callSessionId}:execution`,
                  tenantId: "tenant-west-africa",
                  dispatchId: dispatch.id,
                  callSessionId: dispatch.callSessionId,
                  connectionId: dispatch.connectionId,
                  provider: String(connection?.provider ?? "twilio"),
                  ownershipMode: String(connection?.ownershipMode ?? "byo_provider_account"),
                  direction: "inbound",
                  status: "ringing",
                  toPhoneNumber: dispatch.toPhoneNumber,
                  fromPhoneNumber: dispatch.fromPhoneNumber,
                  workflowLabel: liveRoute?.workflowLabel,
                  workspaceId: liveRoute?.workspaceId,
                  testCall: false,
                  bridgeKind,
                  bridgeTarget: String(connection?.label ?? "Provider bridge"),
                  mediaPath: "provider-native",
                  diagnostics: ["Provider bridge accepted the ingress session."],
                  createdAt: dispatch.createdAt,
                  updatedAt: dispatch.createdAt,
                },
                ...telephonyState.executionSessions,
              ]
            : telephonyState.executionSessions,
        executionCommands:
          dispatch.disposition === "routed"
            ? [
                {
                  id: `${dispatch.callSessionId}:command`,
                  tenantId: "tenant-west-africa",
                  sessionId: `${dispatch.callSessionId}:execution`,
                  dispatchId: dispatch.id,
                  callSessionId: dispatch.callSessionId,
                  provider: String(connection?.provider ?? "twilio"),
                  action: bridgeAction,
                  status: "applied",
                  target: String(connection?.label ?? "Provider bridge"),
                  payload: {
                    toPhoneNumber: dispatch.toPhoneNumber,
                    fromPhoneNumber: dispatch.fromPhoneNumber,
                  },
                  requestedAt: dispatch.createdAt,
                  appliedAt: dispatch.createdAt,
                },
                ...telephonyState.executionCommands,
              ]
            : telephonyState.executionCommands,
      };

      return jsonResponse(201, {
        state: telephonyState,
        dispatch,
      });
    }

    if (pathname === "/organizations/tenant-west-africa/telephony/dispatch/outbound" && method === "POST") {
      const phoneNumber = telephonyState.phoneNumbers.find((candidate) => candidate.phoneNumber === body.fromPhoneNumber);
      const dispatch = {
        id: `${String(body.callSid ?? "CA-outbound")}:manual`,
        tenantId: "tenant-west-africa",
        direction: "outbound",
        disposition: body.consentGranted ? "queued" : "blocked",
        reason: body.consentGranted
          ? `Queued outbound call from ${String(body.fromPhoneNumber)} to ${String(body.toPhoneNumber)}.`
          : "Outbound calling requires customer consent before the session can start.",
        callSessionId: `${String(body.callSid ?? "CA-outbound")}:telephony`,
        phoneNumberId: phoneNumber?.id,
        connectionId: phoneNumber?.connectionId,
        publishedVersionId: String(body.publishedVersionId ?? ""),
        workspaceId: String(body.workspaceId ?? "workspace-operations"),
        workflowLabel: String(body.workflowLabel ?? ""),
        recording: phoneNumber?.recordingPolicy ?? {
          enabled: true,
          consentMode: "single-party",
          consentMessage: "This call may be recorded for quality assurance.",
        },
        policyChecks: {
          consent: {
            status: body.consentGranted ? "passed" : "blocked",
            detail: body.consentGranted ? "Customer consent confirmed." : "Outbound calling requires customer consent before the session can start.",
          },
          budget: {
            status: "passed",
            detail: "Budget check passed.",
          },
          callingWindow: {
            status: "passed",
            detail: "Calling window check passed.",
          },
          callerId: {
            status: phoneNumber ? "passed" : "blocked",
            detail: phoneNumber ? "Caller ID is routed." : "Caller ID must match a routed Zara or tenant-owned number before outbound dispatch.",
          },
        },
        toPhoneNumber: String(body.toPhoneNumber ?? ""),
        fromPhoneNumber: String(body.fromPhoneNumber ?? ""),
        createdAt: "2026-05-14T12:12:00.000Z",
        source: "manual",
      };

      telephonyState = {
        ...telephonyState,
        dispatches: [dispatch, ...telephonyState.dispatches],
        executionSessions:
          dispatch.disposition === "queued"
            ? [
                {
                  id: `${dispatch.callSessionId}:execution`,
                  tenantId: "tenant-west-africa",
                  dispatchId: dispatch.id,
                  callSessionId: dispatch.callSessionId,
                  connectionId: dispatch.connectionId,
                  provider: "twilio",
                  ownershipMode: "platform_managed",
                  direction: "outbound",
                  status: "ringing",
                  toPhoneNumber: dispatch.toPhoneNumber,
                  fromPhoneNumber: dispatch.fromPhoneNumber,
                  workflowLabel: dispatch.workflowLabel,
                  workspaceId: dispatch.workspaceId,
                  testCall: false,
                  diagnostics: ["Zara platform edge reserved egress capacity in eu-west-1."],
                  createdAt: dispatch.createdAt,
                  updatedAt: dispatch.createdAt,
                },
                ...telephonyState.executionSessions,
              ]
            : telephonyState.executionSessions,
      };

      return jsonResponse(201, {
        state: telephonyState,
        dispatch,
      });
    }

    if (
      pathname.startsWith("/organizations/tenant-west-africa/telephony/calls/") &&
      pathname.endsWith("/events") &&
      method === "POST"
    ) {
      const callSessionId = decodeURIComponent(pathname.split("/")[5]!);
      const event = {
        id: `${callSessionId}:${String(body.eventType ?? "dtmf.received")}:mock`,
        tenantId: "tenant-west-africa",
        dispatchId: String(body.dispatchId ?? "dispatch-mock"),
        callSessionId,
        eventType: String(body.eventType ?? "dtmf.received"),
        at: "2026-05-14T12:13:00.000Z",
        summary: `Recorded ${String(body.eventType ?? "dtmf.received")} event.`,
        ...(body.fallbackTarget ? { fallbackTarget: String(body.fallbackTarget) } : {}),
        payload: Object.fromEntries(
          Object.entries({
            digit: body.digit,
            transferTarget: body.transferTarget,
            fallbackTarget: body.fallbackTarget,
          }).filter(([, value]) => typeof value === "string" && value.length > 0),
        ),
      };

      telephonyState = {
        ...telephonyState,
        callControlEvents: [event, ...telephonyState.callControlEvents],
        executionSessions: telephonyState.executionSessions.map((session) =>
          session.callSessionId === callSessionId
            ? {
                ...session,
                status:
                  body.eventType === "transfer.failed" || body.eventType === "failover.triggered"
                    ? "failover-active"
                    : body.eventType === "transfer.requested"
                      ? "transfer-pending"
                      : body.eventType === "voicemail.detected"
                        ? "voicemail"
                        : "active",
                outageMode:
                  body.eventType === "transfer.failed" || body.eventType === "failover.triggered"
                    ? "provider-fallback"
                    : session.outageMode,
                fallbackTarget: body.fallbackTarget ?? session.fallbackTarget,
                updatedAt: "2026-05-14T12:13:00.000Z",
              }
            : session,
        ),
      };

      return jsonResponse(201, {
        state: telephonyState,
        event,
      });
    }

    if (
      pathname === "/organizations/tenant-west-africa/telephony/credentials/rotate" &&
      method === "POST"
    ) {
      const rotatedConnectionCount = telephonyState.connections.filter(
        (connection) => connection.ownershipMode !== "platform_managed",
      ).length;

      telephonyState = {
        ...telephonyState,
        connections: telephonyState.connections.map((connection) =>
          (connection as { credentialReference?: { keyVersion: number } }).credentialReference
            ? {
                ...connection,
                credentialReference: {
                  ...(connection as { credentialReference: { keyVersion: number } }).credentialReference,
                  keyVersion:
                    (connection as { credentialReference: { keyVersion: number } }).credentialReference.keyVersion + 1,
                },
              }
            : connection,
        ),
      };

      return jsonResponse(201, {
        state: telephonyState,
        rotatedConnectionCount,
      });
    }

    return jsonResponse(404, { message: "Not found" });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    getState: () => state,
    grantWorkspaceAccess(input: { workspaceId: string; userId: string; role: TenantRole }) {
      state = {
        ...state,
        memberships: setWorkspaceMembershipRole({
          memberships: state.memberships,
          workspaceId: input.workspaceId,
          tenantId: "tenant-west-africa",
          userId: input.userId,
          role: input.role,
        }),
      };
    },
  };
}

function installLiveSandboxMock() {
  type SessionRecord = {
    sessionId: string;
    organizationId: string;
    workspaceId: string;
    source: string;
    inputMode: string;
    entryRoleId: string;
    manifestId: string;
    publishedVersionId: string;
    runtimeProfile: string;
    transportToken: string;
    transportUrl: string;
    status: "ready" | "active" | "ended";
    createdAt: string;
    expiresAt: string;
    events: Array<{
      sessionId: string;
      sequence: number;
      type: string;
      at: string;
      payload: Record<string, unknown>;
    }>;
    nextSequence: number;
  };

  const sessions = new Map<string, SessionRecord>();
  let voiceProviderConfigured = true;

  class MockWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readyState = 0;
    readonly url: string;
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    private readonly session: SessionRecord;
    private audioChunks: string[] = [];

    constructor(url: string | URL) {
      this.url = String(url);
      const parsed = new URL(this.url, "ws://127.0.0.1:4010");
      const sessionId = parsed.pathname.split("/")[5] ?? "";
      const token = parsed.searchParams.get("token") ?? "";
      const session = sessions.get(sessionId);

      if (session === undefined || session.transportToken !== token) {
        throw new Error(`Live sandbox session '${sessionId}' is not available in the test transport.`);
      }

      this.session = session;
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        this.session.status = "active";
        this.emit("open");
      });
    }

    addEventListener(event: string, listener: (...args: unknown[]) => void) {
      const current = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
      current.add(listener);
      this.listeners.set(event, current);
    }

    removeEventListener(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }

    send(payload: string) {
      const message = JSON.parse(payload) as Record<string, unknown>;

      if (message.type === "input.text") {
        this.emitTurn({
          transcript: String(message.transcript ?? ""),
        });
        return;
      }

      if (message.type === "input.audio.append") {
        this.audioChunks.push(String(message.audioBase64 ?? ""));
        this.emitMessage({
          sessionId: this.session.sessionId,
          sequence: Date.now(),
          type: "input.audio.buffered",
          at: "2026-05-15T09:00:00.000Z",
          payload: {
            chunkCount: this.audioChunks.length,
          },
        });
        this.emitMessage({
          sessionId: this.session.sessionId,
          sequence: Date.now(),
          type: "stt.partial",
          at: "2026-05-15T09:00:01.000Z",
          payload: {
            transcript: "I need help with billing",
            confidence: 0.93,
            language: "en",
          },
        });
        this.emitTurn({
          transcript: "I need help with billing",
        });
        return;
      }

      if (message.type === "input.audio.commit") {
        this.emitMessage({
          sessionId: this.session.sessionId,
          sequence: Date.now(),
          type: "stt.partial",
          at: "2026-05-15T09:00:01.000Z",
          payload: {
            transcript: "I need help with billing",
            confidence: 0.93,
            language: "en",
          },
        });
        this.emitTurn({
          transcript: "I need help with billing",
        });
      }
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      queueMicrotask(() => {
        this.emit("close", {
          code: 1000,
          reason: "closed",
        });
      });
    }

    private emitTurn(input: { transcript: string }) {
      this.emitMessage(createSessionEvent(this.session, {
        type: "turn.transcribed",
        at: "2026-05-15T09:00:02.000Z",
        payload: {
          transcript: input.transcript,
          source: this.session.inputMode === "voice" ? "voice" : "typed",
          language: "en",
          confidence: 0.92,
          callPhase: "discovery",
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "routing.model_selected",
        at: "2026-05-15T09:00:02.050Z",
        payload: {
          tier: this.session.runtimeProfile === "balanced" ? "standard" : "cheap",
          source: "rule",
          matchedRuleId: "route-billing-standard",
          reason: "Billing discovery needs a stronger reasoning tier.",
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "tool.completed",
        at: "2026-05-15T09:00:02.080Z",
        payload: {
          nodeId: "tool-customer-profile",
          toolId: "hubspot.profile.lookup",
          toolName: "Customer profile lookup",
          summary: "Customer profile lookup completed in 42ms.",
          durationMs: 42,
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "turn.audio.first_byte",
        at: "2026-05-15T09:00:02.100Z",
        payload: {
          latencyMs: 180,
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "provider.telemetry",
        at: "2026-05-15T09:00:02.110Z",
        payload: {
          stage: "tts",
          provider: "cartesia-sonic-3",
          latencyMs: 180,
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "turn.audio.chunk",
        at: "2026-05-15T09:00:02.120Z",
        payload: {
          audioBase64: "QmlsbGluZyBhdWRpbyBjaHVuaw==",
          chunkIndex: 0,
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "turn.completed",
        at: "2026-05-15T09:00:02.150Z",
        payload: {
          transcript: input.transcript,
          responseText: "Billing support is ready to help with that request.",
          audioChunkCount: 1,
          degraded: false,
        },
      }));
      this.emitMessage(createSessionEvent(this.session, {
        type: "turn.cost.delta",
        at: "2026-05-15T09:00:02.180Z",
        payload: {
          currency: "USD",
          totalUsd: 0.001894,
          modelTier: this.session.runtimeProfile === "balanced" ? "standard" : "cheap",
        },
      }));
    }

    private emitMessage(message: Record<string, unknown>) {
      queueMicrotask(() => {
        this.emit("message", {
          data: JSON.stringify(message),
        });
      });
    }

    private emit(event: string, ...args: unknown[]) {
      const listeners = this.listeners.get(event);

      if (listeners === undefined) {
        return;
      }

      for (const listener of listeners) {
        listener(...args);
      }
    }
  }

  return {
    WebSocket: MockWebSocket,
    createSession(input: {
      organizationId: string;
      workspaceId: string;
      source: string;
      inputMode: string;
      entryRoleId: string;
      manifestId: string;
      publishedVersionId: string;
      runtimeProfile: string;
    }) {
      if (input.inputMode === "voice" && !voiceProviderConfigured) {
        throw new Error(
          "Live voice sandbox requires provider credentials before recording can start. Missing: ASSEMBLYAI_API_KEY, CARTESIA_API_KEY.",
        );
      }

      const sessionId = `sandbox-live-${sessions.size + 1}`;
      const transportToken = `transport-token-${sessions.size + 1}`;
      const session: SessionRecord = {
        sessionId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        source: input.source,
        inputMode: input.inputMode,
        entryRoleId: input.entryRoleId,
        manifestId: input.manifestId,
        publishedVersionId: input.publishedVersionId,
        runtimeProfile: input.runtimeProfile,
        transportToken,
        transportUrl: `ws://127.0.0.1:4010/organizations/${input.organizationId}/sandbox/live-sessions/${sessionId}/stream`,
        status: "ready",
        createdAt: "2026-05-15T09:00:00.000Z",
        expiresAt: "2026-05-15T09:10:00.000Z",
        events: [],
        nextSequence: 1,
      };

      sessions.set(sessionId, session);

      return toMockSessionResponse(session, true);
    },
    listSessions(input: {
      workspaceId?: string | undefined;
      includeEnded: boolean;
    }) {
      return [...sessions.values()]
        .filter((session) => input.workspaceId === undefined || session.workspaceId === input.workspaceId)
        .filter((session) => input.includeEnded || session.status !== "ended")
        .map((session) => {
          const latestRoutingEvent = [...session.events]
            .reverse()
            .find((event) => event.type === "routing.model_selected");
          const latestHandoffEvent = [...session.events]
            .reverse()
            .find((event) => event.type === "agent.handoff.completed");
          const latestTranscriptEvent = [...session.events]
            .reverse()
            .find((event) => event.type === "turn.transcribed" || event.type === "turn.completed");

          return {
            sessionId: session.sessionId,
            workspaceId: session.workspaceId,
            source: session.source as "draft" | "published",
            status: session.status,
            runtimeProfile: session.runtimeProfile as "cost-optimized" | "balanced" | "premium-realtime",
            activeRoleName:
              typeof latestHandoffEvent?.payload.targetRoleName === "string"
                ? latestHandoffEvent.payload.targetRoleName
                : "Front desk triage",
            runtimeTier:
              typeof latestRoutingEvent?.payload.tier === "string"
                ? latestRoutingEvent.payload.tier
                : session.runtimeProfile === "balanced"
                  ? "standard"
                  : "cheap",
            eventCount: session.events.length,
            turnCount: session.events.filter((event) => event.type === "turn.completed").length,
            lastEventAt: session.events.at(-1)?.at ?? session.createdAt,
            lastEventType: session.events.at(-1)?.type,
            lastTranscriptPreview:
              typeof latestTranscriptEvent?.payload.transcript === "string"
                ? latestTranscriptEvent.payload.transcript
                : typeof latestTranscriptEvent?.payload.responseText === "string"
                  ? latestTranscriptEvent.payload.responseText
                  : undefined,
          };
        });
    },
    getSessionEvents(sessionId: string, afterSequence?: string | undefined) {
      const session = sessions.get(sessionId);

      if (session === undefined) {
        throw new Error(`Live sandbox session '${sessionId}' was not found.`);
      }

      const parsedAfterSequence = afterSequence === undefined ? undefined : Number(afterSequence);

      return session.events.filter((event) =>
        Number.isFinite(parsedAfterSequence) ? event.sequence > Number(parsedAfterSequence) : true,
      );
    },
    reconnectSession(sessionId: string) {
      const session = sessions.get(sessionId);

      if (session === undefined) {
        throw new Error(`Live sandbox session '${sessionId}' was not found.`);
      }

      session.transportToken = `transport-token-${sessionId}-${session.nextSequence}`;
      session.status = "active";
      return toMockSessionResponse(session, true);
    },
    endSession(sessionId: string) {
      const session = sessions.get(sessionId);

      if (session === undefined) {
        throw new Error(`Live sandbox session '${sessionId}' was not found.`);
      }

      session.status = "ended";

      return {
        ...toMockSessionResponse(session, false),
        endedAt: "2026-05-15T09:03:00.000Z",
      };
    },
    setVoiceProviderConfigured(nextValue: boolean) {
      voiceProviderConfigured = nextValue;
    },
  };
}

function createSessionEvent(
  session: {
    sessionId: string;
    events: Array<{
      sessionId: string;
      sequence: number;
      type: string;
      at: string;
      payload: Record<string, unknown>;
    }>;
    nextSequence: number;
  },
  input: {
    type: string;
    at: string;
    payload: Record<string, unknown>;
  },
) {
  const event = {
    sessionId: session.sessionId,
    sequence: session.nextSequence,
    type: input.type,
    at: input.at,
    payload: input.payload,
  };
  session.nextSequence += 1;
  session.events.push(event);
  return event;
}

function toMockSessionResponse(
  session: {
    sessionId: string;
    organizationId: string;
    workspaceId: string;
    source: string;
    inputMode: string;
    entryRoleId: string;
    manifestId: string;
    publishedVersionId: string;
    runtimeProfile: string;
    transportUrl: string;
    transportToken: string;
    createdAt: string;
    expiresAt: string;
    status: "ready" | "active" | "ended";
  },
  includeTransportToken: boolean,
) {
  return {
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    workspaceId: session.workspaceId,
    actorUserId: "user-ops-lead",
    source: session.source,
    inputMode: session.inputMode,
    entryRoleId: session.entryRoleId,
    manifestId: session.manifestId,
    publishedVersionId: session.publishedVersionId,
    runtimeProfile: session.runtimeProfile,
    transportUrl: session.transportUrl,
    ...(includeTransportToken ? { transportToken: session.transportToken } : {}),
    providerStack: {
      stt: "assemblyai-streaming",
      tts: "cartesia-sonic-3",
    },
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    status: session.status,
  };
}

function installMicrophoneMock() {
  const stream = {
    getTracks: () => [
      {
        stop: vi.fn(),
      } as unknown as MediaStreamTrack,
    ],
  } as MediaStream;

  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => stream),
    },
  });

  class MockAudioContext {
    readonly sampleRate = 16_000;
    readonly currentTime = 0;
    readonly destination = {};

    createMediaStreamSource() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    createScriptProcessor() {
      return {
        onaudioprocess: null as unknown,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    createGain() {
      return {
        gain: {
          value: 0,
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    createBuffer() {
      return {
        duration: 0,
        copyToChannel: vi.fn(),
      };
    }

    createBufferSource() {
      return {
        buffer: null as unknown,
        connect: vi.fn(),
        start: vi.fn(),
      };
    }

    async resume() {}

    async close() {}
  }

  vi.stubGlobal("AudioContext", MockAudioContext);
}

function createInitialTelephonyState() {
  return {
    organizationId: "tenant-west-africa",
    connections: [] as Array<Record<string, unknown>>,
    phoneNumbers: [] as Array<Record<string, unknown>>,
    healthChecks: [] as Array<Record<string, unknown>>,
    providerHeartbeats: [] as Array<Record<string, unknown>>,
    dispatches: [] as Array<Record<string, unknown>>,
    executionSessions: [] as Array<Record<string, unknown>>,
    executionCommands: [] as Array<Record<string, unknown>>,
    webhookEvents: [] as Array<Record<string, unknown>>,
    callControlEvents: [] as Array<Record<string, unknown>>,
  };
}

type TestTelephonyLiveRoute = {
  publishedVersionId?: string;
  workflowLabel?: string;
  workspaceId?: string;
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime";
  activationStatus?: "pending_activation" | "active" | "paused";
  activatedAt?: string;
  pausedAt?: string;
};

function createTenantMemoryExport() {
  return {
    organizationId: "tenant-west-africa",
    exportedAt: "2026-05-22T09:30:00.000Z",
    memories: [
      {
        id: "memory-approved-1",
        organizationId: "tenant-west-africa",
        scope: "caller",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        text: "Caller prefers WhatsApp follow-up after billing calls.",
        source: {
          kind: "call_summary",
          callSessionId: "call-001",
        },
        confidence: 0.82,
        approvalState: "approved",
        status: "active",
        createdBy: "user-ops-lead",
        createdAt: "2026-05-18T12:00:00.000Z",
        updatedAt: "2026-05-18T12:00:00.000Z",
        auditTrail: [
          {
            action: "memory_created",
            actorUserId: "user-ops-lead",
            at: "2026-05-18T12:00:00.000Z",
          },
        ],
      },
    ],
    drafts: [
      {
        id: "memory-draft-1",
        organizationId: "tenant-west-africa",
        scope: "account",
        callerIdentity: {
          kind: "phone",
          value: "+2348011112222",
        },
        accountId: "acct-lagos-77",
        text: "Caller mentioned a new Lagos renewal contact.",
        source: {
          kind: "call_summary",
          callSessionId: "call-002",
        },
        confidence: 0.74,
        approvalState: "pending",
        status: "draft",
        createdBy: "user-ops-lead",
        createdAt: "2026-05-21T12:00:00.000Z",
        updatedAt: "2026-05-21T12:00:00.000Z",
        auditTrail: [],
      },
    ],
    knowledge: [
      {
        id: "knowledge-billing-policy",
        organizationId: "tenant-west-africa",
        kind: "policy",
        publishedWorkflowVersionIds: ["workflow-support-triage-v3"],
        title: "Billing routing policy",
        text: "Billing disputes route to the billing specialist.",
        source: {
          kind: "manual",
          title: "Billing routing policy",
        },
        conflictState: "none",
        status: "active",
        createdBy: "user-ops-lead",
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z",
      },
    ],
    ingestions: [
      {
        id: "ingestion-crm-help",
        organizationId: "tenant-west-africa",
        status: "partial_failure",
        sourceCount: 3,
        succeededCount: 2,
        failedCount: 1,
        publishedWorkflowVersionIds: ["workflow-support-triage-v3"],
        sources: [],
        createdBy: "user-ops-lead",
        createdAt: "2026-05-21T11:00:00.000Z",
        updatedAt: "2026-05-21T11:10:00.000Z",
      },
    ],
    embeddings: [
      {
        id: "embedding-memory-approved-1",
        recordKind: "memory",
        recordId: "memory-approved-1",
        scope: "caller",
        confidence: 0.82,
        createdAt: "2026-05-18T12:00:00.000Z",
      },
    ],
  };
}

function createTenantBillingState() {
  return {
    organizationId: "tenant-west-africa",
    provider: "polar",
    customerExternalId: "tenant-west-africa",
    plan: {
      slug: "growth",
      name: "Growth",
      status: "active",
      monthlyBaseUsd: 129,
      includedMinutes: 8000,
      budgetLimitUsd: 900,
      budgetUsedUsd: 742.18,
      budgetWarning: true,
    },
    subscription: {
      provider: "polar",
      providerCustomerId: "polar_customer_1",
      providerSubscriptionId: "polar_subscription_1",
      status: "active",
      currentPeriodEnd: "2026-06-22T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    },
    usage: [
      {
        id: "usage-runtime-minutes",
        label: "Runtime minutes",
        used: 4820,
        limit: 8000,
        unit: "min",
        costUsd: 318.44,
      },
      {
        id: "usage-premium-realtime-minutes",
        label: "Premium realtime minutes",
        used: 186,
        limit: 300,
        unit: "min",
        costUsd: 214.5,
      },
      {
        id: "usage-telephony-minutes",
        label: "Telephony minutes",
        used: 6230,
        limit: 10000,
        unit: "min",
        costUsd: 209.24,
      },
    ],
    entitlements: [
      {
        id: "benefit-premium-runtime",
        label: "Premium realtime minutes",
        status: "granted",
      },
    ],
    invoices: [
      {
        id: "billing-invoice-1",
        provider: "polar",
        providerOrderId: "polar_order_1",
        invoiceNumber: "INV-2026-051",
        amountUsd: 129,
        status: "paid",
        createdAt: "2026-05-01T12:00:00.000Z",
      },
    ],
    updatedAt: "2026-05-22T09:30:00.000Z",
  };
}

function toWorkspaceStateBody(state: WorkspaceSeedState) {
  return {
    organizationId: state.tenantId,
    directoryUsers: state.directoryUsers,
    workspaces: state.workspaces,
    memberships: state.memberships,
    auditEntries: state.auditEntries,
  };
}

function seedPublishedWorkflowForApp(input: {
  workflowId: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  runtimeProfile?: "cost-optimized" | "balanced" | "premium-realtime" | undefined;
}): PublishedWorkflowVersion {
  const graph = createWorkflowGraph({
    id: input.workflowId,
    name: input.name,
    nodes: [
      {
        id: "entry",
        kind: "entry",
        label: "Inbound call",
        position: { x: 0, y: 120 },
        config: { channel: "phone" },
      },
      createAgentRoleNode({
        id: "agent-front-desk",
        label: "Front desk triage",
        position: { x: 260, y: 120 },
        role: {
          kind: "receptionist",
          name: "Front desk triage",
          businessName: "Tuzzy Labs",
          instructions: "Welcome callers, identify intent, and route specialist work.",
          defaultModelTier: "cheap",
          languagePolicy: {
            defaultLanguage: "en",
            supportedLanguages: ["en", "fr"],
            allowMidCallSwitching: true,
          },
          reusableSpecialist: true,
        },
      }),
    ],
    edges: [
      {
        id: "edge-entry-agent",
        sourceNodeId: "entry",
        targetNodeId: "agent-front-desk",
      },
    ],
  });
  const version = publishWorkflowVersion({
    workflowId: input.workflowId,
    tenantId: "tenant-west-africa",
    workspaceId: input.workspaceId,
    environment: "production",
    createdBy: "user-ops-lead",
    createdAt: input.createdAt,
    graph,
    existingVersions: [],
    runtime: input.runtimeProfile === "premium-realtime" ? "openai-realtime" : "sandwich-pipeline",
    runtimeProfile: input.runtimeProfile ?? "cost-optimized",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session", "caller"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 80,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.18,
      blockOnLimit: true,
    },
  });

  savePublishedWorkflowVersion(version);
  return version;
}

function publishCurrentWorkflow(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));

  const dialog = screen.getByRole("dialog", { name: "Publish workflow" });
  fireEvent.change(within(dialog).getByLabelText("Workflow name"), {
    target: { value: name },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: /^(Publish|Overwrite) workflow$/ }));
}

function createTestAuthClient(initialSession: ZaraAuthSession | null): ZaraAuthClient {
  let snapshot: ZaraSessionSnapshot = {
    data: initialSession,
    isPending: false,
    error: null,
  };

  return {
    useSession: () => snapshot,
    getContext: async () => toAuthContext(snapshot.data),
    signInEmail: async (input: ZaraSignInEmailInput) => {
      snapshot = {
        data: {
          user: {
            id: "user-ops-lead",
            name: "Operations lead",
            email: input.email,
          },
          organization: {
            id: "tenant-west-africa",
            name: "Tuzzy Labs",
            role: "admin",
          },
        },
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
    signUpEmail: async (input: ZaraSignUpEmailInput) => {
      snapshot = {
        data: {
          user: {
            id: "user-new-builder",
            name: input.name,
            email: input.email,
          },
          organization: {
            id: "tenant-west-africa",
            name: "Tuzzy Labs",
            role: "admin",
          },
        },
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
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
    signOut: async () => {
      snapshot = {
        data: null,
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
  };
}

function createSignupSequenceAuthClient(results: ZaraAuthActionResult[]): ZaraAuthClient {
  let snapshot: ZaraSessionSnapshot = {
    data: null,
    isPending: false,
    error: null,
  };
  let callCount = 0;

  return {
    useSession: () => snapshot,
    getContext: async () => toAuthContext(snapshot.data),
    signInEmail: async () => ({ ok: false, message: "Sign in is not used in this test." }),
    signUpEmail: async (input: ZaraSignUpEmailInput) => {
      const result = results[Math.min(callCount, results.length - 1)] ?? { ok: true };
      callCount += 1;

      if (result.ok) {
        snapshot = {
          data: {
            user: {
              id: "user-new-builder",
              name: input.name,
              email: input.email,
            },
            organization: {
              id: "tenant-west-africa",
              name: input.organizationName,
              role: "owner",
            },
          },
          isPending: false,
          error: null,
        };
      }

      return result;
    },
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
    signOut: async () => {
      snapshot = {
        data: null,
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
  };
}

function createOrganizationChooserAuthClient(): ZaraAuthClient {
  let snapshot: ZaraSessionSnapshot = {
    data: {
      user: {
        id: "user-ops-lead",
        name: "Operations lead",
        email: "ops@tuzzy.example",
      },
      organization: null,
    },
    isPending: false,
    error: null,
  };
  const memberships = [
    {
      organizationId: "tenant-west-africa",
      organizationName: "Tuzzy Labs",
      role: "admin" as const,
    },
    {
      organizationId: "tenant-northwind",
      organizationName: "Northwind Support",
      role: "owner" as const,
    },
  ];

  return {
    useSession: () => snapshot,
    getContext: async () => ({
      authenticated: snapshot.data !== null,
      user: snapshot.data?.user ?? null,
      activeOrganization: snapshot.data?.organization ?? null,
      memberships,
      activeWorkspace: snapshot.data?.organization === null
        ? null
        : {
            id: "workspace-operations",
            name: "Operations",
      },
      platformRole: null,
      platformAuth: signedOutPlatformAuth(),
      permissions: {
        tenant: [],
        platform: [],
      },
    }),
    signInEmail: async () => ({ ok: false, message: "Sign in is not used in this test." }),
    signUpEmail: async () => ({ ok: false, message: "Sign up is not used in this test." }),
    selectOrganization: async (input) => {
      const membership = memberships.find((candidate) => candidate.organizationId === input.organizationId);

      if (membership === undefined) {
        return { ok: false, message: "Choose an available tenant organization." };
      }

      snapshot = {
        data: {
          user: {
            id: "user-ops-lead",
            name: "Operations lead",
            email: "ops@tuzzy.example",
          },
          organization: {
            id: membership.organizationId,
            name: membership.organizationName,
            role: membership.role,
          },
        },
        isPending: false,
        error: null,
      };

      return { ok: true };
    },
    requestPasswordReset: async () => ({ ok: true }),
    resetPassword: async () => ({ ok: true }),
    requestEmailVerification: async () => ({ ok: true }),
    listSessions: async () => ({ ok: true, sessions: [] }),
    revokeSession: async () => ({ ok: true }),
    createInvitation: async () => ({ ok: false, message: "Invitations are not used in this test." }),
    listInvitations: async () => ({ ok: true, invitations: [] }),
    revokeInvitation: async () => ({ ok: false, message: "Invitations are not used in this test." }),
    acceptInvitation: async () => ({ ok: false, message: "Invitations are not used in this test." }),
    signOut: async () => {
      snapshot = {
        data: null,
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
  };
}

function fillSignupForm() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "New Builder" },
  });
  fireEvent.change(screen.getByLabelText("Organization name"), {
    target: { value: "Acme Voice Ops" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "builder@tuzzy.example" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "correct-horse-battery" },
  });
}

function toAuthContext(session: ZaraAuthSession | null) {
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
    activeWorkspace: session === null
      ? null
      : {
          id: "workspace-support",
          name: "Support",
    },
    platformRole: session?.platformRole ?? null,
    platformAuth: session?.platformAuth ?? signedOutPlatformAuth(),
    permissions: {
      tenant: [],
      platform: [],
    },
  };
}

function signedOutPlatformAuth() {
  return {
    role: null,
    assuranceLevel: "none" as const,
    sessionAgeSeconds: null,
    mfaVerified: false,
    passkeyVerified: false,
    mutationAllowed: false,
    supportActionAllowed: false,
    impersonationSafe: false,
    reason: "signed_out" as const,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
