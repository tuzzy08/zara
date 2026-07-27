import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { CapacityTelemetryClient } from "./capacity-telemetry-client";
import { readLoadCommandConfig } from "./load-config";
import { PstnProtocolLoadDriver } from "./load-driver";
import { type LoadProfileName } from "./load-profiles";
import { writeLoadReport } from "./load-report-writer";
import { PstnLoadRunner } from "./load-runner";
import { OpenAiRealtimeProtocolSimulator } from "./openai-realtime-server";
import { createSmokeCallSid } from "./smoke-identities";
import { formatSmokeFailure } from "./smoke-output";
import { TwilioVirtualCaller } from "./twilio-virtual-caller";

async function main() {
  const profileName = readProfileName(process.argv[2]);
  const config = readLoadCommandConfig(process.env, profileName);
  const simulator = new OpenAiRealtimeProtocolSimulator();
  const runId = randomUUID();
  let callSequence = 0;
  await simulator.start(config.simulator);

  try {
    const telemetry = new CapacityTelemetryClient(config.telemetry);
    const driver = new PstnProtocolLoadDriver({
      tenants: config.tenants,
      simulator,
      caller: new TwilioVirtualCaller(),
      callSidFactory: () => createSmokeCallSid(runId, profileName, callSequence++),
    });
    const runner = new PstnLoadRunner({
      runCall: (input) => driver.runCall(input),
      readTelemetry: () => telemetry.read(),
    });
    const report = await runner.run(config.profile, {
      commitSha: resolveCommitSha(process.env),
      environment: config.environment,
      runtimePath: config.runtimePath,
      provider: config.provider,
    });
    const reportPath = await writeLoadReport(report, config.reportDirectory);
    process.stdout.write(`${JSON.stringify({
      outcome: report.outcome,
      profile: report.profile,
      reportPath,
      attemptedCalls: report.stages.reduce((sum, stage) => sum + stage.attemptedCalls, 0),
      failureCodes: report.failures.map((failure) => failure.code),
    })}\n`);
    if (report.outcome === "failed") process.exitCode = 1;
  } finally {
    await simulator.stop();
  }
}

function readProfileName(value: string | undefined): LoadProfileName {
  if (
    value === "ci-smoke"
    || value === "stepped"
    || value === "burst"
    || value === "failure"
    || value === "soak"
  ) return value;
  throw new Error("PSTN load profile must be one of: ci-smoke, stepped, burst, failure, soak.");
}

function resolveCommitSha(env: NodeJS.ProcessEnv) {
  const configured = env.ZARA_RELEASE_SHA?.trim() || env.GITHUB_SHA?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("PSTN load report requires ZARA_RELEASE_SHA or a Git checkout.");
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${formatSmokeFailure(error)}\n`);
  process.exitCode = 1;
});
