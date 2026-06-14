/* eslint-disable no-console */
import { execSync } from "node:child_process";
import { resolve } from "node:path";

import { runProviderBenchmarks, type ProviderBenchmarkRunInput } from "./provider-benchmarks";

const suite = readSuite(process.argv[2]);
const outputDirectory = resolve(process.cwd(), "artifacts", "benchmarks", suite);

const result = await runProviderBenchmarks({
  suite,
  outputDirectory,
  gitSha: readGitSha(),
});

console.table(result.results.map((entry) => ({
  provider: entry.provider,
  kind: entry.kind,
  scenario: entry.scenarioId,
  status: entry.status,
  firstByteMs: entry.status === "ok" ? entry.timings.firstByteMs ?? "" : "",
  firstAudioMs: entry.status === "ok" ? entry.timings.firstAudioMs ?? "" : "",
  totalMs: entry.status === "ok" ? entry.timings.totalMs ?? "" : "",
  missingEnv: entry.status === "skipped" ? entry.missingEnv.join(",") : "",
})));
console.log(`Benchmark artifact: ${result.artifactPath}`);
console.log(JSON.stringify(result.summary, null, 2));

function readSuite(value: string | undefined): ProviderBenchmarkRunInput["suite"] {
  if (value === "tts" || value === "realtime" || value === "providers") {
    return value;
  }
  return "providers";
}

function readGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
