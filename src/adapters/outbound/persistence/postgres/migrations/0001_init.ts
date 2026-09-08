import { Kysely, sql } from "kysely";

/**
 * Migración 0001: esquema inicial del ledger.
 *
 * Diseño:
 * - accounts: representa las cuentas del ledger.
 * - ledger_transactions: cabecera de cada transacción de doble entrada.
 * - postings: los movimientos individuales con signo sobre una cuenta.
 *   El ledger es append-only: no se hacen UPDATE ni DELETE sobre postings.
 *
 * El monto se almacena como BIGINT (unidades mínimas, mismo semántica que Money.minor).
 * pg devuelve BIGINT como string; el mapper parsea a bigint de JS.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // Tabla de cuentas con CHECK en type para los valores válidos de AccountType
  await db.schema
    .createTable("accounts")
    .addColumn("id", "text", (col) => col.primaryKey().notNull())
    .addColumn("currency", "text", (col) => col.notNull())
    .addColumn("type", "text", (col) =>
      col
        .notNull()
        .check(
          sql`type IN ('CUSTOMER_WALLET', 'SYSTEM_CLEARING', 'EXTERNAL')`
        )
    )
    .execute();

  // Tabla de cabeceras de transacciones (append-only)
  await db.schema
    .createTable("ledger_transactions")
    .addColumn("id", "text", (col) => col.primaryKey().notNull())
    .addColumn("occurred_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  // Tabla de postings con FKs a ledger_transactions y accounts
  await db.schema
    .createTable("postings")
    .addColumn("id", "bigserial", (col) => col.primaryKey().notNull())
    .addColumn("transaction_id", "text", (col) =>
      col.notNull().references("ledger_transactions.id")
    )
    .addColumn("account_id", "text", (col) =>
      col.notNull().references("accounts.id")
    )
    .addColumn("amount", "bigint", (col) => col.notNull())
    .addColumn("currency", "text", (col) => col.notNull())
    .execute();

  // Índice en postings.account_id para acelerar listByAccount
  await db.schema
    .createIndex("postings_account_id_idx")
    .on("postings")
    .column("account_id")
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("postings").execute();
  await db.schema.dropTable("ledger_transactions").execute();
  await db.schema.dropTable("accounts").execute();
}
