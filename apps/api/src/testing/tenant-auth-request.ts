import type { INestApplication } from "@nestjs/common";
import type request from "supertest";

export function withTestTenantAuth(
  test: request.Test,
  input: {
    organizationId?: string | undefined;
    role?: "owner" | "admin" | "builder" | "operator" | "viewer" | undefined;
    userId?: string | undefined;
  } = {},
) {
  return test
    .set("x-zara-test-organization-id", input.organizationId ?? "tenant-west-africa")
    .set("x-zara-test-tenant-role", input.role ?? "admin")
    .set("x-zara-test-user-id", input.userId ?? "user-ops-lead");
}

export function installTestTenantAuth(app: INestApplication) {
  app.use((request: { headers: Record<string, string | undefined>; path?: string; url?: string }, _response: unknown, next: () => void) => {
    const requestPath = request.path ?? request.url ?? "";
    const organizationId = /^\/organizations\/([^/]+)/.exec(requestPath)?.[1];

    if (organizationId !== undefined) {
      request.headers["x-zara-test-organization-id"] ??= decodeURIComponent(organizationId);
      request.headers["x-zara-test-tenant-role"] ??= "admin";
      request.headers["x-zara-test-user-id"] ??= "user-ops-lead";
    }

    next();
  });
}
