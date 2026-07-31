import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const thisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(thisDirectory, "../../../");

type TestConfig = {
  test?: {
    environment?: string;
    include?: string[];
  };
};

function selectTrackedFiles(
  config: TestConfig,
  trackedFiles: Set<string>,
): string[] {
  return (config.test?.include ?? [])
    .flatMap((pattern) =>
      globSync(pattern, {
        cwd: repositoryRoot,
      }),
    )
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => trackedFiles.has(file))
    .sort();
}

describe("ordinary test layers", () => {
  it("exposes disjoint unit, API/integration, and UI-smoke commands with inventory evidence", async () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      "test:unit": "vitest run --config vitest.unit.config.ts",
      "test:api": "vitest run --config vitest.api.config.ts",
      "test:ui-smoke": "vitest run --config vitest.ui-smoke.config.ts",
      "test:inventory": "node scripts/test-suite-inventory.mjs",
      "eval:runtime": "vitest run --config ls.vitest.config.ts",
      "eval:pstn": "vitest run --config pstn.vitest.config.ts",
    });

    const inventory = JSON.parse(
      execFileSync(
        process.execPath,
        [resolve(repositoryRoot, "scripts/test-suite-inventory.mjs"), "--json"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
        },
      ),
    ) as {
      ordinary: {
        files: number;
        tests: number;
        lines: number;
      };
      layers: Record<string, { files: number; tests: number; lines: number }>;
      filesByLayer: Record<string, string[]>;
      ordinaryFiles: string[];
      unclassified: string[];
      duplicates: string[];
    };

    expect(inventory.ordinary.files).toBeGreaterThan(0);
    expect(inventory.ordinary.tests).toBeGreaterThan(0);
    expect(inventory.ordinary.lines).toBeGreaterThan(0);
    expect(inventory.unclassified).toEqual([]);
    expect(inventory.duplicates).toEqual([]);
    const trackedFiles = new Set(inventory.ordinaryFiles);
    const loadConfig = async (file: string) =>
      (await import(pathToFileURL(resolve(repositoryRoot, file)).href))
        .default as TestConfig;
    const [unitConfig, apiConfig, uiSmokeConfig] = await Promise.all([
      loadConfig("vitest.unit.config.ts"),
      loadConfig("vitest.api.config.ts"),
      loadConfig("vitest.ui-smoke.config.ts"),
    ]);
    const configs = {
      unit: unitConfig,
      api: apiConfig,
      "ui-smoke": uiSmokeConfig,
    };

    expect(configs.unit.test?.environment).toBe("node");
    expect(configs.api.test?.environment).toBe("node");
    expect(configs["ui-smoke"].test?.environment).toBe("jsdom");

    for (const [layer, config] of Object.entries(configs)) {
      expect(selectTrackedFiles(config, trackedFiles)).toEqual(
        inventory.filesByLayer[layer],
      );
    }

    expect(
      Object.values(inventory.layers).reduce(
        (total, layer) => total + layer.files,
        0,
      ),
    ).toBe(inventory.ordinary.files);
  }, 15_000);
});
