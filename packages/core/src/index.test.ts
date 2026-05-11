import { describe, expect, it } from "vitest";

import {
  frontendApps,
  platformRoles,
  tenantRoles,
} from "./index";

describe("@zara/core public runtime exports", () => {
  it("defines the tenant roles shared by the product apps", () => {
    expect(tenantRoles).toEqual(["owner", "admin", "builder", "operator", "viewer"]);
  });

  it("defines the platform roles shared by the admin surfaces", () => {
    expect(platformRoles).toEqual([
      "platform_owner",
      "platform_admin",
      "platform_support",
      "platform_readonly",
    ]);
  });

  it("defines the frontend application ids used by the monorepo", () => {
    expect(frontendApps).toEqual(["web", "platform-admin"]);
  });
});
