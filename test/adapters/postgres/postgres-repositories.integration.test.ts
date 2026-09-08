/**
 * Tests de integración para los adapters Postgres.
 *
 * Levanta un Postgres efímero con @testcontainers/postgresql,
 * corre las migraciones de Fase 3a, y ejecuta los contract tests
 * contra PostgresAccountRepository y PostgresTransactionRepository.
 *
 * Estos tests NO forman parte de `npm test` (unit).
 * Se corren con `npm run test:integration`, que requiere Docker.
 *
 * Timeout alto: levantar el contenedor tarda ~10-20s la primera vez.
 */

import { describe, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Migrator } from "kysely/migration";
import { Kysely, sql } from "kysely";
import { createDb, Database } from "../../../src/adapters/outbound/persistence/postgres/db.js";
import { migrations } from "../../../src/adapters/outbound/persistence/postgres/migrations/index.js";
import { PostgresAccountRepository } from "../../../src/adapters/outbound/persistence/postgres/postgres-account-repository.js";
import { PostgresTransactionRepository } from "../../../src/adapters/outbound/persistence/postgres/postgres-transaction-repository.js";
import { runAccountRepositoryContract } from "../contract/account-repository.contract.js";
import { runTransactionRepositoryContract } from "../contract/transaction-repository.contract.js";

// ── Setup del contenedor (compartido entre suites del archivo) ───────────────

let container: StartedPostgreSqlContainer;
let db: Kysely<Database>;

beforeAll(async () => {
  // Levantar el contenedor Postgres efímero
  container = await new PostgreSqlContainer("postgres:16-alpine").start();

  const connectionString = container.getConnectionUri();
  db = createDb(connectionString);

  // Correr migraciones contra el contenedor
  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: () => Promise.resolve(migrations),
    },
  });

  const { error, results } = await migrator.migrateToLatest();

  if (results) {
    for (const result of results) {
      console.log(`  Migration ${result.migrationName}: ${result.status}`);
    }
  }

  if (error) {
    const msg = error instanceof Error ? error.message : "unknown migration error";
    throw new Error(`Migration failed: ${msg}`);
  }
}, 120_000); // 120s timeout para pull de imagen + arranque

afterAll(async () => {
  await db.destroy();
  await container.stop();
});

// ── Aislamiento entre tests ──────────────────────────────────────────────────

/**
 * TRUNCATE de las tablas entre tests para evitar interferencia.
 * Orden: primero postings (FK), luego ledger_transactions, luego accounts.
 */
async function truncateAll(): Promise<void> {
  await sql`TRUNCATE TABLE postings, ledger_transactions, accounts RESTART IDENTITY CASCADE`.execute(db);
}

// ── AccountRepository integration tests ─────────────────────────────────────

describe("PostgresAccountRepository (integration)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  runAccountRepositoryContract(() => new PostgresAccountRepository(db));
});

// ── TransactionRepository integration tests ──────────────────────────────────

describe("PostgresTransactionRepository (integration)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  runTransactionRepositoryContract(
    () => ({
      txRepo: new PostgresTransactionRepository(db),
      accountRepo: new PostgresAccountRepository(db),
    }),
    { testStableOrder: true } // Postgres garantiza orden determinista con ORDER BY
  );
});
