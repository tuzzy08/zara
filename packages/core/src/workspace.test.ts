import { describe, expect, it } from "vitest";

import {
  createWorkspace,
  createWorkspaceMembership,
  slugifyWorkspaceName,
  validateWorkspaceAccess,
  validateWorkspaceCreate,
  type Workspace,
} from "./workspace";

describe("workspace domain model", () => {
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
});
