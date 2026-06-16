import { describe, expect, it } from "vitest";

import {
  archiveWorkspace,
  createWorkspace,
  createWorkspaceAuditEntry,
  createWorkspaceMembership,
  renameWorkspace,
  restoreWorkspace,
  revokeWorkspaceMembership,
  setWorkspaceMembershipRole,
  slugifyWorkspaceName,
  validateWorkspaceAccess,
  validateWorkspaceCreate,
  type Workspace,
} from "./workspace";
import {
  createDefaultWorkspaceSeedState,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  normalizeDefaultWorkspaceSeedState,
} from "./workspace-seed";

describe("workspace domain model", () => {
  it("seeds one default workspace for fresh tenants", () => {
    const seed = createDefaultWorkspaceSeedState({
      tenantId: "tenant-west-africa",
    });

    expect(seed.workspaces).toHaveLength(1);
    expect(seed.workspaces[0]).toMatchObject({
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      tenantId: "tenant-west-africa",
      status: "active",
    });
    expect(seed.workspaces.map((workspace) => workspace.id)).not.toEqual(
      expect.arrayContaining(["workspace-operations", "workspace-support", "workspace-sales"]),
    );
    expect(seed.memberships).toEqual([
      expect.objectContaining({
        workspaceId: DEFAULT_WORKSPACE_ID,
        tenantId: "tenant-west-africa",
        userId: "user-ops-lead",
        role: "owner",
      }),
    ]);
  });

  it("normalizes legacy seed workspaces into the canonical default workspace", () => {
    const legacy = createDefaultWorkspaceSeedState({
      tenantId: "tenant-west-africa",
      legacySeedWorkspaces: true,
    });
    const normalized = normalizeDefaultWorkspaceSeedState({
      ...legacy,
      workspaces: [
        ...legacy.workspaces,
        createWorkspace({
          id: "workspace-customer-success",
          tenantId: "tenant-west-africa",
          name: "Customer Success",
          createdBy: "user-ops-lead",
        }),
      ],
    });

    expect(normalized.workspaces.map((workspace) => workspace.id)).toEqual([
      DEFAULT_WORKSPACE_ID,
      "workspace-customer-success",
    ]);
    expect(normalized.memberships.every((membership) =>
      membership.workspaceId !== "workspace-operations" &&
      membership.workspaceId !== "workspace-support" &&
      membership.workspaceId !== "workspace-sales",
    )).toBe(true);
    expect(normalized.memberships).toContainEqual(expect.objectContaining({
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: "user-support-manager",
      role: "owner",
    }));
    expect(normalized.auditEntries.every((entry) => entry.workspaceId !== "workspace-support")).toBe(true);
  });

  it("creates tenant-owned workspaces with URL-safe slugs", () => {
    const workspace = createWorkspace({
      id: "workspace-support",
      tenantId: "tenant-west-africa",
      name: "Support Operations",
      createdBy: "user-owner",
    });

    expect(workspace).toMatchObject({
      id: "workspace-support",
      tenantId: "tenant-west-africa",
      name: "Support Operations",
      slug: "support-operations",
      status: "active",
      createdBy: "user-owner",
    });
  });

  it("rejects duplicate workspace slugs inside the same tenant but allows the same slug in another tenant", () => {
    const existing: Workspace[] = [
      createWorkspace({
        id: "workspace-support",
        tenantId: "tenant-west-africa",
        name: "Support Operations",
        createdBy: "user-owner",
      }),
    ];

    expect(validateWorkspaceCreate({
      tenantId: "tenant-west-africa",
      name: "Support operations",
      existingWorkspaces: existing,
    })).toEqual({
      ok: false,
      code: "workspace.duplicate_slug",
      message: "Workspace slug 'support-operations' already exists for this tenant.",
    });

    expect(validateWorkspaceCreate({
      tenantId: "tenant-east-africa",
      name: "Support operations",
      existingWorkspaces: existing,
    })).toEqual({ ok: true });
  });

  it("checks workspace membership separately from organization membership", () => {
    const membership = createWorkspaceMembership({
      workspaceId: "workspace-support",
      tenantId: "tenant-west-africa",
      userId: "user-builder",
      role: "builder",
    });

    expect(validateWorkspaceAccess({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      userId: "user-builder",
      memberships: [membership],
      allowedRoles: ["owner", "admin", "builder"],
    })).toEqual({ ok: true, role: "builder" });

    expect(validateWorkspaceAccess({
      tenantId: "tenant-west-africa",
      workspaceId: "workspace-support",
      userId: "user-operator",
      memberships: [membership],
      allowedRoles: ["owner", "admin", "builder"],
    })).toEqual({
      ok: false,
      code: "workspace.missing_membership",
      message: "User 'user-operator' is not a member of workspace 'workspace-support'.",
    });
  });

  it("normalizes names into stable workspace slugs", () => {
    expect(slugifyWorkspaceName("  West Africa / Billing & Support  ")).toBe("west-africa-billing-support");
  });

  it("renames workspaces, archives/restores them, and records audit events", () => {
    const workspace = createWorkspace({
      id: "workspace-support",
      tenantId: "tenant-west-africa",
      name: "Support Operations",
      createdBy: "user-owner",
      createdAt: "2026-05-14T09:00:00.000Z",
    });

    const renamed = renameWorkspace({
      workspaces: [workspace],
      workspaceId: workspace.id,
      tenantId: workspace.tenantId,
      nextName: "Support Command",
    });
    const archived = archiveWorkspace({
      workspaces: renamed,
      workspaceId: workspace.id,
      tenantId: workspace.tenantId,
    });
    const restored = restoreWorkspace({
      workspaces: archived,
      workspaceId: workspace.id,
      tenantId: workspace.tenantId,
    });
    const accessAudit = createWorkspaceAuditEntry({
      id: "audit-1",
      workspaceId: workspace.id,
      tenantId: workspace.tenantId,
      actorUserId: "user-owner",
      action: "workspace.accessed",
      summary: "Opened workspace settings.",
      at: "2026-05-14T09:04:00.000Z",
    });

    expect(renamed[0]).toMatchObject({
      name: "Support Command",
      slug: "support-command",
      status: "active",
    });
    expect(archived[0]?.status).toBe("archived");
    expect(restored[0]?.status).toBe("active");
    expect(accessAudit).toMatchObject({
      action: "workspace.accessed",
      summary: "Opened workspace settings.",
      actorUserId: "user-owner",
    });
  });

  it("prevents archiving a workspace that still has active calls or sandbox sessions", () => {
    const workspace = createWorkspace({
      id: "workspace-support",
      tenantId: "tenant-west-africa",
      name: "Support Operations",
      createdBy: "user-owner",
    });

    expect(() =>
      archiveWorkspace({
        workspaces: [workspace],
        workspaceId: workspace.id,
        tenantId: workspace.tenantId,
        activeSessionCount: 2,
      }),
    ).toThrowError("Workspace 'workspace-support' cannot be archived while 2 active calls or sandbox sessions exist.");
  });

  it("prevents removing or downgrading the final workspace owner", () => {
    const ownerMembership = createWorkspaceMembership({
      workspaceId: "workspace-support",
      tenantId: "tenant-west-africa",
      userId: "user-owner",
      role: "owner",
      createdAt: "2026-05-14T09:00:00.000Z",
    });
    const builderMembership = createWorkspaceMembership({
      workspaceId: "workspace-support",
      tenantId: "tenant-west-africa",
      userId: "user-builder",
      role: "builder",
      createdAt: "2026-05-14T09:01:00.000Z",
    });

    expect(() =>
      setWorkspaceMembershipRole({
        memberships: [ownerMembership, builderMembership],
        workspaceId: "workspace-support",
        tenantId: "tenant-west-africa",
        userId: "user-owner",
        role: "admin",
      }),
    ).toThrowError("Workspace 'workspace-support' must keep at least one owner.");

    expect(() =>
      revokeWorkspaceMembership({
        memberships: [ownerMembership, builderMembership],
        workspaceId: "workspace-support",
        tenantId: "tenant-west-africa",
        userId: "user-owner",
      }),
    ).toThrowError("Workspace 'workspace-support' must keep at least one owner.");
  });
});
