import { LedgerTransaction } from "../../../../domain/ledger-transaction.js";
import { TransactionRepository } from "../../../../application/ports/transaction-repository.js";

/**
 * Implementación in-memory del puerto TransactionRepository.
 * Append-only; el array interno nunca se modifica directamente desde fuera.
 * Usada en tests de casos de uso; sin dependencias externas.
 *
 * Expone `snapshot()` y `restore()` para que InMemoryUnitOfWork pueda
 * implementar rollback (requerido por la semántica reserve-first de 3c).
 */
export class InMemoryTransactionRepository implements TransactionRepository {
  private log: LedgerTransaction[] = [];

  async append(tx: LedgerTransaction): Promise<void> {
    await Promise.resolve();
    this.log.push(tx);
  }

  async findById(id: string): Promise<LedgerTransaction | undefined> {
    await Promise.resolve();
    return this.log.find((tx) => tx.id === id);
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

  /** Devuelve una copia del log para snapshot/restore. */
  snapshot(): LedgerTransaction[] {
    return [...this.log];
  }

  /** Reemplaza el log con el snapshot dado (restaura el estado previo). */
  restore(snap: LedgerTransaction[]): void {
    this.log = [...snap];
  }
}
