/**
 * Mapper entre entidades de dominio y filas de base de datos.
 *
 * Responsabilidades:
 * - Account ↔ AccountRow
 * - LedgerTransaction ↔ LedgerTransactionRow + PostingRow[]
 *
 * Decisión clave (bigint/int8):
 *   pg devuelve columnas BIGINT (int8) como string para preservar precisión
 *   (Number.MAX_SAFE_INTEGER < 2^53-1 < 2^63-1).
 *   Se parsea con BigInt(str) → bigint de JS, que es la misma representación
 *   que usa Money.minor. NUNCA se convierte a number.
 *
 * Reconstrucción de LedgerTransaction a través del factory del dominio:
 *   Se usa createTransaction() y createPosting() para re-verificar invariantes
 *   (balance cero, misma currency, etc.) al reconstruir desde DB.
 *   Esto garantiza que si algo se corrompiera en DB, lo detectaríamos al leer.
 */

import { Selectable } from "kysely";
import { Account, AccountType, createAccount } from "../../../../domain/account.js";
import {
  LedgerTransaction,
  createTransaction,
} from "../../../../domain/ledger-transaction.js";
import { createPosting } from "../../../../domain/posting.js";
import { Money } from "../../../../domain/money.js";
import {
  AccountRow,
  LedgerTransactionRow,
  PostingRow,
} from "./db.js";

// Kysely's Selectable<T> strips Generated<T> wrappers → plain T
export type SelectableAccount = Selectable<AccountRow>;
export type SelectableTransaction = Selectable<LedgerTransactionRow>;

// For postings we only select a subset of columns (no `id`, no `created_at`)
export type SelectablePostingSubset = Pick<
  Selectable<PostingRow>,
  "transaction_id" | "account_id" | "amount" | "currency"
>;

// ── Account ──────────────────────────────────────────────────────────────────

export function accountToRow(account: Account): Omit<SelectableAccount, never> {
  return {
    id: account.id,
    currency: account.currency,
    type: account.type,
    // created_at is not in AccountRow; nothing to omit
  };
}

export function rowToAccount(row: SelectableAccount): Account {
  // Validate that the type stored in DB is a known AccountType
  const validTypes: string[] = Object.values(AccountType);
  if (!validTypes.includes(row.type)) {
    throw new Error(
      `Unknown account type from DB: "${row.type}". Expected one of: ${validTypes.join(", ")}`
    );
  }
  return createAccount(row.id, row.currency, row.type as AccountType);
}

// ── LedgerTransaction ────────────────────────────────────────────────────────

export interface TransactionInsertRow {
  id: string;
  occurred_at: Date;
}

export interface PostingInsertRow {
  transaction_id: string;
  account_id: string;
  amount: string;
  currency: string;
}

export function transactionToRows(tx: LedgerTransaction): {
  txRow: TransactionInsertRow;
  postingRows: PostingInsertRow[];
} {
  const txRow: TransactionInsertRow = {
    id: tx.id,
    occurred_at: tx.occurredAt,
  };

  const postingRows: PostingInsertRow[] = tx.postings.map((p) => ({
    transaction_id: tx.id,
    account_id: p.accountId,
    amount: p.amount.minor.toString(),
    currency: p.amount.currency,
  }));

  return { txRow, postingRows };
}

/**
 * Reconstruye una LedgerTransaction desde sus filas de DB.
 * Usa createTransaction y createPosting para re-verificar invariantes.
 */
export function rowsToTransaction(data: {
  tx: SelectableTransaction;
  postings: SelectablePostingSubset[];
}): LedgerTransaction {
  const postings = data.postings.map((row) =>
    createPosting(
      row.account_id,
      // Parsear el string de pg a bigint de JS (NUNCA a number)
      Money.fromMinor(BigInt(row.amount), row.currency)
    )
  );

  return createTransaction({
    id: data.tx.id,
    postings,
    occurredAt: data.tx.occurred_at,
  });
}

/**
 * Agrupa filas de postings por transaction_id y las empareja con sus filas de tx.
 * Útil para reconstruir múltiples transacciones de una query JOIN.
 */
export function groupPostingsByTransaction(
  txRows: SelectableTransaction[],
  postingRows: SelectablePostingSubset[]
): LedgerTransaction[] {
  // Agrupar postings por transaction_id
  const postingsByTxId = new Map<string, SelectablePostingSubset[]>();
  for (const posting of postingRows) {
    const existing = postingsByTxId.get(posting.transaction_id) ?? [];
    existing.push(posting);
    postingsByTxId.set(posting.transaction_id, existing);
  }

  return txRows.map((tx) => {
    const txPostings = postingsByTxId.get(tx.id) ?? [];
    return rowsToTransaction({ tx, postings: txPostings });
  });
}
