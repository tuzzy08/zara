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
    include: [
      "apps/api/**/*.test.ts",
      "apps/pstn-protocol-simulator/**/*.test.ts",
    ],
  },
});
