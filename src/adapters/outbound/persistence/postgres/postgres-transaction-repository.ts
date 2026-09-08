import { Kysely } from "kysely";
import { LedgerTransaction } from "../../../../domain/ledger-transaction.js";
import { TransactionRepository } from "../../../../application/ports/transaction-repository.js";
import { Database } from "./db.js";
import { transactionToRows, groupPostingsByTransaction } from "./mapper.js";

/**
 * Adapter Postgres del puerto TransactionRepository.
 * Implementa los mismos contratos que InMemoryTransactionRepository.
 *
 * Atomicidad de append():
 *   La fila de ledger_transactions y todos sus postings se insertan
 *   dentro de UNA transacción de DB (db.transaction().execute()).
 *   Todo-o-nada a nivel write: si falla cualquier posting, se hace rollback.
 *
 * Ineficiencia conocida (documentada en ADR 0008 y 0009):
 *   listAll() carga todo el ledger. En Fase 3b se optimizará con índices
 *   y/o saldo materializado + locking.
 */
export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async append(tx: LedgerTransaction): Promise<void> {
    const { txRow, postingRows } = transactionToRows(tx);

    // Inserta cabecera + postings sobre un executor dado (Kysely o Transaction).
    const insert = async (executor: Kysely<Database>): Promise<void> => {
      // Insertar cabecera de la transacción
      await executor
        .insertInto("ledger_transactions")
        .values({
          id: txRow.id,
          occurred_at: txRow.occurred_at,
        })
        .execute();

      // Insertar todos los postings en la misma transacción de DB (todo-o-nada)
      await executor
        .insertInto("postings")
        .values(
          postingRows.map((p) => ({
            transaction_id: p.transaction_id,
            account_id: p.account_id,
            amount: p.amount,
            currency: p.currency,
          }))
        )
        .execute();
    };

    // Si ya estamos dentro de una transacción (p. ej. invocados por el UnitOfWork
    // de Transfer), reusamos ese executor: Kysely no permite abrir una transacción
    // anidada sobre una Transaction. Si nos usan de forma standalone (contract
    // tests, uso directo del repo), abrimos nuestra propia transacción para
    // mantener la atomicidad todo-o-nada de la cabecera + los postings.
    if (this.db.isTransaction) {
      await insert(this.db);
    } else {
      await this.db.transaction().execute(insert);
    }
  }

  async listByAccount(accountId: string): Promise<LedgerTransaction[]> {
    // IDs de transacciones que tienen al menos un posting de esta cuenta
    const txIdRows = await this.db
      .selectFrom("postings")
      .select("transaction_id")
      .where("account_id", "=", accountId)
      .distinct()
      .execute();

    if (txIdRows.length === 0) {
      return [];
    }

    const ids = txIdRows.map((r) => r.transaction_id);
    return this.fetchTransactionsByIds(ids);
  }

  async listAll(): Promise<LedgerTransaction[]> {
    const txRows = await this.db
      .selectFrom("ledger_transactions")
      .selectAll()
      .orderBy("occurred_at", "asc")
      .orderBy("id", "asc")
      .execute();

    if (txRows.length === 0) {
      return [];
    }

    const ids = txRows.map((r) => r.id);

    const postingRows = await this.db
      .selectFrom("postings")
      .select(["transaction_id", "account_id", "amount", "currency"])
      .where("transaction_id", "in", ids)
      .execute();

    return groupPostingsByTransaction(txRows, postingRows);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchTransactionsByIds(ids: string[]): Promise<LedgerTransaction[]> {
    const txRows = await this.db
      .selectFrom("ledger_transactions")
      .selectAll()
      .where("id", "in", ids)
      .orderBy("occurred_at", "asc")
      .orderBy("id", "asc")
      .execute();

    const postingRows = await this.db
      .selectFrom("postings")
      .select(["transaction_id", "account_id", "amount", "currency"])
      .where("transaction_id", "in", ids)
      .execute();

    return groupPostingsByTransaction(txRows, postingRows);
  }
}
