import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const repositoryRoot = resolve(import.meta.dirname, "..");

validatePlatformAdminDeployment();
validateMarkdownLinks();
validateTelephonyPersistenceBoundary();
validateContainerModel();
if (!process.env.npm_execpath) throw new Error("validate:contracts must run through npm.");
run(process.execPath, [process.env.npm_execpath, "run", "build"]);

console.log("Repository contracts validated.");

function validatePlatformAdminDeployment() {
  const appRoot = resolve(repositoryRoot, "apps/platform-admin");
  const env = parseEnvExample(resolve(appRoot, ".env.example"));
  const config = JSON.parse(readFileSync(resolve(appRoot, "vercel.json"), "utf8"));
  const headers = new Set(
    config.headers?.flatMap((entry) => entry.headers?.map((header) => header.key) ?? []) ?? [],
  );

  for (const key of ["VITE_API_BASE_URL", "VITE_AUTH_BASE_URL", "VITE_PLATFORM_ADMIN_ORIGIN"]) {
    if (!env.has(key)) throw new Error(`apps/platform-admin/.env.example is missing ${key}.`);
  }
  new URL(env.get("VITE_PLATFORM_ADMIN_ORIGIN"));

  for (const key of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "Referrer-Policy",
    "X-Content-Type-Options",
  ]) {
    if (!headers.has(key)) throw new Error(`apps/platform-admin/vercel.json is missing ${key}.`);
  }
}

function validateMarkdownLinks() {
  const tracked = run("git", ["ls-files", "*.md"], { capture: true })
    .split(/\r?\n/u)
    .filter(Boolean);
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/gu;

  for (const file of tracked) {
    const source = readFileSync(resolve(repositoryRoot, file), "utf8");
    for (const match of source.matchAll(linkPattern)) {
      const rawTarget = match[1].trim().replace(/^<|>$/gu, "");
      if (
        rawTarget.startsWith("#")
        || rawTarget.startsWith("/")
        || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)
      ) {
        continue;
      }
      const target = decodeURIComponent(rawTarget.split("#", 1)[0]);
      if (target.length === 0) continue;
      const absoluteTarget = resolve(repositoryRoot, dirname(file), target);
      if (!existsSync(absoluteTarget)) {
        throw new Error(`${file} links to missing local target: ${rawTarget}`);
      }
    }
  }
}

function validateTelephonyPersistenceBoundary() {
  const servicePath = resolve(
    repositoryRoot,
    "apps/api/src/telephony/telephony.service.ts",
  );
  const modelsPath = resolve(
    repositoryRoot,
    "apps/api/src/telephony/telephony.models.ts",
  );
  const sourceFiles = [servicePath, modelsPath].map((path) =>
    ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    ),
  );
  const forbiddenIdentifiers = new Set([
    "mediaStreamTokens",
    "processedWebhookEventIds",
    "persistenceByOrganizationId",
    "persistState",
  ]);
  const liveCallMethods = new Set([
    "dispatchInboundCall",
    "dispatchOutboundCall",
    "runConnectionTestCall",
    "authorizeTwilioMediaStream",
    "recordTwilioMediaStreamLifecycle",
    "recordPstnPhoneTestCheckpoint",
    "recordPstnCallLifecycle",
    "transitionPstnCallLifecycle",
    "recordCallControlEvent",
    "applyCallRuntimePolicy",
    "resolveHumanFallback",
    "handleTwilioWebhook",
    "handleTwilioStatusCallback",
  ]);
  const offenders = [];

  for (const sourceFile of sourceFiles) {
    walk(sourceFile);
    function walk(node, currentMethod) {
      const methodName =
        ts.isMethodDeclaration(node) && node.name
          ? node.name.getText(sourceFile)
          : currentMethod;
      if (
        ts.isIdentifier(node)
        && forbiddenIdentifiers.has(node.text)
      ) {
        offenders.push(`${sourceFile.fileName}:${node.text}`);
      }
      if (
        methodName
        && liveCallMethods.has(methodName)
        && ts.isCallExpression(node)
      ) {
        const target = node.expression.getText(sourceFile);
        if (target === "this.stateRepository.save") {
          offenders.push(`${methodName}:${target}`);
        }
      }
      ts.forEachChild(node, (child) => walk(child, methodName));
    }
  }

  if (offenders.length > 0) {
    throw new Error(`Telephony persistence boundary violations:\n${offenders.join("\n")}`);
  }
}

function validateContainerModel() {
  const compose = JSON.parse(
    run(
      "docker",
      [
        "compose",
        "-f",
        "compose.coolify.yml",
        "config",
        "--no-interpolate",
        "--format",
        "json",
      ],
      { capture: true },
    ),
  );
  const services = compose.services ?? {};

  requireService(services, "postgres", { healthcheck: true });
  requireService(services, "redis", { healthcheck: true });
  requireService(services, "migrate", {
    buildTarget: "api",
    command: ["npm", "run", "db:migrate"],
  });
  requireService(services, "api", {
    buildTarget: "api",
    healthcheck: true,
    dependencies: {
      migrate: "service_completed_successfully",
      postgres: "service_healthy",
      redis: "service_healthy",
    },
    volume: "api-state:/app/.zara:rw",
  });
  requireService(services, "realtime-worker", {
    buildTarget: "realtime-worker",
    healthcheck: true,
    dependencies: {
      migrate: "service_completed_successfully",
      postgres: "service_healthy",
      redis: "service_healthy",
    },
    volume: "api-state:/app/.zara:ro",
  });
  requireService(services, "web", { buildTarget: "web", healthcheck: true });
  requireService(services, "platform-admin", {
    buildTarget: "platform-admin",
    healthcheck: true,
  });

  if (!compose.volumes?.["api-state"] || !compose.volumes?.["redis-data"]) {
    throw new Error("compose.coolify.yml is missing required persistent volumes.");
  }
}

function requireService(services, name, contract) {
  const service = services[name];
  if (!service) throw new Error(`compose.coolify.yml is missing the ${name} service.`);
  if (contract.buildTarget && service.build?.target !== contract.buildTarget) {
    throw new Error(`${name} must build the ${contract.buildTarget} Docker target.`);
  }
  if (contract.healthcheck && !service.healthcheck?.test) {
    throw new Error(`${name} must define a healthcheck.`);
  }
  if (contract.command && JSON.stringify(service.command) !== JSON.stringify(contract.command)) {
    throw new Error(`${name} has an unexpected command.`);
  }
  for (const [dependency, condition] of Object.entries(contract.dependencies ?? {})) {
    if (service.depends_on?.[dependency]?.condition !== condition) {
      throw new Error(`${name} must wait for ${dependency} with ${condition}.`);
    }
  }
  if (
    contract.volume
    && !(service.volumes ?? []).some(
      ({ source, target, read_only: readOnly }) =>
        `${source}:${target}:${readOnly ? "ro" : "rw"}` === contract.volume,
    )
  ) {
    throw new Error(`${name} must mount ${contract.volume}.`);
  }
}

function parseEnvExample(path) {
  const entries = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) throw new Error(`${path} contains an invalid environment entry.`);
    entries.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return entries;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} ${args.join(" ")} failed.`);
  }
  return result.stdout ?? "";
}
