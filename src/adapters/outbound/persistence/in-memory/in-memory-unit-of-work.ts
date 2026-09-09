import { UnitOfWork, TransactionalContext } from "../../../../application/ports/unit-of-work.js";
import { InMemoryAccountRepository } from "./in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "./in-memory-transaction-repository.js";
import { InMemoryIdempotencyRepository } from "./in-memory-idempotency-repository.js";

/**
 * Implementación in-memory del puerto UnitOfWork.
 *
 * JS es single-threaded: no existe carrera real entre dos transferencias
 * concurrentes sobre el mismo proceso. Por eso `lockAccounts` es un no-op.
 *
 * Desde Fase 3c, `transaction(work)` implementa snapshot/restore para emular
 * rollback. Esto es load-bearing: con la estrategia reserve-first, la clave
 * de idempotencia se persiste ANTES de que se ejecute la transferencia. Si la
 * transferencia falla (p. ej. OverdraftError), el rollback debe deshacer también
 * la reserva; sin esto, la clave quedaría "quemada" y un reintento legítimo
 * encontraría la clave con un transactionId que apunta a una tx inexistente.
 *
 * Mecanismo: antes de ejecutar `work`, se toma un snapshot de los tres repos;
 * si `work` lanza, se restaura el snapshot y se re-lanza el error.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(
    private readonly accountRepo: InMemoryAccountRepository,
    private readonly txRepo: InMemoryTransactionRepository,
    private readonly idempotencyRepo: InMemoryIdempotencyRepository
  ) {}

  async transaction<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T> {
    // Snapshot del estado previo (emula BEGIN TRANSACTION)
    const accountSnap = this.accountRepo.snapshot();
    const txSnap = this.txRepo.snapshot();
    const idempotencySnap = this.idempotencyRepo.snapshot();

    const ctx: TransactionalContext = {
      accounts: this.accountRepo,
      transactions: this.txRepo,
      idempotency: this.idempotencyRepo,
      // No-op: JS es single-threaded; no hay carrera real en in-memory.
      lockAccounts: () => Promise.resolve(),
    };

    try {
      return await work(ctx);
    } catch (err) {
      // Rollback: restaurar el estado previo al snapshot
      this.accountRepo.restore(accountSnap);
      this.txRepo.restore(txSnap);
      this.idempotencyRepo.restore(idempotencySnap);
      throw err;
    }
  }
}
