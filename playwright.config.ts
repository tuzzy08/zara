import { defineConfig, devices } from "@playwright/test";

const artifacts = process.env.E2E_ARTIFACT_DIR ?? "artifacts/e2e/manual";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  outputDir: `${artifacts}/results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${artifacts}/report`, open: "never" }],
    ["junit", { outputFile: `${artifacts}/junit.xml` }],
  ],
  use: {
    baseURL: "https://127.0.0.1:8443",
    ignoreHTTPSErrors: true,
    trace: "on",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
