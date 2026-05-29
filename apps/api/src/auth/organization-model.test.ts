import { describe, expect, it, vi } from "vitest";

import { createZaraOrganizationPlugin } from "./organization-model";

describe("Zara organization model", () => {
  it("mirrors created Better Auth organizations into product tenants", async () => {
    const tenantMirror = {
      upsertTenant: vi.fn().mockResolvedValue(undefined),
    };
    const plugin = createZaraOrganizationPlugin({ tenantMirror });

    await plugin.options.organizationHooks.afterCreateOrganization({
      organization: {
        id: "org-acme",
        name: "Acme Voice Ops",
        slug: "acme-voice-ops",
        createdAt: new Date("2026-05-26T10:00:00.000Z"),
      },
      member: {
        id: "member-1",
        userId: "user-1",
        organizationId: "org-acme",
        role: "owner",
        createdAt: new Date("2026-05-26T10:00:00.000Z"),
      },
      user: {
        id: "user-1",
        name: "Acme Owner",
        email: "owner@acme.example",
        emailVerified: false,
        createdAt: new Date("2026-05-26T10:00:00.000Z"),
        updatedAt: new Date("2026-05-26T10:00:00.000Z"),
      },
    });

    expect(tenantMirror.upsertTenant).toHaveBeenCalledWith({
      id: "org-acme",
      name: "Acme Voice Ops",
      slug: "acme-voice-ops",
    });
  });
});
