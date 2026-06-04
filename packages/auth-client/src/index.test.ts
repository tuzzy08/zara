import { beforeEach, describe, expect, it, vi } from "vitest";

const setActive = vi.fn();
const list = vi.fn();
const createOrganization = vi.fn();
const getActiveMember = vi.fn();
const getFullOrganization = vi.fn();
const useActiveOrganization = vi.fn();
const useActiveMember = vi.fn();
const useBetterAuthSession = vi.fn();
const signInEmail = vi.fn();
const signUpEmail = vi.fn();
const fetchAuthContext = vi.fn();
let sessionSnapshot: unknown;
let activeOrganizationSnapshot: unknown;
let activeMemberSnapshot: unknown;

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: useBetterAuthSession,
    useActiveOrganization,
    useActiveMember,
    signIn: {
      email: signInEmail,
    },
    signUp: {
      email: signUpEmail,
    },
    signOut: vi.fn(),
    organization: {
      create: createOrganization,
      list,
      setActive,
      getActiveMember,
      getFullOrganization,
    },
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
}));

describe("tenant auth client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchAuthContext);
    sessionSnapshot = { data: null, isPending: false, error: null };
    activeOrganizationSnapshot = { data: null, isPending: false, error: null };
    activeMemberSnapshot = { data: null, isPending: false, error: null };
    useBetterAuthSession.mockImplementation(() => sessionSnapshot);
    useActiveOrganization.mockImplementation(() => activeOrganizationSnapshot);
    useActiveMember.mockImplementation(() => activeMemberSnapshot);
    signInEmail.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
      },
      error: null,
    });
    signUpEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    list.mockResolvedValue({
      data: [
        {
          id: "org-acme",
          name: "Acme Voice Ops",
        },
      ],
      error: null,
    });
    setActive.mockResolvedValue({
      data: {
        id: "org-acme",
        name: "Acme Voice Ops",
      },
      error: null,
    });
    getActiveMember.mockResolvedValue({
      data: {
        userId: "user-1",
        organizationId: "org-acme",
        role: "owner",
      },
      error: null,
    });
    getFullOrganization.mockResolvedValue({
      data: {
        id: "org-acme",
        name: "Acme Voice Ops",
        members: [
          {
            userId: "user-1",
            role: "owner",
          },
        ],
      },
      error: null,
    });
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: false,
        user: null,
        activeOrganization: null,
        memberships: [],
        activeWorkspace: null,
        platformRole: null,
        permissions: {
          tenant: [],
          platform: [],
        },
      }),
    });
  });

  it("restores the user's tenant organization after email sign-in", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
        activeOrganization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
        memberships: [
          {
            organizationId: "org-acme",
            organizationName: "Acme Voice Ops",
            role: "owner",
          },
        ],
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
        platformRole: null,
        permissions: {
          tenant: ["tenant:read"],
          platform: [],
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signInEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
      callbackURL: "/login",
    });

    expect(result).toEqual({ ok: true });
    expect(signInEmail).toHaveBeenCalledWith({
      email: "owner@acme.example",
      password: "correct-horse-battery",
    });
    expect(list).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith({
      organizationId: "org-acme",
    });
    expect(fetchAuthContext).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/context$/),
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("does not silently choose an organization after multi-tenant email sign-in", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
        activeOrganization: null,
        memberships: [
          {
            organizationId: "org-acme",
            organizationName: "Acme Voice Ops",
            role: "owner",
          },
          {
            organizationId: "org-northwind",
            organizationName: "Northwind Support",
            role: "admin",
          },
        ],
        activeWorkspace: null,
        platformRole: null,
        permissions: {
          tenant: [],
          platform: [],
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signInEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
    });

    expect(result).toEqual({ ok: true });
    expect(list).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it("sets the tenant organization chosen by the user", async () => {
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.selectOrganization({
      organizationId: "org-northwind",
    });

    expect(result).toEqual({ ok: true });
    expect(setActive).toHaveBeenCalledWith({
      organizationId: "org-northwind",
    });
  });

  it("keeps the restored tenant organization available while session hooks catch up after sign-in", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
        activeOrganization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
        memberships: [
          {
            organizationId: "org-acme",
            organizationName: "Acme Voice Ops",
            role: "owner",
          },
        ],
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
        platformRole: null,
        permissions: {
          tenant: ["tenant:read"],
          platform: [],
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signInEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
    });

    sessionSnapshot = {
      data: {
        session: {},
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
      },
      error: null,
      isPending: false,
    };
    activeOrganizationSnapshot = { data: null, error: null, isPending: false };
    activeMemberSnapshot = { data: null, error: null, isPending: false };

    expect(result).toEqual({ ok: true });
    expect(tenantAuthClient.useSession()).toMatchObject({
      data: {
        user: {
          id: "user-1",
          email: "owner@acme.example",
        },
        organization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
      },
      isPending: false,
      error: null,
    });
  });

  it("rejects signup without a real tenant organization name before creating a user", async () => {
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signUpEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
      name: "Acme Owner",
      organizationName: "   ",
    });

    expect(result).toEqual({
      ok: false,
      message: "Enter a tenant organization name to create your Zara account.",
    });
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("uses the server-owned tenant onboarding action for signup", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        onboarding: {
          status: "complete",
          resumed: false,
        },
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
        activeOrganization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signUpEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
      name: "Acme Owner",
      organizationName: "Acme Voice Ops",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchAuthContext).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/onboarding\/signup$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "owner@acme.example",
          password: "correct-horse-battery",
          name: "Acme Owner",
          organizationName: "Acme Voice Ops",
        }),
      }),
    );
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(createOrganization).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it.each([
    [
      "tenant_onboarding_recoverable",
      "Organization creation failed after the user account was created. Retry to finish setup.",
    ],
    [
      "tenant_name_unavailable",
      "That tenant organization name is already in use. Choose a different name.",
    ],
  ])("returns server-owned onboarding error messages for %s", async (code, message) => {
    fetchAuthContext.mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        code,
        message,
      }),
    });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.signUpEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
      name: "Acme Owner",
      organizationName: "Acme Voice Ops",
    })).resolves.toEqual({
      ok: false,
      message,
    });
  });

  it("ignores Better Auth refetch snapshots during normal tenant rendering", async () => {
    sessionSnapshot = {
      data: {
        session: {},
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
      },
      error: null,
      isPending: false,
      isRefetching: true,
    };

    const { tenantAuthClient } = await import("./index");

    expect(tenantAuthClient.useSession()).toEqual({
      data: null,
      isPending: false,
      error: null,
    });
    expect(useBetterAuthSession).not.toHaveBeenCalled();
  });

  it("does not mount Better Auth organization readers during normal session rendering", async () => {
    sessionSnapshot = {
      data: {
        session: {
          activeOrganizationId: "org-acme",
        },
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
      },
      error: null,
      isPending: false,
    };
    activeOrganizationSnapshot = {
      data: {
        id: "org-acme",
        name: "Acme Voice Ops",
      },
      error: null,
      isPending: false,
    };
    activeMemberSnapshot = {
      data: {
        userId: "user-1",
        organizationId: "org-acme",
        role: "owner",
      },
      error: null,
      isPending: false,
    };

    const { tenantAuthClient } = await import("./index");

    expect(tenantAuthClient.useSession()).toEqual({
      data: null,
      isPending: false,
      error: null,
    });
    expect(useBetterAuthSession).not.toHaveBeenCalled();
    expect(useActiveOrganization).not.toHaveBeenCalled();
    expect(useActiveMember).not.toHaveBeenCalled();
  });

  it("does not mount Better Auth session or organization readers during normal tenant rendering", async () => {
    sessionSnapshot = {
      data: {
        session: {
          activeOrganizationId: "org-acme",
        },
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
      },
      error: null,
      isPending: false,
    };
    activeOrganizationSnapshot = {
      data: {
        id: "org-acme",
        name: "Acme Voice Ops",
      },
      error: null,
      isPending: false,
    };
    activeMemberSnapshot = {
      data: {
        userId: "user-1",
        organizationId: "org-acme",
        role: "owner",
      },
      error: null,
      isPending: false,
    };

    const { tenantAuthClient } = await import("./index");

    expect(tenantAuthClient.useSession()).toEqual({
      data: null,
      isPending: false,
      error: null,
    });
    expect(useBetterAuthSession).not.toHaveBeenCalled();
    expect(useActiveOrganization).not.toHaveBeenCalled();
    expect(useActiveMember).not.toHaveBeenCalled();
  });

  it("restores tenant organization role from the server-owned auth context", async () => {
    sessionSnapshot = {
      data: {
        session: {
          activeOrganizationId: "org-acme",
        },
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
      },
      error: null,
      isPending: false,
    };
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
        activeOrganization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
        memberships: [
          {
            organizationId: "org-acme",
            organizationName: "Acme Voice Ops",
            role: "owner",
          },
        ],
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
        platformRole: null,
        permissions: {
          tenant: ["tenant:read"],
          platform: [],
        },
      }),
    });

    const { tenantAuthClient } = await import("./index");

    await tenantAuthClient.getContext();

    expect(tenantAuthClient.useSession()).toMatchObject({
      data: {
        user: {
          id: "user-1",
          email: "owner@acme.example",
        },
        organization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
      },
      isPending: false,
      error: null,
    });
    expect(useActiveOrganization).not.toHaveBeenCalled();
    expect(useActiveMember).not.toHaveBeenCalled();
  });

  it("fetches the server-owned auth context with session cookies", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-1",
          name: "Acme Owner",
          email: "owner@acme.example",
        },
        activeOrganization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "owner",
        },
        memberships: [
          {
            organizationId: "org-acme",
            organizationName: "Acme Voice Ops",
            role: "owner",
          },
        ],
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
        platformRole: "platform_admin",
        platformAuth: {
          role: "platform_admin",
          assuranceLevel: "mfa",
          sessionAgeSeconds: 420,
          mfaVerified: true,
          passkeyVerified: false,
          mutationAllowed: true,
          supportActionAllowed: true,
          impersonationSafe: true,
          reason: "assured",
        },
        permissions: {
          tenant: ["workflow:read", "workflow:write", "workflow:publish"],
          platform: ["platform:read", "platform:write"],
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.getContext()).resolves.toMatchObject({
      authenticated: true,
      user: {
        email: "owner@acme.example",
      },
      activeOrganization: {
        id: "org-acme",
        role: "owner",
      },
      activeWorkspace: {
        id: "workspace-support",
      },
      platformRole: "platform_admin",
      platformAuth: {
        role: "platform_admin",
        assuranceLevel: "mfa",
        sessionAgeSeconds: 420,
        mutationAllowed: true,
        impersonationSafe: true,
      },
      permissions: {
        tenant: ["workflow:read", "workflow:write", "workflow:publish"],
        platform: ["platform:read", "platform:write"],
      },
    });
    expect(fetchAuthContext).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/context$/),
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("normalizes platform admin posture from the server-owned auth context", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-platform-admin",
          name: "Platform Admin",
          email: "staff@zara.example",
        },
        activeOrganization: null,
        memberships: [],
        activeWorkspace: null,
        platformRole: "platform_admin",
        platformAuth: {
          role: "platform_admin",
          assuranceLevel: "passkey",
          sessionAgeSeconds: 180,
          mfaVerified: false,
          passkeyVerified: true,
          mutationAllowed: true,
          supportActionAllowed: true,
          impersonationSafe: true,
          reason: "assured",
        },
        permissions: {
          tenant: [],
          platform: ["platform:read", "platform:write"],
        },
      }),
    });

    const { platformAdminAuthClient } = await import("./index");

    await expect(platformAdminAuthClient.getContext()).resolves.toMatchObject({
      platformRole: "platform_admin",
      platformAuth: {
        assuranceLevel: "passkey",
        passkeyVerified: true,
        mutationAllowed: true,
      },
    });
    expect(platformAdminAuthClient.useSession()).toMatchObject({
      data: {
        user: {
          id: "user-platform-admin",
        },
        organization: null,
        platformRole: "platform_admin",
        platformAuth: {
          role: "platform_admin",
          assuranceLevel: "passkey",
          sessionAgeSeconds: 180,
          passkeyVerified: true,
          mutationAllowed: true,
          supportActionAllowed: true,
          impersonationSafe: true,
          reason: "assured",
        },
      },
      isPending: false,
    });
  });

  it("restores platform admin session state from the server-owned context after staff sign-in", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: "user-platform-admin",
          name: "Platform Admin",
          email: "staff@zara.example",
        },
        activeOrganization: null,
        memberships: [],
        activeWorkspace: null,
        platformRole: "platform_admin",
        platformAuth: {
          role: "platform_admin",
          assuranceLevel: "mfa",
          sessionAgeSeconds: 240,
          mfaVerified: true,
          passkeyVerified: false,
          mutationAllowed: true,
          supportActionAllowed: true,
          impersonationSafe: true,
          reason: "assured",
        },
        permissions: {
          tenant: [],
          platform: ["platform:read", "platform:write"],
        },
      }),
    });
    const { platformAdminAuthClient } = await import("./index");

    await expect(platformAdminAuthClient.signInEmail({
      email: "staff@zara.example",
      password: "correct-horse-battery",
    })).resolves.toEqual({ ok: true });

    sessionSnapshot = {
      data: {
        session: {},
        user: {
          id: "user-platform-admin",
          name: "Platform Admin",
          email: "staff@zara.example",
        },
      },
      error: null,
      isPending: false,
    };

    expect(platformAdminAuthClient.useSession()).toMatchObject({
      data: {
        user: {
          email: "staff@zara.example",
        },
        organization: null,
        platformRole: "platform_admin",
        platformAuth: {
          assuranceLevel: "mfa",
          mutationAllowed: true,
        },
      },
    });
  });

  it("creates tenant invitations through the server-owned invitation contract", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        invitation: {
          id: "invitation-1",
          email: "operator@acme.example",
          organizationId: "org-acme",
          role: "operator",
          status: "pending",
          inviterId: "user-1",
          expiresAt: "2026-06-02T10:00:00.000Z",
          createdAt: "2026-05-31T10:00:00.000Z",
          workspaceAccess: {
            workspaceId: "workspace-support",
            role: "operator",
          },
          audit: [],
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.createInvitation({
      organizationId: "org-acme",
      email: "operator@acme.example",
      role: "operator",
      workspaceAccess: {
        workspaceId: "workspace-support",
        role: "operator",
      },
    })).resolves.toMatchObject({
      ok: true,
      invitation: {
        id: "invitation-1",
        status: "pending",
      },
    });
    expect(fetchAuthContext).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/invitations$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          organizationId: "org-acme",
          email: "operator@acme.example",
          role: "operator",
          workspaceAccess: {
            workspaceId: "workspace-support",
            role: "operator",
          },
        }),
      }),
    );
  });

  it("lists and revokes tenant invitations through the server-owned invitation contract", async () => {
    fetchAuthContext
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          invitations: [
            {
              id: "invitation-1",
              email: "operator@acme.example",
              organizationId: "org-acme",
              role: "operator",
              status: "pending",
              inviterId: "user-1",
              expiresAt: "2026-06-02T10:00:00.000Z",
              createdAt: "2026-05-31T10:00:00.000Z",
              workspaceAccess: null,
              audit: [],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          invitation: {
            id: "invitation-1",
            email: "operator@acme.example",
            organizationId: "org-acme",
            role: "operator",
            status: "revoked",
            inviterId: "user-1",
            expiresAt: "2026-06-02T10:00:00.000Z",
            createdAt: "2026-05-31T10:00:00.000Z",
            workspaceAccess: null,
            audit: [],
          },
        }),
      });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.listInvitations({
      organizationId: "org-acme",
    })).resolves.toMatchObject({
      ok: true,
      invitations: [
        {
          id: "invitation-1",
          status: "pending",
        },
      ],
    });
    await expect(tenantAuthClient.revokeInvitation({
      invitationId: "invitation-1",
    })).resolves.toMatchObject({
      ok: true,
      invitation: {
        id: "invitation-1",
        status: "revoked",
      },
    });
    expect(fetchAuthContext).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/api\/auth\/invitations\?organizationId=org-acme$/),
      expect.objectContaining({
        credentials: "include",
      }),
    );
    expect(fetchAuthContext).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/api\/auth\/invitations\/invitation-1\/revoke$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("accepts invitations and restores the accepted tenant session", async () => {
    fetchAuthContext.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        invitation: {
          id: "invitation-1",
          email: "operator@acme.example",
          organizationId: "org-acme",
          role: "operator",
          status: "accepted",
          inviterId: "user-1",
          expiresAt: "2026-06-02T10:00:00.000Z",
          createdAt: "2026-05-31T10:00:00.000Z",
          workspaceAccess: {
            workspaceId: "workspace-support",
            role: "operator",
          },
          audit: [],
        },
        user: {
          id: "user-operator",
          name: "Operator",
          email: "operator@acme.example",
        },
        activeOrganization: {
          id: "org-acme",
          name: "Acme Voice Ops",
          role: "operator",
        },
        activeWorkspace: {
          id: "workspace-support",
          name: "Support",
        },
      }),
    });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.acceptInvitation({
      invitationId: "invitation-1",
      email: "operator@acme.example",
      password: "password123",
      name: "Operator",
    })).resolves.toEqual({ ok: true });
    expect(fetchAuthContext).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/invitations\/invitation-1\/accept$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "operator@acme.example",
          password: "password123",
          name: "Operator",
        }),
      }),
    );

    sessionSnapshot = {
      data: {
        session: {},
        user: {
          id: "user-operator",
          name: "Operator",
          email: "operator@acme.example",
        },
      },
      error: null,
      isPending: false,
    };

    expect(tenantAuthClient.useSession()).toMatchObject({
      data: {
        user: {
          id: "user-operator",
          email: "operator@acme.example",
        },
        organization: {
          id: "org-acme",
          role: "operator",
        },
      },
      isPending: false,
    });
  });

  it("requests password reset and email verification through the account-security contract", async () => {
    fetchAuthContext
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          delivery: "queued",
          message: "If this email exists in Zara, a password reset link has been sent.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          delivery: "queued",
        }),
      });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.requestPasswordReset({
      email: "ops@acme.example",
      redirectTo: "http://localhost:5173/reset-password",
    })).resolves.toEqual({ ok: true });
    await expect(tenantAuthClient.requestEmailVerification({
      callbackURL: "http://localhost:5173/settings",
    })).resolves.toEqual({ ok: true });

    expect(fetchAuthContext).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/api\/auth\/account-security\/password-reset\/request$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "ops@acme.example",
          redirectTo: "http://localhost:5173/reset-password",
        }),
      }),
    );
    expect(fetchAuthContext).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/api\/auth\/account-security\/email-verification\/request$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          callbackURL: "http://localhost:5173/settings",
        }),
      }),
    );
  });

  it("lists and revokes account sessions through safe session identifiers", async () => {
    fetchAuthContext
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
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
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
        }),
      });
    const { tenantAuthClient } = await import("./index");

    await expect(tenantAuthClient.listSessions()).resolves.toMatchObject({
      ok: true,
      sessions: [
        {
          id: "session-current",
          current: true,
          userAgent: "Primary browser",
        },
        {
          id: "session-other",
          current: false,
          userAgent: "Mobile browser",
        },
      ],
    });
    await expect(tenantAuthClient.revokeSession({
      sessionId: "session-other",
    })).resolves.toEqual({ ok: true });

    expect(fetchAuthContext).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/api\/auth\/account-security\/sessions$/),
      expect.objectContaining({
        credentials: "include",
      }),
    );
    expect(fetchAuthContext).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/api\/auth\/account-security\/sessions\/session-other\/revoke$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("submits reset tokens through Better Auth and clears restored tenant state on sign-out", async () => {
    fetchAuthContext
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          invitation: {
            id: "invitation-1",
            email: "operator@acme.example",
            organizationId: "org-acme",
            role: "operator",
            status: "accepted",
            inviterId: "user-1",
            expiresAt: "2026-06-02T10:00:00.000Z",
            createdAt: "2026-05-31T10:00:00.000Z",
            workspaceAccess: null,
            audit: [],
          },
          user: {
            id: "user-operator",
            name: "Operator",
            email: "operator@acme.example",
          },
          activeOrganization: {
            id: "org-acme",
            name: "Acme Voice Ops",
            role: "operator",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: true,
        }),
      });
    const { tenantAuthClient } = await import("./index");

    await tenantAuthClient.acceptInvitation({
      invitationId: "invitation-1",
      email: "operator@acme.example",
      password: "password123",
      name: "Operator",
    });
    sessionSnapshot = {
      data: null,
      error: null,
      isPending: false,
    };

    expect(tenantAuthClient.useSession()).toMatchObject({
      data: {
        user: {
          id: "user-operator",
        },
      },
    });

    await expect(tenantAuthClient.resetPassword({
      token: "reset-token",
      newPassword: "new-password123",
    })).resolves.toEqual({ ok: true });
    await expect(tenantAuthClient.signOut()).resolves.toEqual({ ok: true });

    expect(fetchAuthContext).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/api\/auth\/reset-password$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          token: "reset-token",
          newPassword: "new-password123",
        }),
      }),
    );
    expect(tenantAuthClient.useSession()).toMatchObject({
      data: null,
      isPending: false,
    });
  });
});
