import { readFileSync } from "node:fs";

import type { LoadTenantConfig } from "./load-driver";
import {
  assertLoadProfileApproved,
  createBuiltInLoadProfile,
  loadScenarioNames,
  type LoadProfileName,
  type PstnLoadProfile,
} from "./load-profiles";

export interface LoadCommandConfig {
  environment: "test" | "staging";
  approved: boolean;
  qualifiedTarget: number;
  profile: PstnLoadProfile;
  provider: string;
  runtimePath: string;
  reportDirectory: string;
  simulator: { host: string; port: number; authToken?: string };
  telemetry: {
    endpoint: string;
    bearerToken?: string;
    cookie?: string;
  };
  tenants: LoadTenantConfig[];
}

export function readLoadCommandConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  profileName: LoadProfileName,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): LoadCommandConfig {
  if (env.NODE_ENV !== "test" && env.NODE_ENV !== "staging") {
    throw new Error("PSTN protocol load runs are allowed only in test or staging.");
  }
  if (env.ZARA_PSTN_LOAD_TENANTS_JSON !== undefined) {
    throw new Error("PSTN load credentials must come from an external tenant config file, not inline environment JSON.");
  }
  const qualifiedTarget = readPositiveInteger(env.ZARA_PSTN_LOAD_QUALIFIED_TARGET, 20, "qualified target");
  if (qualifiedTarget > 100) throw new Error("PSTN load qualified target must be at most 100.");
  const approved = env.ZARA_PSTN_LOAD_APPROVED === "true";
  const profile = createBuiltInLoadProfile(profileName, { qualifiedTarget });
  assertLoadProfileApproved(profile, approved);
  const configPath = required(env, "ZARA_PSTN_LOAD_TENANTS_FILE");
  const tenants = parseTenantConfig(readFile(configPath));
  const requiredDestinations = new Set(profile.stages.flatMap((stage) => stage.scenarios)
    .filter((scenario) =>
      scenario === "tool-call"
      || scenario === "same-provider-handoff"
      || scenario === "cross-provider-handoff"
      || scenario === "exporter-failure"));
  for (const scenario of requiredDestinations) {
    if (tenants[0]!.destinations[scenario] === undefined) {
      throw new Error(`PSTN load profile '${profile.name}' requires a '${scenario}' destination.`);
    }
  }
  if (profile.stages.some((stage) => stage.tenantMode === "cross-tenant") && tenants.length < 2) {
    throw new Error("Cross-tenant PSTN load requires at least two tenant routes.");
  }
  const endpoint = required(env, "ZARA_PSTN_LOAD_TELEMETRY_URL");
  requireHttpsUrl(endpoint, "capacity telemetry");
  const simulatorPort = readPositiveInteger(env.ZARA_PSTN_LOAD_SIMULATOR_PORT, 4_319, "simulator port");
  if (simulatorPort > 65_535) throw new Error("PSTN load simulator port must be at most 65535.");
  const simulatorAuthToken = optional(env.ZARA_PREMIUM_REALTIME_SIMULATOR_TOKEN);
  const telemetryBearerToken = optional(env.ZARA_PSTN_LOAD_TELEMETRY_BEARER_TOKEN);
  const telemetryCookie = optional(env.ZARA_PSTN_LOAD_TELEMETRY_COOKIE);
  return {
    environment: env.NODE_ENV,
    approved,
    qualifiedTarget,
    profile,
    provider: readBoundedIdentifier(env.ZARA_PSTN_LOAD_PROVIDER, "openai-realtime", "provider"),
    runtimePath: readBoundedIdentifier(
      env.ZARA_PSTN_LOAD_RUNTIME_PATH,
      "pstn-premium-realtime",
      "runtime path",
    ),
    reportDirectory: env.ZARA_PSTN_LOAD_REPORT_DIR?.trim() || "artifacts/pstn-load",
    simulator: {
      host: env.ZARA_PSTN_LOAD_SIMULATOR_HOST?.trim() || "127.0.0.1",
      port: simulatorPort,
      ...(simulatorAuthToken === undefined ? {} : { authToken: simulatorAuthToken }),
    },
    telemetry: {
      endpoint,
      ...(telemetryBearerToken === undefined ? {} : { bearerToken: telemetryBearerToken }),
      ...(telemetryCookie === undefined ? {} : { cookie: telemetryCookie }),
    },
    tenants,
  };
}

function parseTenantConfig(raw: string): LoadTenantConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PSTN load tenant config file is not valid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tenants) || parsed.tenants.length === 0) {
    throw new Error("PSTN load tenant config file must contain a non-empty tenants array.");
  }
  return parsed.tenants.map((value, index) => parseTenant(value, index));
}

function parseTenant(value: unknown, index: number): LoadTenantConfig {
  if (!isRecord(value) || !isRecord(value.destinations)) {
    throw new Error(`PSTN load tenant ${index + 1} is invalid.`);
  }
  const destinations = Object.fromEntries(Object.entries(value.destinations).map(([key, destination]) => {
    if (key !== "default" && !loadScenarioNames.includes(key as (typeof loadScenarioNames)[number])) {
      throw new Error(`PSTN load tenant ${index + 1} has an unknown destination '${key}'.`);
    }
    if (typeof destination !== "string" || destination.trim().length === 0) {
      throw new Error(`PSTN load tenant ${index + 1} has an invalid '${key}' destination.`);
    }
    return [key, destination.trim()];
  })) as LoadTenantConfig["destinations"];
  if (destinations.default === undefined) {
    throw new Error(`PSTN load tenant ${index + 1} requires a default destination.`);
  }
  const webhookUrl = readTenantString(value, "webhookUrl", index);
  requireHttpsUrl(webhookUrl, `tenant ${index + 1} webhook`);
  return {
    accountSid: readTenantString(value, "accountSid", index),
    authToken: readTenantString(value, "authToken", index),
    from: readTenantString(value, "from", index),
    webhookUrl,
    destinations,
  };
}

function readTenantString(value: Record<string, unknown>, key: string, index: number) {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`PSTN load tenant ${index + 1} requires '${key}'.`);
  }
  return candidate.trim();
}

function requireHttpsUrl(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`PSTN load ${label} URL must use HTTPS.`);
}

function required(env: Record<string, string | undefined>, name: string) {
  const value = optional(env[name]);
  if (value === undefined) throw new Error(`Missing required PSTN load variable: ${name}.`);
  return value;
}

function optional(value: string | undefined) {
  const candidate = value?.trim();
  return candidate === undefined || candidate.length === 0 ? undefined : candidate;
}

function readPositiveInteger(value: string | undefined, fallback: number, label: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`PSTN load ${label} must be a positive integer.`);
  return parsed;
}

function readBoundedIdentifier(value: string | undefined, fallback: string, label: string) {
  const candidate = optional(value) ?? fallback;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(candidate)) {
    throw new Error(`PSTN load ${label} must be a bounded identifier.`);
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
