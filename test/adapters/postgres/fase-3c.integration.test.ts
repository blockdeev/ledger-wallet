/**
 * Tests de integración para Fase 3c: idempotencia de transferencias.
 *
 * Levanta un Postgres efímero con @testcontainers/postgresql,
 * corre las migraciones (incluye 0002_idempotency_keys), y verifica:
 *
 *   1. Replay e2e secuencial: misma clave dos veces → una sola tx, saldo
 *      movido UNA vez, segunda llamada replayed=true.
 *   2. Concurrencia idempotente: dos execute() simultáneos con la misma clave
 *      sobre una cuenta con fondos para UNA sola transferencia:
 *        - rejected = 0 (ninguno rechaza; la perdedora hace replay, no error)
 *        - exactamente UNA con replayed:false y UNA con replayed:true
 *        - saldo final consistente (solo se movió dinero una vez)
 *        - UN solo registro en idempotency_keys
 *        - UNA sola ledger_transaction
 *        - cero doble-gasto
 *   3. Conflicto e2e: misma clave, payload distinto → IdempotencyConflictError.
 *
 * ESTOS TESTS NO FORMAN PARTE DE `npm test` (unit).
 * Se corren con `npm run test:integration`, que requiere Docker.
 *
 * El test de concurrencia (caso 2) es el verificador clave del diseño
 * reserve-first: la constraint UNIQUE de idempotency_keys debe serializar
 * la carrera antes del lock de cuentas, garantizando que la perdedora
 * nunca ejecute la transferencia sino que haga replay.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Migrator } from "kysely/migration";
import { Kysely, sql } from "kysely";
import { createDb, Database } from "../../../src/adapters/outbound/persistence/postgres/db.js";
import { migrations } from "../../../src/adapters/outbound/persistence/postgres/migrations/index.js";
import { PostgresAccountRepository } from "../../../src/adapters/outbound/persistence/postgres/postgres-account-repository.js";
import { PostgresTransactionRepository } from "../../../src/adapters/outbound/persistence/postgres/postgres-transaction-repository.js";
import { PostgresUnitOfWork } from "../../../src/adapters/outbound/persistence/postgres/postgres-unit-of-work.js";
import { CreateAccount } from "../../../src/application/use-cases/create-account.js";
import { CapturingLogger } from "../../support/capturing-logger.js";
import { CapturingMetrics } from "../../support/capturing-metrics.js";
import { Transfer } from "../../../src/application/use-cases/transfer.js";
import { GetBalance } from "../../../src/application/use-cases/get-balance.js";
import { AccountType } from "../../../src/domain/account.js";
import { Money } from "../../../src/domain/money.js";
import { IdempotencyConflictError } from "../../../src/application/errors.js";
import { NoopTracer } from "../../support/capturing-tracer.js";

// ── Setup del contenedor ──────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer;
let db: Kysely<Database>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const connectionString = container.getConnectionUri();
  db = createDb(connectionString);

  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
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
}, 60_000);

afterAll(async () => {
  await db.destroy();
  await container.stop();
});

// Limpiar tablas entre tests para aislamiento
beforeEach(async () => {
  await sql`TRUNCATE TABLE postings, ledger_transactions, idempotency_keys, accounts RESTART IDENTITY CASCADE`.execute(db);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUseCases() {
  const accountRepo = new PostgresAccountRepository(db);
  const txRepo = new PostgresTransactionRepository(db);
  const uow = new PostgresUnitOfWork(db);
  const createAccount = new CreateAccount(accountRepo, new CapturingLogger(), new CapturingMetrics(), new NoopTracer());
  const transfer = new Transfer(uow, new CapturingLogger(), new CapturingMetrics(), new NoopTracer());
  const getBalance = new GetBalance(accountRepo, txRepo, new CapturingLogger());
  return { createAccount, transfer, getBalance, uow };
}

async function setupAccounts(
  createAccount: CreateAccount,
  transfer: Transfer
): Promise<void> {
  await createAccount.execute({ id: "sys", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
  await createAccount.execute({ id: "wa", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
  await createAccount.execute({ id: "wb", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
  // Fondear wa con 1000 ARS
  await transfer.execute({
    id: "seed",
    fromAccountId: "sys",
    toAccountId: "wa",
    amount: Money.fromMinor(1000n, "ARS"),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Fase 3c — idempotencia e2e con Postgres real", () => {
  // ── 1. Replay secuencial ─────────────────────────────────────────────────

  it("replay secuencial: misma clave dos veces → una sola tx, saldo movido UNA vez", async () => {
    const { createAccount, transfer, getBalance } = makeUseCases();
    await setupAccounts(createAccount, transfer);

    const input = {
      id: "tx-replay-seq",
      fromAccountId: "wa",
      toAccountId: "wb",
      amount: Money.fromMinor(400n, "ARS"),
      idempotencyKey: "key-seq-replay",
    };

    const r1 = await transfer.execute(input);
    expect(r1.replayed).toBe(false);
    expect(r1.transaction.id).toBe("tx-replay-seq");

    const r2 = await transfer.execute(input);
    expect(r2.replayed).toBe(true);
    expect(r2.transaction.id).toBe("tx-replay-seq");

    // Mismo body
    expect(r2.transaction.occurredAt).toEqual(r1.transaction.occurredAt);

    // Solo se movió dinero UNA vez
    const balA = await getBalance.execute({ accountId: "wa" });
    expect(balA.minor).toBe(600n); // 1000 - 400

    const balB = await getBalance.execute({ accountId: "wb" });
    expect(balB.minor).toBe(400n);

    // Un solo registro de idempotencia
    const idemRows = await sql<{ count: string }>`SELECT COUNT(*) as count FROM idempotency_keys`.execute(db);
    expect(Number(idemRows.rows[0]?.count)).toBe(
      1 // solo la de la transferencia principal (la de "seed" no tiene clave)
    );

    // Una sola tx de la transferencia (más la de seed = 2 total)
    const txRows = await sql<{ count: string }>`SELECT COUNT(*) as count FROM ledger_transactions`.execute(db);
    expect(Number(txRows.rows[0]?.count)).toBe(2); // seed + tx-replay-seq
  });

  // ── 2. Concurrencia idempotente ──────────────────────────────────────────

  it(
    "concurrencia idempotente: dos execute() simultáneos → rejected=0, una escritura, una con replayed:true",
    async () => {
      const { createAccount, transfer, getBalance } = makeUseCases();
      await setupAccounts(createAccount, transfer);

      const input = {
        id: "tx-concurrent-idem",
        fromAccountId: "wa",
        toAccountId: "wb",
        amount: Money.fromMinor(1000n, "ARS"), // wa tiene exactamente 1000; solo puede hacerse UNA vez
        idempotencyKey: "key-concurrent",
      };

      // Lanzar dos execute() concurrentes con la misma clave
      const [ra, rb] = await Promise.allSettled([
        transfer.execute(input),
        transfer.execute(input),
      ]);

      // Ninguno debe rechazar (rejected = 0)
      const rejected = [ra, rb].filter((r) => r.status === "rejected").length;
      expect(rejected).toBe(0);

      // Ambos deben haberse cumplido (fulfilled)
      expect(ra.status).toBe("fulfilled");
      expect(rb.status).toBe("fulfilled");

      const rA = (ra as PromiseFulfilledResult<{ transaction: { id: string }; replayed: boolean }>).value;
      const rB = (rb as PromiseFulfilledResult<{ transaction: { id: string }; replayed: boolean }>).value;

      // Exactamente UNA con replayed:false y UNA con replayed:true
      const replayedCount = [rA, rB].filter((r) => r.replayed).length;
      const notReplayedCount = [rA, rB].filter((r) => !r.replayed).length;
      expect(replayedCount).toBe(1);
      expect(notReplayedCount).toBe(1);

      // Ambas deben devolver el mismo transaction.id
      expect(rA.transaction.id).toBe("tx-concurrent-idem");
      expect(rB.transaction.id).toBe("tx-concurrent-idem");

      // Saldo final consistente: solo se movió dinero UNA vez
      const balA = await getBalance.execute({ accountId: "wa" });
      expect(balA.minor).toBe(0n); // 1000 - 1000

      const balB = await getBalance.execute({ accountId: "wb" });
      expect(balB.minor).toBe(1000n); // solo se acreditó una vez

      // UN solo registro de idempotencia
      const idemRows = await sql<{ count: string }>`SELECT COUNT(*) as count FROM idempotency_keys WHERE key = 'key-concurrent'`.execute(db);
      expect(Number(idemRows.rows[0]?.count)).toBe(1);

      // UNA sola ledger_transaction para esta clave (más la seed = 2 total)
      const txRows = await sql<{ count: string }>`SELECT COUNT(*) as count FROM ledger_transactions`.execute(db);
      expect(Number(txRows.rows[0]?.count)).toBe(2); // seed + tx-concurrent-idem

      // Cero doble-gasto: los postings de wb suman exactamente 1000
      const postingRows = await sql<{ total: string }>`
        SELECT COALESCE(SUM(amount::bigint), 0) as total
        FROM postings
        WHERE account_id = 'wb'
      `.execute(db);
      expect(BigInt(postingRows.rows[0]?.total ?? "0")).toBe(1000n);
    },
    30_000
  );

  // ── 3. Conflicto e2e ─────────────────────────────────────────────────────

  it("conflicto e2e: misma clave, payload distinto → IdempotencyConflictError", async () => {
    const { createAccount, transfer } = makeUseCases();
    await setupAccounts(createAccount, transfer);

    await transfer.execute({
      id: "tx-conflict-orig",
      fromAccountId: "wa",
      toAccountId: "wb",
      amount: Money.fromMinor(100n, "ARS"),
      idempotencyKey: "key-conflict-e2e",
    });

    await expect(
      transfer.execute({
        id: "tx-conflict-orig",
        fromAccountId: "wa",
        toAccountId: "wb",
        amount: Money.fromMinor(999n, "ARS"), // distinto
        idempotencyKey: "key-conflict-e2e",
      })
    ).rejects.toThrowError(IdempotencyConflictError);
  });

  // ── 4. Rollback: OverdraftError no quema la clave ────────────────────────

  it("rollback Postgres: overdraft con clave → la clave NO queda en idempotency_keys", async () => {
    const { createAccount, transfer } = makeUseCases();
    await setupAccounts(createAccount, transfer);

    try {
      await transfer.execute({
        id: "tx-overdraft-pg",
        fromAccountId: "wa",
        toAccountId: "wb",
        amount: Money.fromMinor(9999n, "ARS"), // más de lo disponible
        idempotencyKey: "key-overdraft-pg",
      });
    } catch {
      // esperado
    }

    const idemRows = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM idempotency_keys WHERE key = 'key-overdraft-pg'
    `.execute(db);
    expect(Number(idemRows.rows[0]?.count)).toBe(0); // rollback deshizo la reserva
  });
});
