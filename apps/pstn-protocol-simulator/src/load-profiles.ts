export const loadScenarioNames = [
  "normal",
  "delayed-provider-readiness",
  "twilio-marks",
  "interruption-clear",
  "tool-call",
  "same-provider-handoff",
  "cross-provider-handoff",
  "long-audio-output",
  "provider-quota-error",
  "provider-closure",
  "exporter-failure",
] as const;

export type LoadScenarioName = (typeof loadScenarioNames)[number];
export type LoadProfileName = "ci-smoke" | "stepped" | "burst" | "failure" | "soak";
export type LoadTenantMode = "same-tenant" | "cross-tenant";

export interface PstnLoadStage {
  name: string;
  concurrency: number;
  callCount?: number | undefined;
  durationMs?: number | undefined;
  arrivalRatePerSecond: number;
  tenantMode: LoadTenantMode;
  scenarios: LoadScenarioName[];
  verifyDrain: boolean;
}

export interface PstnLoadProfile {
  name: LoadProfileName;
  releaseScale: boolean;
  stages: PstnLoadStage[];
}

const stepCurve = [1, 5, 10, 20, 40, 60, 100] as const;
const failureScenarios: LoadScenarioName[] = [
  "delayed-provider-readiness",
  "twilio-marks",
  "interruption-clear",
  "tool-call",
  "same-provider-handoff",
  "cross-provider-handoff",
  "long-audio-output",
  "provider-quota-error",
  "provider-closure",
  "exporter-failure",
];

export function createBuiltInLoadProfile(
  name: LoadProfileName,
  options: { qualifiedTarget?: number } = {},
): PstnLoadProfile {
  const qualifiedTarget = positiveInteger(options.qualifiedTarget ?? 20, "qualifiedTarget");
  if (name === "ci-smoke") {
    return {
      name,
      releaseScale: false,
      stages: [stage({
        name: "deterministic-smoke",
        concurrency: 1,
        callCount: 4,
        arrivalRatePerSecond: 2,
        scenarios: ["normal", "interruption-clear", "tool-call", "provider-closure"],
      })],
    };
  }
  if (name === "stepped") {
    return {
      name,
      releaseScale: true,
      stages: stepCurve.map((concurrency) => stage({
        name: `step-${concurrency}`,
        concurrency,
        callCount: Math.max(concurrency * 2, loadScenarioNames.length),
        arrivalRatePerSecond: Math.max(20, concurrency * 20),
        scenarios: [...loadScenarioNames],
      })),
    };
  }
  if (name === "burst") {
    return {
      name,
      releaseScale: true,
      stages: ["same-tenant", "cross-tenant"].map((tenantMode) => stage({
        name: `${tenantMode}-burst`,
        concurrency: qualifiedTarget,
        callCount: qualifiedTarget * 3,
        arrivalRatePerSecond: qualifiedTarget * 20,
        tenantMode: tenantMode as LoadTenantMode,
        scenarios: ["normal", "twilio-marks", "interruption-clear"],
      })),
    };
  }
  if (name === "failure") {
    return {
      name,
      releaseScale: true,
      stages: [stage({
        name: "failure-matrix",
        concurrency: qualifiedTarget,
        callCount: Math.max(qualifiedTarget * 2, failureScenarios.length),
        arrivalRatePerSecond: qualifiedTarget * 20,
        scenarios: failureScenarios,
      })],
    };
  }
  return {
    name,
    releaseScale: true,
    stages: [stage({
      name: "two-hour-soak",
      concurrency: qualifiedTarget,
      durationMs: 2 * 60 * 60 * 1_000,
      arrivalRatePerSecond: qualifiedTarget * 20,
      scenarios: ["normal", "twilio-marks", "interruption-clear", "tool-call"],
    })],
  };
}

export function assertLoadProfileApproved(profile: PstnLoadProfile, approved: boolean) {
  if (profile.releaseScale && !approved) {
    throw new Error(
      `PSTN load profile '${profile.name}' is release-scale. Set ZARA_PSTN_LOAD_APPROVED=true after operator approval.`,
    );
  }
}

function stage(input: Omit<PstnLoadStage, "tenantMode" | "verifyDrain"> & {
  tenantMode?: LoadTenantMode;
}): PstnLoadStage {
  return {
    ...input,
    tenantMode: input.tenantMode ?? "same-tenant",
    verifyDrain: true,
  };
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
