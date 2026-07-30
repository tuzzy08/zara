/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ZaraAuthClient,
  ZaraAuthContext,
  ZaraAuthSession,
  ZaraSessionSnapshot,
  ZaraSignInEmailInput,
} from "@zara/auth-client";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "@zara/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App";

function LocationPathProbe() {
  return <div data-testid="location-path">{useLocation().pathname}</div>;
}

describe("tenant application shell", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("offers authentication without mounting the tenant shell for signed-out visitors", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App authClient={createAuthClient(null)} />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByRole("link", { name: "Sign in" })
        .every((link) => link.getAttribute("href") === "/login"),
    ).toBe(true);
    expect(screen.queryByLabelText("Tenant")).toBeNull();
  });

  it("gates a tenant route, enters the shell after sign-in, and returns home after sign-out", async () => {
    const authClient = createAuthClient(null);

    render(
      <MemoryRouter initialEntries={["/settings"]}>
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

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-path").textContent).toBe("/");
      expect(screen.queryByLabelText("Tenant")).toBeNull();
    });
  });

  it("requires a multi-tenant user to select an organization before entering the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App authClient={createOrganizationChooserAuthClient()} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Choose a tenant" })).toBeTruthy();
    expect(screen.queryByLabelText("Tenant")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose Northwind Support" }));

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
  });

  it("enters the tenant shell from server-owned context without a session snapshot", async () => {
    const authClient = createAuthClient(null, authenticatedContext());

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App authClient={authClient} />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Tenant")).toBeTruthy();
    expect(screen.queryByText("Workspace access required")).toBeNull();
  });
});

function createAuthClient(
  initialSession: ZaraAuthSession | null,
  contextOverride?: ZaraAuthContext,
): ZaraAuthClient {
  let snapshot: ZaraSessionSnapshot = {
    data: initialSession,
    isPending: false,
    error: null,
  };

  return createAuthClientContract({
    getSnapshot: () => snapshot,
    getContext: async () => contextOverride ?? toAuthContext(snapshot.data),
    signInEmail: async (input) => {
      snapshot = {
        data: authenticatedSession(input),
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
    signOut: async () => {
      snapshot = {
        data: null,
        isPending: false,
        error: null,
      };
      return { ok: true };
    },
  });
}

function createOrganizationChooserAuthClient(): ZaraAuthClient {
  let snapshot: ZaraSessionSnapshot = {
    data: {
      user: testUser(),
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

  return createAuthClientContract({
    getSnapshot: () => snapshot,
    getContext: async () => ({
      ...signedOutContext(),
      authenticated: true,
      user: testUser(),
      activeOrganization: snapshot.data?.organization ?? null,
      memberships,
      activeWorkspace: snapshot.data?.organization === null
        ? null
        : defaultWorkspace(),
    }),
    selectOrganization: async ({ organizationId }) => {
      const membership = memberships.find((candidate) => candidate.organizationId === organizationId);

      if (membership === undefined) {
        return { ok: false, message: "Choose an available tenant organization." };
      }

      snapshot = {
        data: {
          user: testUser(),
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
  });
}

type AuthClientContractOptions = {
  getSnapshot: () => ZaraSessionSnapshot;
  getContext: () => Promise<ZaraAuthContext>;
  signInEmail?: ZaraAuthClient["signInEmail"];
  selectOrganization?: ZaraAuthClient["selectOrganization"];
  signOut?: ZaraAuthClient["signOut"];
};

function createAuthClientContract(options: AuthClientContractOptions): ZaraAuthClient {
  return {
    useSession: options.getSnapshot,
    getContext: options.getContext,
    signInEmail: options.signInEmail ?? unusedAuthAction,
    signUpEmail: unusedAuthAction,
    selectOrganization: options.selectOrganization ?? unusedAuthAction,
    requestPasswordReset: async () => ({ ok: true }),
    resetPassword: async () => ({ ok: true }),
    requestEmailVerification: async () => ({ ok: true }),
    listSessions: async () => ({ ok: true, sessions: [] }),
    revokeSession: async () => ({ ok: true }),
    createInvitation: unusedAuthAction,
    listInvitations: async () => ({ ok: true, invitations: [] }),
    revokeInvitation: unusedAuthAction,
    acceptInvitation: unusedAuthAction,
    signOut: options.signOut ?? unusedAuthAction,
  };
}

async function unusedAuthAction() {
  return { ok: false as const, message: "This auth action is outside the shell test." };
}

function authenticatedSession(input: ZaraSignInEmailInput): ZaraAuthSession {
  return {
    user: {
      ...testUser(),
      email: input.email,
    },
    organization: testOrganization(),
  };
}

function authenticatedContext(): ZaraAuthContext {
  return {
    ...signedOutContext(),
    authenticated: true,
    user: testUser(),
    activeOrganization: testOrganization(),
    memberships: [
      {
        organizationId: "tenant-west-africa",
        organizationName: "Tuzzy Labs",
        role: "admin",
      },
    ],
    activeWorkspace: defaultWorkspace(),
    permissions: {
      tenant: ["tenant:read"],
      platform: [],
    },
  };
}

function toAuthContext(session: ZaraAuthSession | null): ZaraAuthContext {
  if (session === null) {
    return signedOutContext();
  }

  return {
    ...authenticatedContext(),
    user: session.user,
    activeOrganization: session.organization,
    memberships: session.organization === null
      ? []
      : [
          {
            organizationId: session.organization.id,
            organizationName: session.organization.name,
            role: session.organization.role,
          },
        ],
  };
}

function signedOutContext(): ZaraAuthContext {
  return {
    authenticated: false,
    user: null,
    activeOrganization: null,
    memberships: [],
    activeWorkspace: null,
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
  };
}

function testUser() {
  return {
    id: "user-ops-lead",
    name: "Operations lead",
    email: "ops@tuzzy.example",
  };
}

function testOrganization() {
  return {
    id: "tenant-west-africa",
    name: "Tuzzy Labs",
    role: "admin" as const,
  };
}

function defaultWorkspace() {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
  };
}
