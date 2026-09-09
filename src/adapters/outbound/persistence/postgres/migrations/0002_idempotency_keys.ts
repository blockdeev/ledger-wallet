import { Kysely, sql } from "kysely";

/**
 * Migración 0002: tabla de claves de idempotencia.
 *
 * Diseño deliberado SIN FOREIGN KEY a ledger_transactions:
 *
 *   Con la estrategia reserve-first (ver ADR 0011), la fila de idempotencia
 *   se inserta ANTES de que exista la transacción del ledger. La secuencia
 *   dentro de una única transacción de DB es:
 *
 *     1. INSERT idempotency_keys (key, transaction_id, fingerprint)  ← reserva
 *     2. INSERT ledger_transactions (id, ...)                        ← crea la tx
 *     3. INSERT postings (...)
 *
 *   Una FK referencial (idempotency_keys.transaction_id → ledger_transactions.id)
 *   rechazaría el INSERT del paso 1 porque la fila referenciada aún no existe.
 *   Todo ocurre dentro de la misma transacción de DB, por lo que Postgres no
 *   vería la fila de ledger_transactions al validar la FK.
 *
 *   La integridad la garantiza la aplicación:
 *     - `transaction_id` se escribe desde `input.id`, el mismo id con que
 *       se crea la LedgerTransaction, dentro de la misma transacción de DB.
 *     - Si la transferencia falla después de la reserva, el rollback deshace
 *       también la reserva → la clave no queda "quemada".
 *
 *   Este es el patrón estándar para tablas de idempotencia (side-log operativo,
 *   no parte del libro contable). Ver ADR 0011.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("idempotency_keys")
    .addColumn("key", "text", (col) => col.primaryKey().notNull())
    .addColumn("transaction_id", "text", (col) => col.notNull())
    // SIN REFERENCES: ver comentario de diseño arriba
    .addColumn("fingerprint", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("idempotency_keys").execute();
}
