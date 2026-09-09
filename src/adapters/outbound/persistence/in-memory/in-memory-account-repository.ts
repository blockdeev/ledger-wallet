import { Account } from "../../../../domain/account.js";
import { AccountRepository } from "../../../../application/ports/account-repository.js";

/**
 * Implementación in-memory del puerto AccountRepository.
 * Usada en tests de casos de uso; sin dependencias externas.
 *
 * Expone `snapshot()` y `restore()` para que InMemoryUnitOfWork pueda
 * implementar rollback (requerido por la semántica reserve-first de 3c).
 */
export class InMemoryAccountRepository implements AccountRepository {
  private store = new Map<string, Account>();

  async save(account: Account): Promise<void> {
    await Promise.resolve();
    this.store.set(account.id, account);
  }

  async findById(id: string): Promise<Account | undefined> {
    await Promise.resolve();
    return this.store.get(id);
  }

  /** Devuelve una copia del store para snapshot/restore. */
  snapshot(): Map<string, Account> {
    return new Map(this.store);
  }

  /** Reemplaza el store con el snapshot dado (restaura el estado previo). */
  restore(snap: Map<string, Account>): void {
    this.store = new Map(snap);
  }
}
