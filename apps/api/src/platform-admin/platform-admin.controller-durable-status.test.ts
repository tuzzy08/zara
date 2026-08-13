import { describe, expect, it } from "vitest";

import { PlatformAdminController } from "./platform-admin.controller";

describe("PlatformAdminController durable organization status", () => {
  it("awaits durable organization list and detail reads before it builds the response", async () => {
    const controller = new PlatformAdminController({
      async listOrganizations() {
        return [{ id: "tenant-a", status: "suspended" }];
      },
      async getOrganization() {
        return { id: "tenant-a", status: "suspended" };
      },
      async listAuditLogs() {
        return [{ id: "platform_audit_1", tenantId: "tenant-a" }];
      },
    } as never);

    await expect(controller.listOrganizations()).resolves.toEqual({
      organizations: [{ id: "tenant-a", status: "suspended" }],
    });
    await expect(controller.getOrganization("tenant-a")).resolves.toEqual({
      organization: { id: "tenant-a", status: "suspended" },
    });
    await expect(controller.listAuditLogs(undefined, "tenant-a", undefined)).resolves.toEqual({
      auditLogs: [{ id: "platform_audit_1", tenantId: "tenant-a" }],
    });
  });
});
