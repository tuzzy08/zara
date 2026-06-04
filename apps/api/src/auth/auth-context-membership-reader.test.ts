import { describe, expect, it, vi } from "vitest";

import { PostgresAuthContextMembershipReader } from "./auth-context-membership-reader";

describe("Postgres auth context membership reader", () => {
  it("loads memberships and active organization from Better Auth tables with one query", async () => {
    const query = vi.fn(async () => ({
      rows: [
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
        {
          organizationId: "org-invalid",
          organizationName: "Invalid Tenant",
          role: "superuser",
        },
      ],
    }));
    const reader = new PostgresAuthContextMembershipReader({ query });

    const context = await reader.readMembershipContext({
      activeOrganizationId: "org-northwind",
      userId: "user-1",
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('from "member"'), ["user-1"]);
    expect(context).toEqual({
      activeOrganization: {
        id: "org-northwind",
        name: "Northwind Support",
        role: "admin",
      },
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
    });
  });
});
