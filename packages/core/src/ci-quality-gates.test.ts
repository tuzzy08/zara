import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const thisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(thisDirectory, "../../../");

describe("CI quality gates", () => {
  it("exposes lint, typecheck, test, and migration-check scripts at the repo root", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      lint: expect.any(String),
      typecheck: expect.any(String),
      "test:run": expect.any(String),
      "db:check": expect.any(String),
    });
  });

  it("exposes a root script for applying database migrations", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "db:migrate": "drizzle-kit migrate --config drizzle.config.ts",
    });
  });

  it("exposes local startup scripts for the tenant stack at the repo root", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      "dev:api": expect.any(String),
      "dev:web": expect.any(String),
      start: expect.any(String),
      "start:api": expect.any(String),
      "preview:web": expect.any(String),
    });
  });

  it("exposes build and startup scripts in the api workspace", () => {
    const apiPackageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "apps/api/package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(apiPackageJson.scripts).toMatchObject({
      build: expect.any(String),
      dev: expect.any(String),
      start: expect.any(String),
    });
  });

  it("runs all quality gates in the main CI workflow", () => {
    const workflowFile = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    expect(workflowFile).toContain("npm run lint");
    expect(workflowFile).toContain("npm run typecheck");
    expect(workflowFile).toContain("npm run test:run");
    expect(workflowFile).toContain("npm run db:check");
  });

  it("runs runtime evals as a separate CI gate from ordinary tests", () => {
    const workflowFile = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    expect(workflowFile).toContain("name: Runtime eval gate");
    expect(workflowFile).toContain("npm run eval:runtime");
    expect(workflowFile.indexOf("npm run test:run")).toBeLessThan(workflowFile.indexOf("npm run eval:runtime"));
  });

  it("runs PSTN media evals as a separate CI gate from ordinary tests", () => {
    const workflowFile = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["eval:pstn"]).toBe("vitest run --config pstn.vitest.config.ts");
    expect(workflowFile).toContain("name: PSTN eval gate");
    expect(workflowFile).toContain("npm run eval:pstn");
    expect(workflowFile.indexOf("npm run test:run")).toBeLessThan(workflowFile.indexOf("npm run eval:pstn"));
  });

  it("documents the enforced quality gates for contributors", () => {
    const readme = readFileSync(resolve(repositoryRoot, "README.md"), "utf8");

    expect(readme).toContain("## Quality Gates");
    expect(readme).toContain("npm run lint");
    expect(readme).toContain("npm run typecheck");
    expect(readme).toContain("npm run test:run");
    expect(readme).toContain("npm run db:check");
  });
});
