import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "**/dist/**",
      "**/dist-js/**",
      "**/*.d.ts",
      "**/*.d.ts.map",
      "**/*.js.map",
      "**/*.tsbuildinfo",
      "apps/api/src/database/migrations/**",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts", "**/*.mjs"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
      globals: {
        URL: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-console": "error",
    },
  },
);
