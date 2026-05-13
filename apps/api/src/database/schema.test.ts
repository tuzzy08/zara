import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { drizzleConfigValues } from "./drizzle-config";
import { auditLogs, tenants } from "./schema";

const thisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(thisDirectory, "../../../../");

describe("database foundations", () => {
  it("defines tenant and audit tables in the initial schema", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(Object.keys(getTableColumns(tenants))).toEqual([
      "id",
      "slug",
      "name",
      "status",
      "defaultLocale",
      "createdAt",
      "updatedAt",
    ]);

    expect(getTableName(auditLogs)).toBe("audit_logs");
    expect(Object.keys(getTableColumns(auditLogs))).toEqual([
      "id",
      "tenantId",
      "actorType",
      "actorId",
      "action",
      "targetType",
      "targetId",
      "metadata",
      "occurredAt",
    ]);
  });

  it("configures drizzle-kit for postgres migrations", () => {
    expect(drizzleConfigValues).toMatchObject({
      dialect: "postgresql",
      schema: "./apps/api/src/database/schema.ts",
      out: "./apps/api/src/database/migrations",
    });
  });

  it("runs migration checks in CI", () => {
    const workflowFile = readFileSync(
      resolve(repositoryRoot, ".github/workflows/migration-check.yml"),
      "utf8",
    );

    expect(workflowFile).toContain("npm run db:check");
  });
});
