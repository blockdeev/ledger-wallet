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
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Frontera hexagonal: el dominio no puede importar infraestructura
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["fastify", "fastify/*"], message: "Domain must not depend on Fastify (HTTP adapter)." },
            { group: ["kysely", "kysely/*"], message: "Domain must not depend on Kysely (DB adapter)." },
            { group: ["pg", "pg/*"], message: "Domain must not depend on pg (DB adapter)." },
            { group: ["**/adapters/**"], message: "Domain must not import from adapters." },
            { group: ["**/config/**"], message: "Domain must not import from config." },
            { group: ["**/application/**"], message: "Domain must not import from application layer." },
          ],
        },
      ],
    },
  },
  {
    // Frontera hexagonal: la capa de aplicación no puede importar infraestructura ni adapters
    files: ["src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["fastify", "fastify/*"], message: "Application layer must not depend on Fastify (HTTP adapter)." },
            { group: ["kysely", "kysely/*"], message: "Application layer must not depend on Kysely (DB adapter)." },
            { group: ["pg", "pg/*"], message: "Application layer must not depend on pg (DB adapter)." },
            { group: ["**/adapters/**"], message: "Application layer must not import from adapters." },
            { group: ["**/config/**"], message: "Application layer must not import from config." },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "vitest.config.ts", "eslint.config.js"],
  },
);
