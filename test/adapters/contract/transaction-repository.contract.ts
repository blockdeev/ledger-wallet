import { describe, it, expect } from "vitest";
import { TransactionRepository } from "../../../src/application/ports/transaction-repository.js";
import { createTransaction } from "../../../src/domain/ledger-transaction.js";
import { createPosting } from "../../../src/domain/posting.js";
import { Money } from "../../../src/domain/money.js";

/**
 * Contract test reutilizable para TransactionRepository.
 *
 * Demuestra que el adapter Postgres es un drop-in del puerto (principio hexagonal):
 * el mismo contrato que pasa el adapter in-memory debe pasarlo el de Postgres.
 *
 * La función makeRepo devuelve un repositorio ya limpio (sin transacciones previas).
 * En los tests de integración Postgres, el setup hace TRUNCATE entre casos.
 *
 * @param makeRepo - Factory que devuelve un repositorio limpio para cada test.
 * @param opts.testStableOrder - Si true, verifica que listAll() retorna en orden
 *   estable por occurred_at+id. El adapter in-memory no garantiza orden;
 *   el Postgres sí (ORDER BY en la query). Default: false.
 */
export function runTransactionRepositoryContract(
  makeRepo: () => TransactionRepository | Promise<TransactionRepository>,
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
  ) {
    return createTransaction({
      id,
      postings: [
        createPosting(fromId, Money.fromMinor(-amount, currency)),
        createPosting(toId, Money.fromMinor(amount, currency)),
      ],
      occurredAt: occurredAt ?? new Date("2024-01-01T00:00:00Z"),
    });
  }

  describe("TransactionRepository contract", () => {
    async function getRepo(): Promise<TransactionRepository> {
      return makeRepo();
    }

    it("listAll returns empty array when no transactions exist", async () => {
      const repo = await getRepo();
      const result = await repo.listAll();
      expect(result).toEqual([]);
    });

    it("listByAccount returns empty array when account has no transactions", async () => {
      const repo = await getRepo();
      const result = await repo.listByAccount("nonexistent-account");
      expect(result).toEqual([]);
    });

    it("append and listAll: returns appended transaction with correct fields", async () => {
      const repo = await getRepo();
      const tx = makeTx("tx-contract-1", "acc-from", "acc-to", 100n);
      await repo.append(tx);

      const all = await repo.listAll();
      expect(all).toHaveLength(1);
      const found = all[0];
      expect(found?.id).toBe("tx-contract-1");
      expect(found?.occurredAt).toEqual(new Date("2024-01-01T00:00:00Z"));
    });

    it("append reconstructs postings faithfully (accountId, amount as bigint, currency)", async () => {
      const repo = await getRepo();
      const tx = makeTx("tx-contract-2", "acc-a", "acc-b", 500n, "USD");
      await repo.append(tx);

      const all = await repo.listAll();
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
      const repo = await getRepo();
      const tx1 = makeTx("tx-contract-multi-1", "a", "b", 100n);
      const tx2 = makeTx("tx-contract-multi-2", "b", "c", 200n);
      await repo.append(tx1);
      await repo.append(tx2);

      const all = await repo.listAll();
      expect(all).toHaveLength(2);
      const ids = all.map((t) => t.id);
      expect(ids).toContain("tx-contract-multi-1");
      expect(ids).toContain("tx-contract-multi-2");
    });

    it("listByAccount returns only transactions involving the given account", async () => {
      const repo = await getRepo();
      const tx1 = makeTx("tx-contract-filter-1", "acc-a", "acc-b", 100n);
      const tx2 = makeTx("tx-contract-filter-2", "acc-b", "acc-c", 50n);
      const tx3 = makeTx("tx-contract-filter-3", "acc-x", "acc-y", 999n);
      await repo.append(tx1);
      await repo.append(tx2);
      await repo.append(tx3);

      const forB = await repo.listByAccount("acc-b");
      expect(forB).toHaveLength(2);
      expect(forB.map((t) => t.id)).toContain("tx-contract-filter-1");
      expect(forB.map((t) => t.id)).toContain("tx-contract-filter-2");

      const forX = await repo.listByAccount("acc-x");
      expect(forX).toHaveLength(1);
      expect(forX[0]?.id).toBe("tx-contract-filter-3");
    });

    it("listByAccount returns empty array if account has no transactions (after other txs exist)", async () => {
      const repo = await getRepo();
      const tx = makeTx("tx-contract-no-acc", "a", "b", 100n);
      await repo.append(tx);

      const result = await repo.listByAccount("z-nobody");
      expect(result).toEqual([]);
    });

    it("append is atomic: transaction and all postings are persisted together", async () => {
      const repo = await getRepo();
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

      await repo.append(tx);

      const all = await repo.listAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.postings).toHaveLength(3);
    });

    it("reconstructed LedgerTransaction preserves occurredAt timestamp", async () => {
      const repo = await getRepo();
      const occurredAt = new Date("2024-06-15T14:30:00.000Z");
      const tx = makeTx("tx-contract-timestamp", "a", "b", 50n, "ARS", occurredAt);
      await repo.append(tx);

      const all = await repo.listAll();
      const found = all[0];
      expect(found?.occurredAt.toISOString()).toBe(occurredAt.toISOString());
    });

    it("amount preserves large bigint values without precision loss", async () => {
      const repo = await getRepo();
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
      await repo.append(tx);

      const all = await repo.listAll();
      const found = all[0];
      const toPosting = found?.postings.find((p) => p.accountId === "acc-big-to");
      expect(toPosting?.amount.minor).toBe(largeAmount);
    });

    // Este test verifica el orden estable (by occurred_at, then id).
    // Solo se activa cuando el adapter garantiza orden determinista (Postgres, con ORDER BY).
    // El adapter in-memory preserva orden de inserción, que puede coincidir o no.
    if (opts.testStableOrder) {
      it("listAll returns transactions in stable order (by occurred_at, then id)", async () => {
        const repo = await getRepo();
        const t1 = new Date("2024-01-01T00:00:00Z");
        const t2 = new Date("2024-01-02T00:00:00Z");
        const t3 = new Date("2024-01-03T00:00:00Z");

        // Insertar en orden no cronológico para verificar que la DB ordena
        const tx2 = makeTx("tx-order-2", "a", "b", 200n, "ARS", t2);
        const tx1 = makeTx("tx-order-1", "a", "b", 100n, "ARS", t1);
        const tx3 = makeTx("tx-order-3", "a", "b", 300n, "ARS", t3);

        await repo.append(tx2);
        await repo.append(tx1);
        await repo.append(tx3);

        const all = await repo.listAll();
        expect(all).toHaveLength(3);
        expect(all[0]?.id).toBe("tx-order-1");
        expect(all[1]?.id).toBe("tx-order-2");
        expect(all[2]?.id).toBe("tx-order-3");
      });
    }
  });
}
