import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@zara/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    maxWorkers: 1,
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts", "packages/**/*.test.tsx"],
  },
});
