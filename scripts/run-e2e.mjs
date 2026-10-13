import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { request } from "node:https";
import { setTimeout } from "node:timers/promises";

const project = `zara-e2e-${process.pid}-${Date.now()}`;
const artifact = `artifacts/e2e/${project}`;
mkdirSync(artifact, { recursive: true });
const compose = ["compose", "--env-file", "tests/e2e/compose.env", "-p", project, "-f", "tests/e2e/compose.yml"];
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { stdio: capture ? "pipe" : "inherit", encoding: "utf8", env: { ...process.env, E2E_ARTIFACT_DIR: artifact } });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.stderr ?? result.status}`);
  return result.stdout;
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
writeFileSync(`${artifact}/run.json`, JSON.stringify({
  project, command: "npm ci && npx playwright install chromium && npm run test:e2e",
  commit: run("git", ["rev-parse", "HEAD"], true).trim(),
  diffHash: hash(run("git", ["diff", "HEAD"], true)),
  lockHash: hash(readFileSync("package-lock.json")),
  inputHashes: Object.fromEntries(["playwright.config.ts", "tests/e2e/signup-isolation.spec.ts", "tests/e2e/signup-load.spec.ts", "tests/e2e/compose.yml", "tests/e2e/Caddyfile", "tests/e2e/mail.mjs", "scripts/run-e2e.mjs"].map((path) => [path, hash(readFileSync(path))])),
  startedAt: new Date().toISOString(),
  target: "https://127.0.0.1:8443", data: "disposable", billingDelivery: false,
}, null, 2));
const healthy = () => new Promise((resolve) => {
  const req = request("https://127.0.0.1:8443/health", { rejectUnauthorized: false, timeout: 2000 }, (res) => {
    res.resume(); resolve(res.statusCode === 200);
  });
  req.on("error", () => resolve(false));
  req.on("timeout", () => req.destroy());
  req.end();
});
try {
  run("docker", [...compose, "up", "--build", "-d"]);
  writeFileSync(`${artifact}/images.json`, run("docker", [...compose, "images", "--format", "json"], true));
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await healthy()) { ready = true; break; }
    await setTimeout(1000);
  }
  if (!ready) throw new Error("Isolated API did not become ready");
  run(process.execPath, ["node_modules/@playwright/test/cli.js", "test"]);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  const logs = spawnSync("docker", [...compose, "logs", "--no-color"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(`${artifact}/services.log`, logs.stdout ?? "");
  const result = spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
  if (result.status !== 0) process.exitCode = 1;
  writeFileSync(`${artifact}/outcome.json`, JSON.stringify({ finishedAt: new Date().toISOString(), exitCode: process.exitCode ?? 0, cleanupExitCode: result.status }, null, 2));
}
