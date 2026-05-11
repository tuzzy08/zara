import { beforeEach, describe, expect, it } from "vitest";

import type { ZaraOrganizationSession } from "../organization-model";
import { OrganizationAccessService } from "./organization-access.service";

describe("OrganizationAccessService", () => {
  let service: OrganizationAccessService;

  beforeEach(() => {
    service = new OrganizationAccessService();
  });

  it("tracks the organizations a signed-in user belongs to", () => {
    const session = buildSession({
      activeOrganizationId: "org_support",
      memberships: [
        { organizationId: "org_support", role: "builder" },
        { organizationId: "org_ops", role: "viewer" },
      ],
    });

    expect(service.listOrganizationIds(session)).toEqual(["org_support", "org_ops"]);
    expect(service.getActiveMembership(session)).toEqual({
      organizationId: "org_support",
      role: "builder",
    });
  });

  it("gates organization resources with Better Auth role definitions", () => {
    const builderSession = buildSession({
      activeOrganizationId: "org_support",
      memberships: [{ organizationId: "org_support", role: "builder" }],
    });
    const viewerSession = buildSession({
      activeOrganizationId: "org_support",
      memberships: [{ organizationId: "org_support", role: "viewer" }],
    });

    expect(
      service.canAccessOrganizationResource(builderSession, {
        organizationId: "org_support",
        permissions: { workflow: ["write", "publish"] },
      }),
    ).toBe(true);
    expect(
      service.canAccessOrganizationResource(viewerSession, {
        organizationId: "org_support",
        permissions: { workflow: ["publish"] },
      }),
    ).toBe(false);
  });

  it("rejects sessions that try to cross tenant boundaries", () => {
    const session = buildSession({
      activeOrganizationId: "org_alpha",
      memberships: [
        { organizationId: "org_alpha", role: "admin" },
        { organizationId: "org_beta", role: "viewer" },
      ],
    });

    expect(() =>
      service.assertCanAccessOrganizationResource(session, {
        organizationId: "org_beta",
        permissions: { workflow: ["read"] },
      }),
    ).toThrowError("Active organization does not match the requested organization");
  });

  it("rejects stale sessions when the active organization membership is gone", () => {
    const session = buildSession({
      activeOrganizationId: "org_removed",
      memberships: [{ organizationId: "org_alpha", role: "admin" }],
    });

    expect(() => service.getActiveMembership(session)).toThrowError(
      "Active organization membership is missing from the session",
    );
  });
});

function buildSession(
  overrides: Partial<ZaraOrganizationSession> = {},
): ZaraOrganizationSession {
  return {
    userId: "user_01",
    activeOrganizationId: "org_support",
    memberships: [{ organizationId: "org_support", role: "admin" }],
    ...overrides,
  };
}
