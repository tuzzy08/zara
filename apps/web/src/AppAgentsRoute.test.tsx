/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZaraAuthClient, ZaraAuthContext, ZaraAuthSession, ZaraSessionSnapshot } from "@zara/auth-client";
import {
  createDefaultWorkspaceSeedState,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from "@zara/core";

import { App } from "./App";

describe("tenant agents route", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/organizations/tenant-west-africa/workspaces/state")) {
        const state = createDefaultWorkspaceSeedState({
          tenantId: "tenant-west-africa",
        });

        return new Response(JSON.stringify({
          organizationId: "tenant-west-africa",
          directoryUsers: state.directoryUsers,
          workspaces: state.workspaces,
          memberships: state.memberships,
          auditEntries: state.auditEntries,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    }));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("mounts reusable agents at /agents and points the Agents nav there", async () => {
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App authClient={createTestAuthClient()} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Agent library" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents"));
  });
});

function createTestAuthClient(): ZaraAuthClient {
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
  const snapshot: ZaraSessionSnapshot = {
    data: session,
    isPending: false,
    error: null,
  };

  return {
    useSession: () => snapshot,
    getContext: async (): Promise<ZaraAuthContext> => ({
      authenticated: true,
      user: session.user,
      activeOrganization: session.organization ?? null,
      memberships: [],
      activeWorkspace: {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
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
    signInEmail: async () => ({ ok: false, message: "Not used." }),
    signUpEmail: async () => ({ ok: false, message: "Not used." }),
    selectOrganization: async () => ({ ok: false, message: "Not used." }),
    requestPasswordReset: async () => ({ ok: false, message: "Not used." }),
    resetPassword: async () => ({ ok: false, message: "Not used." }),
    requestEmailVerification: async () => ({ ok: false, message: "Not used." }),
    listSessions: async () => ({ ok: true, sessions: [] }),
    revokeSession: async () => ({ ok: false, message: "Not used." }),
    createInvitation: async () => ({ ok: false, message: "Not used." }),
    listInvitations: async () => ({ ok: true, invitations: [] }),
    revokeInvitation: async () => ({ ok: false, message: "Not used." }),
    acceptInvitation: async () => ({ ok: false, message: "Not used." }),
    signOut: async () => ({ ok: true }),
  };
}
