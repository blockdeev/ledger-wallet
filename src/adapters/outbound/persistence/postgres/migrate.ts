/**
 * Runner de migraciones. Se ejecuta con:
 *   npm run migrate
 *   (que llama: tsx src/adapters/outbound/persistence/postgres/migrate.ts)
 *
 * Requiere DATABASE_URL en el entorno. Usa loadConfig() para fail-fast.
 * Aplica migrateToLatest() y reporta qué migraciones corrieron.
 * Exit code ≠ 0 si falla.
 */

import { Migrator } from "kysely/migration";
import { loadConfig } from "../../../../config/env.js";
import { createDb } from "./db.js";
import { migrations } from "./migrations/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);

  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: () => Promise.resolve(migrations),
    },
  });

  console.log("Running migrations...");

  const { error, results } = await migrator.migrateToLatest();

  if (results) {
    for (const result of results) {
      if (result.status === "Success") {
        console.log(`  ✓ ${result.migrationName} applied`);
      } else if (result.status === "Error") {
        console.error(`  ✗ ${result.migrationName} FAILED`);
      } else {
        console.log(`  - ${result.migrationName} (${result.status})`);
      }
    }
  }

  if (results?.length === 0) {
    console.log("  No new migrations to apply (already up to date).");
  }

  await db.destroy();

  if (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  console.log("Migrations complete.");
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
