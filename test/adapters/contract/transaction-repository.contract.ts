import { describe, it, expect } from "vitest";
import { TransactionRepository } from "../../../src/application/ports/transaction-repository.js";
import { AccountRepository } from "../../../src/application/ports/account-repository.js";
import {
  LedgerTransaction,
  createTransaction,
} from "../../../src/domain/ledger-transaction.js";
import { createPosting } from "../../../src/domain/posting.js";
import { createAccount, AccountType } from "../../../src/domain/account.js";
import { Money } from "../../../src/domain/money.js";

/**
 * Contract test reutilizable para TransactionRepository.
 *
 * Demuestra que el adapter Postgres es un drop-in del puerto (principio hexagonal):
 * el mismo contrato que pasa el adapter in-memory debe pasarlo el de Postgres.
 *
 * El setup devuelve un TransactionRepository y un AccountRepository sobre el MISMO
 * backing store, ambos limpios. En los tests de integración Postgres, el setup hace
 * TRUNCATE entre casos.
 *
 * Por qué también un AccountRepository: en un ledger, un posting referencia una cuenta
 * que DEBE existir. El adapter Postgres lo hace cumplir con una FK
 * (postings.account_id -> accounts.id); el in-memory no. Para que el MISMO contrato
 * pase en ambos, antes de cada append sembramos las cuentas referenciadas por la tx
 * (ver appendTx). Es inofensivo para in-memory y refleja el uso real (el caso de uso
 * Transfer siempre carga/crea las cuentas antes de appendear).
 *
 * @param makeRepos - Factory que devuelve { txRepo, accountRepo } limpios para cada test.
 * @param opts.testStableOrder - Si true, verifica que listAll() retorna en orden
 *   estable por occurred_at+id. El adapter in-memory no garantiza orden;
 *   el Postgres sí (ORDER BY en la query). Default: false.
 */
export interface TransactionRepoContractSetup {
  txRepo: TransactionRepository;
  accountRepo: AccountRepository;
}

