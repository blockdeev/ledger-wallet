import { Account } from "../domain/account.js";
import { Money } from "../domain/money.js";
import { LedgerTransaction } from "../domain/ledger-transaction.js";

/**
 * Derivación de saldo a partir del historial de transacciones.
 *
 * Suma todos los postings de la cuenta `accountId` sobre el conjunto de
 * transacciones `txs`. Si no hay movimientos, retorna Money.zero con la
 * currency de la cuenta.
 *
 * Esta función es pura: no tiene efectos secundarios ni accede a repositorios.
 * Usarla tanto en GetBalance como en Transfer garantiza una sola fuente de verdad.
 */
export function deriveBalance(
  accountId: string,
  account: Account,
  txs: LedgerTransaction[]
): Money {
  return txs
    .flatMap((tx) => tx.postings)
    .filter((posting) => posting.accountId === accountId)
    .reduce(
      (acc, posting) => acc.plus(posting.amount),
      Money.zero(account.currency)
    );
}
