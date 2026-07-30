import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@zara/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "apps/web/**/*.test.tsx",
      "apps/platform-admin/**/*.test.tsx",
    ],
  },
});
