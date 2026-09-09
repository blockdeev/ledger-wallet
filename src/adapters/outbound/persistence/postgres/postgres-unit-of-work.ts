import { Kysely, Transaction } from "kysely";
import { UnitOfWork, TransactionalContext } from "../../../../application/ports/unit-of-work.js";
import { Database } from "./db.js";
import { PostgresAccountRepository } from "./postgres-account-repository.js";
import { PostgresTransactionRepository } from "./postgres-transaction-repository.js";
import { PostgresIdempotencyRepository } from "./postgres-idempotency-repository.js";

/**
 * Implementación Postgres del puerto UnitOfWork.
 *
 * Abre una transacción de DB con `db.transaction().execute(trx => …)` y crea
 * instancias de los repos ligadas a esa transacción. Todo lo que ocurre dentro
 * de `work` es atómico: si `work` lanza, Kysely hace rollback automático.
 *
 * `lockAccounts(ids)` ejecuta:
 *   SELECT id FROM accounts WHERE id IN (...) ORDER BY id FOR UPDATE
 *
 * El ORDER BY id es crítico: garantiza que dos transferencias concurrentes
 * A→B y B→A bloqueen las filas en el mismo orden, evitando deadlocks.
 * Ver ADR 0010 para el análisis completo.
 *
 * Nota: `Transaction<DB>` de Kysely extiende `Kysely<DB>`, por lo que
 * `Transaction<Database>` es directamente asignable a `Kysely<Database>`.
 * Los constructores de los repos Postgres aceptan `Kysely<Database>` y
 * funcionan sin cambios con el objeto de transacción.
 */
export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Kysely<Database>) {}

  async transaction<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx: Transaction<Database>) => {
      // Transaction<Database> extiende Kysely<Database>; asignación directa segura.
      const accounts = new PostgresAccountRepository(trx);
      const transactions = new PostgresTransactionRepository(trx);
      const idempotency = new PostgresIdempotencyRepository(trx);

      const ctx: TransactionalContext = {
        accounts,
        transactions,
        idempotency,
        lockAccounts: async (accountIds: string[]): Promise<void> => {
          if (accountIds.length === 0) return;

          // ORDER BY id → orden canónico → sin deadlocks entre A→B y B→A concurrentes.
          await trx
            .selectFrom("accounts")
            .select("id")
            .where("id", "in", [...accountIds].sort())
            .orderBy("id", "asc")
            .forUpdate()
            .execute();
        },
      };

      return work(ctx);
    });
  }
}