export function runTransactionRepositoryContract(
  makeRepos: () =>
    | TransactionRepoContractSetup
    | Promise<TransactionRepoContractSetup>,
  opts: { testStableOrder?: boolean } = {}
): void {
  // Helper para construir transacciones de test
  function makeTx(
    id: string,
    fromId: string,
    toId: string,
    amount: bigint,
    currency = "ARS",
    occurredAt?: Date
  ): LedgerTransaction {
    return createTransaction({
      id,
      postings: [
        createPosting(fromId, Money.fromMinor(-amount, currency)),
        createPosting(toId, Money.fromMinor(amount, currency)),
      ],
      occurredAt: occurredAt ?? new Date("2024-01-01T00:00:00Z"),
    });
  }

  // Siembra las cuentas referenciadas por la tx (satisface la FK de Postgres) y appendea.
  // El tipo de cuenta es irrelevante para la persistencia (el repo no valida sobregiro);
  // se usa la currency de cada posting. save() es upsert, así que sembrar una cuenta
  // repetida entre txs es idempotente.
  async function appendTx(
    txRepo: TransactionRepository,
    accountRepo: AccountRepository,
    tx: LedgerTransaction
  ): Promise<void> {
    const seen = new Set<string>();
    for (const posting of tx.postings) {
      if (seen.has(posting.accountId)) continue;
      seen.add(posting.accountId);
      await accountRepo.save(
        createAccount(
          posting.accountId,
          posting.amount.currency,
          AccountType.SYSTEM_CLEARING
        )
      );
    }
    await txRepo.append(tx);
  }

  describe("TransactionRepository contract", () => {
    async function getRepos(): Promise<TransactionRepoContractSetup> {
      return makeRepos();
    }

    it("listAll returns empty array when no transactions exist", async () => {
      const { txRepo } = await getRepos();
      const result = await txRepo.listAll();
      expect(result).toEqual([]);
    });

    it("listByAccount returns empty array when account has no transactions", async () => {
      const { txRepo } = await getRepos();
      const result = await txRepo.listByAccount("nonexistent-account");
      expect(result).toEqual([]);
    });

    it("append and listAll: returns appended transaction with correct fields", async () => {
      const { txRepo, accountRepo } = await getRepos();
      const tx = makeTx("tx-contract-1", "acc-from", "acc-to", 100n);
      await appendTx(txRepo, accountRepo, tx);

      const all = await txRepo.listAll();
      expect(all).toHaveLength(1);
      const found = all[0];
      expect(found?.id).toBe("tx-contract-1");
      expect(found?.occurredAt).toEqual(new Date("2024-01-01T00:00:00Z"));
    });

    it("append reconstructs postings faithfully (accountId, amount as bigint, currency)", async () => {
      const { txRepo, accountRepo } = await getRepos();
      const tx = makeTx("tx-contract-2", "acc-a", "acc-b", 500n, "USD");
      await appendTx(txRepo, accountRepo, tx);

      const all = await txRepo.listAll();
      expect(all).toHaveLength(1);
      const found = all[0];
      expect(found?.postings).toHaveLength(2);

      const fromPosting = found?.postings.find((p) => p.accountId === "acc-a");
      const toPosting = found?.postings.find((p) => p.accountId === "acc-b");

      expect(fromPosting?.amount.minor).toBe(-500n);
      expect(fromPosting?.amount.currency).toBe("USD");
      expect(toPosting?.amount.minor).toBe(500n);
      expect(toPosting?.amount.currency).toBe("USD");
    });

    it("append and listAll: returns multiple transactions", async () => {
      const { txRepo, accountRepo } = await getRepos();
      const tx1 = makeTx("tx-contract-multi-1", "a", "b", 100n);
      const tx2 = makeTx("tx-contract-multi-2", "b", "c", 200n);
      await appendTx(txRepo, accountRepo, tx1);
      await appendTx(txRepo, accountRepo, tx2);

      const all = await txRepo.listAll();
      expect(all).toHaveLength(2);
      const ids = all.map((t) => t.id);
      expect(ids).toContain("tx-contract-multi-1");
      expect(ids).toContain("tx-contract-multi-2");
    });

    it("listByAccount returns only transactions involving the given account", async () => {
      const { txRepo, accountRepo } = await getRepos();
      const tx1 = makeTx("tx-contract-filter-1", "acc-a", "acc-b", 100n);
      const tx2 = makeTx("tx-contract-filter-2", "acc-b", "acc-c", 50n);
      const tx3 = makeTx("tx-contract-filter-3", "acc-x", "acc-y", 999n);
      await appendTx(txRepo, accountRepo, tx1);
      await appendTx(txRepo, accountRepo, tx2);
      await appendTx(txRepo, accountRepo, tx3);

      const forB = await txRepo.listByAccount("acc-b");
      expect(forB).toHaveLength(2);
      expect(forB.map((t) => t.id)).toContain("tx-contract-filter-1");
      expect(forB.map((t) => t.id)).toContain("tx-contract-filter-2");

      const forX = await txRepo.listByAccount("acc-x");
      expect(forX).toHaveLength(1);
      expect(forX[0]?.id).toBe("tx-contract-filter-3");
    });

    it("listByAccount returns empty array if account has no transactions (after other txs exist)", async () => {
      const { txRepo, accountRepo } = await getRepos();
      const tx = makeTx("tx-contract-no-acc", "a", "b", 100n);
      await appendTx(txRepo, accountRepo, tx);

      const result = await txRepo.listByAccount("z-nobody");
      expect(result).toEqual([]);
    });

    it("append is atomic: transaction and all postings are persisted together", async () => {
      const { txRepo, accountRepo } = await getRepos();
      // Una tx con 3 postings (ej. split de fondos)
      const tx = createTransaction({
        id: "tx-contract-atomic",
        postings: [
          createPosting("src", Money.fromMinor(-300n, "ARS")),
          createPosting("dst-a", Money.fromMinor(100n, "ARS")),
          createPosting("dst-b", Money.fromMinor(200n, "ARS")),
        ],
        occurredAt: new Date("2024-01-01T00:00:00Z"),
      });

      await appendTx(txRepo, accountRepo, tx);

      const all = await txRepo.listAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.postings).toHaveLength(3);
    });

    it("reconstructed LedgerTransaction preserves occurredAt timestamp", async () => {
      const { txRepo, accountRepo } = await getRepos();
      const occurredAt = new Date("2024-06-15T14:30:00.000Z");
      const tx = makeTx("tx-contract-timestamp", "a", "b", 50n, "ARS", occurredAt);
      await appendTx(txRepo, accountRepo, tx);

      const all = await txRepo.listAll();
      const found = all[0];
      expect(found?.occurredAt.toISOString()).toBe(occurredAt.toISOString());
    });

    it("amount preserves large bigint values without precision loss", async () => {
      const { txRepo, accountRepo } = await getRepos();
      // Un valor grande que excedería Number.MAX_SAFE_INTEGER
      const largeAmount = 9_007_199_254_740_993n; // > 2^53
      const tx = createTransaction({
        id: "tx-contract-bigint",
        postings: [
          createPosting("acc-big-from", Money.fromMinor(-largeAmount, "ARS")),
          createPosting("acc-big-to", Money.fromMinor(largeAmount, "ARS")),
        ],
        occurredAt: new Date("2024-01-01T00:00:00Z"),
      });
      await appendTx(txRepo, accountRepo, tx);

      const all = await txRepo.listAll();
      const found = all[0];
      const toPosting = found?.postings.find((p) => p.accountId === "acc-big-to");
      expect(toPosting?.amount.minor).toBe(largeAmount);
    });

    // Este test verifica el orden estable (by occurred_at, then id).
    // Solo se activa cuando el adapter garantiza orden determinista (Postgres, con ORDER BY).
    // El adapter in-memory preserva orden de inserción, que puede coincidir o no.
    if (opts.testStableOrder) {
      it("listAll returns transactions in stable order (by occurred_at, then id)", async () => {
        const { txRepo, accountRepo } = await getRepos();
        const t1 = new Date("2024-01-01T00:00:00Z");
        const t2 = new Date("2024-01-02T00:00:00Z");
        const t3 = new Date("2024-01-03T00:00:00Z");

        // Insertar en orden no cronológico para verificar que la DB ordena
        const tx2 = makeTx("tx-order-2", "a", "b", 200n, "ARS", t2);
        const tx1 = makeTx("tx-order-1", "a", "b", 100n, "ARS", t1);
        const tx3 = makeTx("tx-order-3", "a", "b", 300n, "ARS", t3);

        await appendTx(txRepo, accountRepo, tx2);
        await appendTx(txRepo, accountRepo, tx1);
        await appendTx(txRepo, accountRepo, tx3);

        const all = await txRepo.listAll();
        expect(all).toHaveLength(3);
        expect(all[0]?.id).toBe("tx-order-1");
        expect(all[1]?.id).toBe("tx-order-2");
        expect(all[2]?.id).toBe("tx-order-3");
      });
    }
  });
}
