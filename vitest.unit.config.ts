import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@zara/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    maxWorkers: 1,
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/web/**/*.test.ts",
      "apps/platform-admin/**/*.test.ts",
    ],
  },
});
