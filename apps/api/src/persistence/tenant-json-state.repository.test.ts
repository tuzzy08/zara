import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTenantJsonStateRepository } from "./tenant-json-state.repository";

interface TestTenantState {
  schemaVersion: 1;
  organizationId: string;
  records: string[];
  optionalRecords?: string[] | undefined;
}

let tempDirectory = "";

describe("createTenantJsonStateRepository", () => {
  afterEach(() => {
    if (tempDirectory.length > 0) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = "";
    }
  });

  it("loads, normalizes, saves, and lists tenant JSON snapshots through one adapter", () => {
    const repository = createRepository();

    repository.save({
      schemaVersion: 1,
      organizationId: "tenant-west-africa",
      records: ["published-workflow-v1"],
    });
    repository.save({
      schemaVersion: 1,
      organizationId: "tenant-east-africa",
      records: ["published-workflow-v2"],
      optionalRecords: ["sandbox-run-1"],
    });
    writeFileSync(join(tempDirectory, "tenant-west-africa.corrupt-123.json"), "{}", "utf8");
    writeFileSync(join(tempDirectory, "tenant-east-africa.json.tmp"), "{}", "utf8");

    expect(repository.listOrganizationIds()).toEqual([
      "tenant-east-africa",
      "tenant-west-africa",
    ]);
    expect(repository.load("tenant-west-africa")).toEqual({
      schemaVersion: 1,
      organizationId: "tenant-west-africa",
      records: ["published-workflow-v1"],
      optionalRecords: [],
    });
    expect(readFileSync(join(tempDirectory, "tenant-west-africa.json"), "utf8")).toContain(
      '"records": [',
    );
    expect(existsSync(join(tempDirectory, "tenant-west-africa.json.tmp"))).toBe(false);
  });

  it("quarantines corrupt or invalid tenant snapshots and starts from null", () => {
    const repository = createRepository();

    writeFileSync(join(tempDirectory, "tenant-west-africa.json"), "{\"broken\":", "utf8");

    expect(repository.load("tenant-west-africa")).toBeNull();
    expect(existsSync(join(tempDirectory, "tenant-west-africa.json"))).toBe(false);
    expect(
      readdirSync(tempDirectory).some((fileName) => fileName.startsWith("tenant-west-africa.corrupt-")),
    ).toBe(true);

    writeFileSync(
      join(tempDirectory, "tenant-east-africa.json"),
      JSON.stringify({
        schemaVersion: 1,
        organizationId: "tenant-west-africa",
        records: [],
      }),
      "utf8",
    );

    expect(repository.load("tenant-east-africa")).toBeNull();
    expect(
      readdirSync(tempDirectory).some((fileName) => fileName.startsWith("tenant-east-africa.corrupt-")),
    ).toBe(true);
  });

  it("keeps unsafe tenant identifiers contained inside the state directory by default", () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "zara-tenant-json-state-containment-"));
    const stateDirectory = join(tempDirectory, "state");
    const repository = createTenantJsonStateRepository<TestTenantState>({
      directoryPath: stateDirectory,
      validate: isTestTenantState,
    });

    repository.save({
      schemaVersion: 1,
      organizationId: "../tenant-escape",
      records: ["must-stay-contained"],
    });

    expect(existsSync(join(tempDirectory, "tenant-escape.json"))).toBe(false);
    expect(existsSync(join(stateDirectory, "..%2Ftenant-escape.json"))).toBe(true);
    expect(repository.load("../tenant-escape")).toMatchObject({
      organizationId: "../tenant-escape",
      records: ["must-stay-contained"],
    });
    expect(repository.listOrganizationIds()).toEqual(["../tenant-escape"]);
  });
});

function createRepository() {
  tempDirectory = mkdtempSync(join(tmpdir(), "zara-tenant-json-state-"));

  return createTenantJsonStateRepository<TestTenantState>({
    directoryPath: tempDirectory,
    validate: isTestTenantState,
    normalize: (record) => ({
      ...record,
      optionalRecords: record.optionalRecords ?? [],
    }),
  });
}

function isTestTenantState(value: unknown, organizationId: string): value is TestTenantState {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TestTenantState>;

  return (
    candidate.schemaVersion === 1 &&
    candidate.organizationId === organizationId &&
    Array.isArray(candidate.records) &&
    (candidate.optionalRecords === undefined || Array.isArray(candidate.optionalRecords))
  );
}
