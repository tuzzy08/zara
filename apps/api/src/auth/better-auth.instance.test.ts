import { describe, expect, it } from "vitest";

import { resolveAuthDatabaseMode } from "./better-auth.instance";

describe("Better Auth database selection", () => {
  it("uses durable Postgres for local development when DATABASE_URL is configured", () => {
    expect(
      resolveAuthDatabaseMode({
        NODE_ENV: "development",
        ZARA_ENV: "local",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/zara",
      }),
    ).toBe("postgres");
  });

  it("defaults non-test environments to durable Postgres instead of memory", () => {
    expect(resolveAuthDatabaseMode({ NODE_ENV: "development", ZARA_ENV: "local" })).toBe("postgres");
    expect(resolveAuthDatabaseMode({ NODE_ENV: "production" })).toBe("postgres");
  });

  it("keeps memory auth available only for tests", () => {
    expect(resolveAuthDatabaseMode({ NODE_ENV: "test", ZARA_ENV: "local" })).toBe("memory");
    expect(() => resolveAuthDatabaseMode({ NODE_ENV: "development", ZARA_AUTH_DATABASE: "memory" })).toThrow(
      /only allowed during tests/i,
    );
  });
});
