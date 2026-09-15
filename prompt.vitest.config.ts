import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@zara/core": resolve(__dirname, "packages/core/src/index.ts") } },
  test: {
    environment: "node", maxWorkers: 1, testTimeout: 60_000,
    include: ["apps/api/src/runtime-evals/runtime-prompt.live.eval.ts"],
  },
});
