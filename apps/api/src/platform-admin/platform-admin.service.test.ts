import { describe, expect, it, vi } from "vitest";

import { PlatformAdminService } from "./platform-admin.service";

describe("PlatformAdminService PSTN capacity posture", () => {
  it("projects the live recorder snapshot into staff runtime observability", () => {
    const capacity = {
      getSnapshot: () => ({
        capturedAt: "2026-07-22T12:00:00.000Z",
        status: "warning",
        envelope: {
          maxConcurrentCalls: 20,
          cpuLimitMillicores: 1_000,
          memoryLimitBytes: 1_073_741_824,
          fileDescriptorLimit: 4_096,
          databasePoolMax: 10,
          eventLoopDelayLimitMs: 100,
          expectedWebSocketLegsPerPremiumCall: 2,
          certified: false,
        },
      }),
    };
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      capacity as never,
      {} as never,
    );

    expect(service.getRuntimeAiObservability().pstnCapacity).toEqual(capacity.getSnapshot());
  });

  it("persists a tenant-qualified organization status before it returns the update", async () => {
    const updateStatusWithAudit = vi.fn().mockResolvedValue({
      outcome: "updated",
      status: "suspended",
    });
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      { updateStatusWithAudit } as never,
    );

    const result = await service.updateOrganizationStatus(
      {
        actorUserId: "user-platform-admin",
        platformRole: "platform_admin",
        platformAuth: {
          assuranceLevel: "mfa",
          sessionAgeSeconds: 60,
        },
      } as never,
      "tenant-west-africa",
      { status: "suspended", reason: "Abuse review" },
    );

    expect(updateStatusWithAudit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-west-africa",
      status: "suspended",
      audit: expect.objectContaining({
        actorType: "user",
        actorId: "user-platform-admin",
        action: "platform.organization.status_updated",
        targetType: "organization",
        targetId: "tenant-west-africa",
        metadata: expect.objectContaining({
          status: "suspended",
          reason: "Abuse review",
          outcome: "succeeded",
          actorRole: "platform_admin",
        }),
      }),
    }));
    expect(result.organization.status).toBe("suspended");
    expect(result.audit.action).toBe("platform.organization.status_updated");
  });

  it("overlays the durable tenant status in organization list and detail views", async () => {
    const getStatus = vi.fn(async (tenantId: string) => ({
      outcome: "found" as const,
      status: tenantId === "tenant-west-africa" ? "suspended" as const : "active" as const,
    }));
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      { getStatus } as never,
    );

    await expect(service.getOrganization("tenant-west-africa")).resolves.toMatchObject({
      id: "tenant-west-africa",
      status: "suspended",
    });
    await expect(service.listOrganizations()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tenant-west-africa", status: "suspended" }),
    ]));
    expect(getStatus).toHaveBeenCalledWith("tenant-west-africa");
  });

  it.each([
    {
      name: "archived",
      read: async () => ({ outcome: "found" as const, status: "archived" as const }),
    },
    {
      name: "missing",
      read: async () => ({ outcome: "missing" as const }),
    },
    {
      name: "invalid",
      read: async () => ({ outcome: "found" as const, status: "trialing" }),
    },
    {
      name: "repository read failure",
      read: async () => { throw new Error("database unavailable"); },
    },
  ])("fails closed when durable tenant status is $name", async ({ read }) => {
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      {
        getStatus: read,
      } as never,
    );

    await expect(service.getOrganization("tenant-west-africa")).rejects.toThrow();
    await expect(service.listOrganizations()).rejects.toThrow();
  });

  it.each([
    {
      name: "missing tenant",
      update: async () => ({ outcome: "missing" as const }),
      message: "was not found",
    },
    {
      name: "repository failure",
      update: async () => { throw new Error("database unavailable"); },
      message: "database unavailable",
    },
  ])("does not mutate the view or append an audit after $name", async ({ update, message }) => {
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      {
        async getStatus() {
          return { outcome: "found", status: "active" };
        },
        async listAuditLogs() {
          return [];
        },
        updateStatusWithAudit: update,
      } as never,
    );
    const context = {
      actorUserId: "user-platform-admin",
      platformRole: "platform_admin",
      platformAuth: {
        assuranceLevel: "mfa",
        sessionAgeSeconds: 60,
      },
    } as never;

    await expect(service.updateOrganizationStatus(
      context,
      "tenant-west-africa",
      { status: "suspended", reason: "Abuse review" },
    )).rejects.toThrow(message);
    await expect(service.getOrganization("tenant-west-africa")).resolves.toMatchObject({
      status: "active",
    });
    await expect(service.listAuditLogs({
      tenantId: "tenant-west-africa",
      action: "platform.organization.status_updated",
    })).resolves.toEqual([]);
  });

  it("uses unique UUID audit IDs across restarts and concurrent status updates", async () => {
    const auditIds: string[] = [];
    const createService = () => new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      {
        async updateStatusWithAudit(input: { audit: { id: string }; status: "active" | "suspended" }) {
          auditIds.push(input.audit.id);
          return { outcome: "updated" as const, status: input.status };
        },
      } as never,
    );
    const context = {
      actorUserId: "user-platform-admin",
      platformRole: "platform_admin",
      platformAuth: { assuranceLevel: "mfa", sessionAgeSeconds: 60 },
    } as never;

    await Promise.all([
      createService().updateOrganizationStatus(
        context,
        "tenant-west-africa",
        { status: "suspended", reason: "First process" },
      ),
      createService().updateOrganizationStatus(
        context,
        "tenant-west-africa",
        { status: "suspended", reason: "Second process" },
      ),
    ]);
    const concurrentService = createService();
    await Promise.all([
      concurrentService.updateOrganizationStatus(
        context,
        "tenant-west-africa",
        { status: "active", reason: "Concurrent one" },
      ),
      concurrentService.updateOrganizationStatus(
        context,
        "tenant-healthdesk",
        { status: "active", reason: "Concurrent two" },
      ),
    ]);

    expect(new Set(auditIds).size).toBe(4);
    expect(auditIds).toEqual(auditIds.map(() =>
      expect.stringMatching(/^platform_audit_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)));
  });

  it("lists canonical durable status audits after a service restart", async () => {
    const service = new PlatformAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getSnapshot: () => ({}) } as never,
      {
        async listAuditLogs() {
          return [{
            id: "platform_audit_00000000-0000-4000-8000-000000000001",
            tenantId: "tenant-west-africa",
            actorType: "user",
            actorId: "user-platform-admin",
            action: "platform.organization.status_updated",
            targetType: "organization",
            targetId: "tenant-west-africa",
            metadata: {
              actorRole: "platform_admin",
              outcome: "succeeded",
              status: "suspended",
              reason: "Abuse review",
              authAssuranceLevel: "mfa",
              authSessionAgeSeconds: 60,
            },
            occurredAt: "2026-05-24T09:00:00.000Z",
          }];
        },
      } as never,
    );

    await expect(service.listAuditLogs({
      tenantId: "tenant-west-africa",
      action: "platform.organization.status_updated",
    })).resolves.toEqual([{
      id: "platform_audit_00000000-0000-4000-8000-000000000001",
      actorUserId: "user-platform-admin",
      actorRole: "platform_admin",
      tenantId: "tenant-west-africa",
      targetType: "organization",
      targetId: "tenant-west-africa",
      action: "platform.organization.status_updated",
      outcome: "succeeded",
      metadata: {
        status: "suspended",
        reason: "Abuse review",
        authAssuranceLevel: "mfa",
        authSessionAgeSeconds: 60,
      },
      occurredAt: "2026-05-24T09:00:00.000Z",
    }]);
  });
});
