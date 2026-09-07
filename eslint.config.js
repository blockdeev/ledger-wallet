// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["test/*.ts", "vitest.config.ts"],
          defaultProject: "./tsconfig.eslint.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "vitest.config.ts", "eslint.config.js"],
  },
);
