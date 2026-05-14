export const nodeEnvironments = ["development", "test", "staging", "production"] as const;
export type NodeEnvironment = (typeof nodeEnvironments)[number];

export const appEnvironments = ["local", "staging", "production"] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

export const logLevels = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

export interface EnvironmentConfig {
  nodeEnv: NodeEnvironment;
  appEnv: AppEnvironment;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  logLevel: LogLevel;
  port: number;
}

export class EnvironmentConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration: ${issues.join("; ")}`);
    this.name = "EnvironmentConfigError";
  }
}

export function loadEnvironmentConfig(source: Record<string, string | undefined>): EnvironmentConfig {
  const issues: string[] = [];

  const nodeEnv = readEnum(source.NODE_ENV, "NODE_ENV", nodeEnvironments, issues);
  const appEnv = readEnum(source.ZARA_ENV, "ZARA_ENV", appEnvironments, issues);
  const databaseUrl = readUrl(source.DATABASE_URL, "DATABASE_URL", issues);
  const betterAuthSecret = readSecret(source.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET", issues);
  const betterAuthUrl = readUrl(source.BETTER_AUTH_URL, "BETTER_AUTH_URL", issues);
  const logLevel = readOptionalEnum(source.LOG_LEVEL, "LOG_LEVEL", logLevels, "info", issues);
  const port = readPort(source.PORT, issues);

  if (issues.length > 0) {
    throw new EnvironmentConfigError(issues);
  }

  return {
    nodeEnv,
    appEnv,
    databaseUrl,
    betterAuthSecret,
    betterAuthUrl,
    logLevel,
    port,
  };
}

export function redactEnvironmentForLogs(env: EnvironmentConfig) {
  return {
    nodeEnv: env.nodeEnv,
    appEnv: env.appEnv,
    databaseUrl: "[redacted]",
    betterAuthSecret: "[redacted]",
    betterAuthUrl: env.betterAuthUrl,
    logLevel: env.logLevel,
    port: env.port,
  };
}

function readEnum<TValue extends string>(
  value: string | undefined,
  key: string,
  allowedValues: readonly TValue[],
  issues: string[],
): TValue {
  const fallbackValue = allowedValues[0]!;

  if (!value) {
    issues.push(`${key}: is required`);
    return fallbackValue;
  }

  if (allowedValues.includes(value as TValue)) {
    return value as TValue;
  }

  issues.push(`${key}: must be one of ${allowedValues.join(", ")}`);
  return fallbackValue;
}

function readOptionalEnum<TValue extends string>(
  value: string | undefined,
  key: string,
  allowedValues: readonly TValue[],
  fallbackValue: TValue,
  issues: string[],
): TValue {
  if (!value) {
    return fallbackValue;
  }

  if (allowedValues.includes(value as TValue)) {
    return value as TValue;
  }

  issues.push(`${key}: must be one of ${allowedValues.join(", ")}`);
  return fallbackValue;
}

function readUrl(value: string | undefined, key: string, issues: string[]): string {
  if (!value) {
    issues.push(`${key}: is required`);
    return "";
  }

  try {
    new URL(value);
    return value;
  } catch {
    issues.push(`${key}: must be a valid URL`);
    return "";
  }
}

function readSecret(value: string | undefined, key: string, issues: string[]): string {
  if (!value) {
    issues.push(`${key}: is required`);
    return "";
  }

  if (value.length < 32) {
    issues.push(`${key}: must be at least 32 characters`);
  }

  return value;
}

function readPort(value: string | undefined, issues: string[]): number {
  if (!value) {
    return 4010;
  }

  const parsedPort = Number.parseInt(value, 10);

  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    return parsedPort;
  }

  issues.push("PORT: must be a valid TCP port");
  return 4010;
}
