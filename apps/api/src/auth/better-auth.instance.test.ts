import { describe, expect, it } from "vitest";

import { resolveAuthDatabaseMode, resolveAuthRuntimeSecurity } from "./better-auth.instance";

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

describe("Better Auth runtime security", () => {
  it("requires a real auth secret outside tests", () => {
    expect(() => resolveAuthRuntimeSecurity({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "short",
      ZARA_AUTH_EMAIL_WEBHOOK_URL: "https://email.zara.test/send",
    })).toThrow(/BETTER_AUTH_SECRET/i);
  });

  it("requires auth email delivery in production", () => {
    expect(() => resolveAuthRuntimeSecurity({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
    })).toThrow(/ZARA_AUTH_EMAIL_WEBHOOK_URL/i);
  });

  it("enables production rate limiting, secure cookies, and proxy-aware headers", () => {
    expect(resolveAuthRuntimeSecurity({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
      ZARA_AUTH_EMAIL_WEBHOOK_URL: "https://email.zara.test/send",
    })).toMatchObject({
      advanced: {
        useSecureCookies: true,
        trustedProxyHeaders: true,
      },
      emailVerification: {
        expiresIn: 3600,
        sendOnSignUp: false,
        sendOnSignIn: false,
      },
      emailAndPassword: {
        resetPasswordTokenExpiresIn: 3600,
        revokeSessionsOnPasswordReset: true,
      },
      rateLimit: {
        enabled: true,
        max: 300,
        storage: "database",
        window: 60,
      },
    });
  });
});
