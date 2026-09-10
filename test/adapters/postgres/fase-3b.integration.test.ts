/**
 * Tests de integración para Fase 3b: UoW Postgres + transferencias concurrentes.
 *
 * Levanta un Postgres efímero con @testcontainers/postgresql,
 * corre las migraciones, y verifica:
 *
 *   1. Transferencia end-to-end contra Postgres real (crear cuentas, transferir, saldo).
 *   2. Concurrencia: DOS transferencias simultáneas sobre la misma cuenta →
 *      exactamente UNA tiene éxito, la otra falla con OverdraftError, y el
 *      saldo final es consistente (sin doble-gasto).
 *
 * Estos tests NO forman parte de `npm test` (unit).
 * Se corren con `npm run test:integration`, que requiere Docker.
 *
 * El test de concurrencia es el plato fuerte: demuestra que el locking
 * `SELECT ... FOR UPDATE ORDER BY id` dentro del UoW Postgres serializa
 * correctamente las transferencias concurrentes.
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
import { OverdraftError } from "../../../src/domain/errors.js";

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
}, 120_000);

afterAll(async () => {
  await db.destroy();
  await container.stop();
});

async function truncateAll(): Promise<void> {
  await sql`TRUNCATE TABLE postings, ledger_transactions, accounts RESTART IDENTITY CASCADE`.execute(db);
}

// ── Factory de casos de uso sobre el DB del contenedor ───────────────────────

function makeUseCases() {
  const accountRepo = new PostgresAccountRepository(db);
  const txRepo = new PostgresTransactionRepository(db);
  const uow = new PostgresUnitOfWork(db);

  return {
    createAccount: new CreateAccount(accountRepo, new CapturingLogger(), new CapturingMetrics()),
    transfer: new Transfer(uow, new CapturingLogger(), new CapturingMetrics()),
    getBalance: new GetBalance(accountRepo, txRepo, new CapturingLogger()),
  };
}

// ── Tests end-to-end ──────────────────────────────────────────────────────────

describe("Fase 3b – integración Postgres", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ── 1. Happy path end-to-end ───────────────────────────────────────────────

  it("end-to-end: crear cuentas, transferir, verificar saldo derivado", async () => {
    const { createAccount, transfer, getBalance } = makeUseCases();

    // Crear cuentas
    await createAccount.execute({ id: "sys", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wa", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
    await createAccount.execute({ id: "wb", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    // Fondear wa con 5000 ARS desde sys
    await transfer.execute({
      id: "seed-wa",
      fromAccountId: "sys",
      toAccountId: "wa",
      amount: Money.fromMinor(5000n, "ARS"),
    });

    // Transferir 2000 de wa a wb
    const { transaction: tx } = await transfer.execute({
      id: "tx-e2e",
      fromAccountId: "wa",
      toAccountId: "wb",
      amount: Money.fromMinor(2000n, "ARS"),
    });

    expect(tx.id).toBe("tx-e2e");
    expect(tx.postings).toHaveLength(2);

    const balanceWa = await getBalance.execute({ accountId: "wa" });
    const balanceWb = await getBalance.execute({ accountId: "wb" });

    expect(balanceWa.minor).toBe(3000n); // 5000 - 2000
    expect(balanceWb.minor).toBe(2000n); // 0 + 2000
    expect(balanceWa.currency).toBe("ARS");
    expect(balanceWb.currency).toBe("ARS");
  });

  it("OverdraftError: saldo sin cambios y nada persistido", async () => {
    const { createAccount, transfer, getBalance } = makeUseCases();

    await createAccount.execute({ id: "sys", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wa", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    // Fondear con 100
    await transfer.execute({
      id: "seed",
      fromAccountId: "sys",
      toAccountId: "wa",
      amount: Money.fromMinor(100n, "ARS"),
    });

    // Intentar transferir 500 (más de lo que hay)
    await expect(
      transfer.execute({
        id: "tx-overdraft",
        fromAccountId: "wa",
        toAccountId: "sys",
        amount: Money.fromMinor(500n, "ARS"),
      })
    ).rejects.toThrowError(OverdraftError);

    // Saldo no cambió
    const balance = await getBalance.execute({ accountId: "wa" });
    expect(balance.minor).toBe(100n);
  });

  // ── 2. TEST DE CONCURRENCIA ────────────────────────────────────────────────

  it(
    "concurrencia: exactamente una transferencia gana, la otra falla con OverdraftError; sin doble-gasto",
    async () => {
      const { createAccount, transfer, getBalance } = makeUseCases();

      // Crear cuentas
      await createAccount.execute({ id: "sys-conc", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
      await createAccount.execute({ id: "wa-conc", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
      await createAccount.execute({ id: "wb-conc", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

      // Fondear wa-conc con 1000 ARS (exactamente para UNA transferencia de 1000)
      await transfer.execute({
        id: "seed-conc",
        fromAccountId: "sys-conc",
        toAccountId: "wa-conc",
        amount: Money.fromMinor(1000n, "ARS"),
      });

      // Verificar saldo inicial
      const initialBalance = await getBalance.execute({ accountId: "wa-conc" });
      expect(initialBalance.minor).toBe(1000n);

      // Disparar DOS transferencias concurrentes de 1000 desde wa-conc
      // Solo una puede tener fondos suficientes; la otra debe fallar con OverdraftError
      const results = await Promise.allSettled([
        transfer.execute({
          id: "tx-conc-1",
          fromAccountId: "wa-conc",
          toAccountId: "wb-conc",
          amount: Money.fromMinor(1000n, "ARS"),
        }),
        transfer.execute({
          id: "tx-conc-2",
          fromAccountId: "wa-conc",
          toAccountId: "wb-conc",
          amount: Money.fromMinor(1000n, "ARS"),
        }),
      ]);

      // Exactamente una debe cumplir y la otra debe fallar
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // La que falló debe ser OverdraftError (no un error de DB u otro)
      const rejectedResult = rejected[0];
      expect(rejectedResult?.status).toBe("rejected");
      if (rejectedResult?.status === "rejected") {
        expect(rejectedResult.reason).toBeInstanceOf(OverdraftError);
      }

      // Verificar saldo final: wa-conc debe quedar en 0 (sin doble-gasto)
      const finalBalance = await getBalance.execute({ accountId: "wa-conc" });
      expect(finalBalance.minor).toBe(0n);

      // wb-conc debe haber recibido exactamente 1000 (una sola transferencia)
      const wbBalance = await getBalance.execute({ accountId: "wb-conc" });
      expect(wbBalance.minor).toBe(1000n);
    },
    60_000
  );

  // ── 3. Concurrencia A→B y B→A (test de deadlocks) ─────────────────────────

  it(
    "concurrencia A→B y B→A simultáneas: el ORDER BY id en lockAccounts evita deadlocks",
    async () => {
      const { createAccount, transfer, getBalance } = makeUseCases();

      await createAccount.execute({ id: "acc-a", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
      await createAccount.execute({ id: "acc-b", currency: "ARS", type: AccountType.SYSTEM_CLEARING });

      // Fondear ambas (SYSTEM_CLEARING puede ir negativo, pero las fondeamos para ser explícitos)
      await transfer.execute({
        id: "seed-a",
        fromAccountId: "acc-b",
        toAccountId: "acc-a",
        amount: Money.fromMinor(5000n, "ARS"),
      });
      await transfer.execute({
        id: "seed-b",
        fromAccountId: "acc-a",
        toAccountId: "acc-b",
        amount: Money.fromMinor(5000n, "ARS"),
      });

      // A→B y B→A concurrentes: deben completarse sin deadlock
      const results = await Promise.allSettled([
        transfer.execute({
          id: "tx-atob",
          fromAccountId: "acc-a",
          toAccountId: "acc-b",
          amount: Money.fromMinor(1000n, "ARS"),
        }),
        transfer.execute({
          id: "tx-btoa",
          fromAccountId: "acc-b",
          toAccountId: "acc-a",
          amount: Money.fromMinor(1000n, "ARS"),
        }),
      ]);

      // Ambas son SYSTEM_CLEARING → ninguna puede fallar por OverdraftError;
      // tampoco debe haber deadlock (gracias al ORDER BY id).
      const failures = results.filter((r) => r.status === "rejected");
      expect(failures).toHaveLength(0);

      // Saldos netos se cancelan (intercambio de la misma cantidad)
      const balanceA = await getBalance.execute({ accountId: "acc-a" });
      const balanceB = await getBalance.execute({ accountId: "acc-b" });
      // Ambas cuentas deben tener saldo cero al final (fondeo + intercambio se cancelan)
      expect(balanceA.minor).toBe(0n);
      expect(balanceB.minor).toBe(0n);
    },
    60_000
  );
});
