import { UnitOfWork, TransactionalContext } from "../../../../application/ports/unit-of-work.js";
import { InMemoryAccountRepository } from "./in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "./in-memory-transaction-repository.js";

/**
 * Implementación in-memory del puerto UnitOfWork.
 *
 * JS es single-threaded: no existe carrera real entre dos transferencias
 * concurrentes sobre el mismo proceso. Por eso:
 *   - `transaction(work)` simplemente ejecuta `work` con los repos in-memory dados.
 *   - `lockAccounts` es un no-op; no hay nada que bloquear.
 *
 * Esta implementación se usa en tests de unidad e HTTP (con app.inject),
 * donde no queremos dependencias de Docker ni de Postgres.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly accountRepo: InMemoryAccountRepository,
    private readonly txRepo: InMemoryTransactionRepository
  ) {}

  async transaction<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T> {
    const ctx: TransactionalContext = {
      accounts: this.accountRepo,
      transactions: this.txRepo,
      // No-op: JS es single-threaded; no hay carrera real en in-memory.
      lockAccounts: () => Promise.resolve(),
    };
    return work(ctx);
  }
}
