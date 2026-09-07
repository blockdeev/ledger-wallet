import { LedgerTransaction } from "../../../../domain/ledger-transaction.js";
import { TransactionRepository } from "../../../../application/ports/transaction-repository.js";

/**
 * Implementación in-memory del puerto TransactionRepository.
 * Append-only; el array interno nunca se modifica, solo se agrega.
 * Usada en tests de casos de uso; sin dependencias externas.
 */
export class InMemoryTransactionRepository implements TransactionRepository {
  private readonly log: LedgerTransaction[] = [];

  async append(tx: LedgerTransaction): Promise<void> {
    await Promise.resolve();
    this.log.push(tx);
  }

  async listByAccount(accountId: string): Promise<LedgerTransaction[]> {
    await Promise.resolve();
    return this.log.filter((tx) =>
      tx.postings.some((p) => p.accountId === accountId)
    );
  }

  async listAll(): Promise<LedgerTransaction[]> {
    await Promise.resolve();
    return [...this.log];
  }
}
