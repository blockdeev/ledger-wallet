import { defineConfig } from "vitest/config";

/**
 * Configuración de Vitest para tests de integración (testcontainers).
 *
 * Separada de la config unit para:
 * - No mezclar tests lentos (Docker) con unit tests rápidos
 * - Timeout más alto (levantar contenedor tarda)
 * - No afectar el threshold de cobertura de domain/application
 *
 * Se invoca con: npm run test:integration
 * Requiere Docker en el entorno.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/adapters/postgres/**/*.integration.test.ts"],
    testTimeout: 120_000, // 120s por test (pull de imagen + arranque)
    hookTimeout: 120_000, // beforeAll puede tardar tanto como el arranque
  },
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
});
