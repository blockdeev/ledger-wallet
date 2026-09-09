import { Kysely, PostgresDialect, Generated } from "kysely";
import pg from "pg";

/**
 * Esquema de la base de datos para Kysely.
 * Refleja las tablas creadas por las migraciones.
 *
 * Nota sobre Generated<T>: marca las columnas que tienen DEFAULT en DB
 * (autogeneradas en INSERT), por lo que son opcionales al insertar.
 */

export interface AccountRow {
  id: string;
  currency: string;
  type: string;
}

export interface LedgerTransactionRow {
  id: string;
  occurred_at: Date;
  /** Generada por DEFAULT now() en DB */
  created_at: Generated<Date>;
}

export interface PostingRow {
  /** Generada por BIGSERIAL */
  id: Generated<bigint>;
  transaction_id: string;
  account_id: string;
  /**
   * BIGINT de Postgres. pg devuelve int8 como string para no perder precisión;
   * el mapper parsea a bigint de JS con BigInt(amountString).
   */
  amount: string;
  currency: string;
}

export interface IdempotencyKeyRow {
  key: string;
  transaction_id: string;
  fingerprint: string;
  /** Generada por DEFAULT now() en DB */
  created_at: Generated<Date>;
}

export interface Database {
  accounts: AccountRow;
  ledger_transactions: LedgerTransactionRow;
  postings: PostingRow;
  idempotency_keys: IdempotencyKeyRow;
}

/**
 * Crea una instancia de Kysely conectada a Postgres via pg Pool.
 * Llamar db.destroy() en el teardown de tests para cerrar el pool.
 */
export function createDb(databaseUrl: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
