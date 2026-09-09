import { LedgerTransaction } from "../../domain/ledger-transaction.js";

/**
 * Puerto de salida: abstracción de persistencia de transacciones del ledger.
 * Append-only: las transacciones nunca se modifican ni eliminan.
 */
export interface TransactionRepository {
  /** Agrega una transacción al log. */
  append(tx: LedgerTransaction): Promise<void>;
  /** Busca una transacción por id. Devuelve `undefined` si no existe. */
  findById(id: string): Promise<LedgerTransaction | undefined>;
  /** Lista todas las transacciones donde participa una cuenta dada. */
  listByAccount(accountId: string): Promise<LedgerTransaction[]>;
  /** Lista todas las transacciones del ledger. */
  listAll(): Promise<LedgerTransaction[]>;
}
