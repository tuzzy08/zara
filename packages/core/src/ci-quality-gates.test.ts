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

  it("runs all quality gates in the main CI workflow", () => {
    const workflowFile = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    expect(workflowFile).toContain("npm run lint");
    expect(workflowFile).toContain("npm run typecheck");
    expect(workflowFile).toContain("npm run test:run");
    expect(workflowFile).toContain("npm run db:check");
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
