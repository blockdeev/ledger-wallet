import { Migration } from "kysely/migration";
import * as migration0001 from "./0001_init.js";

/**
 * Mapa de migraciones en código (no FileMigrationProvider).
 *
 * Razón: en ESM con .ts, FileMigrationProvider requiere un import() dinámico
 * con resolución de extensiones que es frágil con tsx + Node ESM.
 * Un mapa explícito es más predecible y evita esa complejidad.
 * Ver ADR 0009.
 */
export const migrations: Record<string, Migration> = {
  "0001_init": {
    up: migration0001.up,
    down: migration0001.down,
  },
};
