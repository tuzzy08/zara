import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const shouldUploadToLangSmith =
  process.env.LANGSMITH_TRACING === "true"
  && (process.env.LANGSMITH_API_KEY?.trim().length ?? 0) > 0;

if (!shouldUploadToLangSmith) {
  process.env.LANGSMITH_TEST_TRACKING ??= "false";
}

export default defineConfig({
  resolve: {
    alias: {
      "@zara/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.pstn.eval.ts"],
    reporters: shouldUploadToLangSmith
      ? ["default", "langsmith/vitest/reporter"]
      : ["default"],
  },
});
