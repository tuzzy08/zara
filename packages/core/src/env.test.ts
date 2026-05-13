import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigError,
  loadEnvironmentConfig,
  redactEnvironmentForLogs,
} from "./index";

const validEnvironment = {
  NODE_ENV: "test",
  ZARA_ENV: "local",
  DATABASE_URL: "postgresql://zara:zara@localhost:5432/zara",
  BETTER_AUTH_SECRET: "12345678901234567890123456789012",
  BETTER_AUTH_URL: "http://localhost:3000",
  LOG_LEVEL: "debug",
  PORT: "4010",
} as const;

describe("environment config", () => {
  it("validates required values and normalizes defaults", () => {
    const env = loadEnvironmentConfig(validEnvironment);

    expect(env).toEqual({
      nodeEnv: "test",
      appEnv: "local",
      databaseUrl: "postgresql://zara:zara@localhost:5432/zara",
      betterAuthSecret: "12345678901234567890123456789012",
      betterAuthUrl: "http://localhost:3000",
      logLevel: "debug",
      port: 4010,
    });
  });

  it("reports invalid keys without echoing secret values", () => {
    const leakedSecret = "too-short-secret";

    let thrownError: unknown;

    try {
      loadEnvironmentConfig({
        ...validEnvironment,
        BETTER_AUTH_SECRET: leakedSecret,
        BETTER_AUTH_URL: "not-a-url",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(EnvironmentConfigError);
    expect((thrownError as EnvironmentConfigError).issues).toEqual([
      "BETTER_AUTH_SECRET: must be at least 32 characters",
      "BETTER_AUTH_URL: must be a valid URL",
    ]);
    expect((thrownError as Error).message).toContain("BETTER_AUTH_SECRET");
    expect((thrownError as Error).message).toContain("BETTER_AUTH_URL");
    expect((thrownError as Error).message).not.toContain(leakedSecret);
  });

  it("redacts secrets before environment details are logged", () => {
    const env = loadEnvironmentConfig(validEnvironment);

    expect(redactEnvironmentForLogs(env)).toEqual({
      nodeEnv: "test",
      appEnv: "local",
      databaseUrl: "[redacted]",
      betterAuthSecret: "[redacted]",
      betterAuthUrl: "http://localhost:3000",
      logLevel: "debug",
      port: 4010,
    });
  });
});
