import { Money } from "./money.js";
import { Account } from "./account.js";
import { LedgerTransaction } from "./ledger-transaction.js";
import { OverdraftError, UnknownAccountError } from "./errors.js";

/**
 * Mapa de saldos: accountId -> Money (saldo actual).
 * El mapa es inmutable desde la perspectiva del dominio; applyTransaction retorna uno nuevo.
 */
export type BalancesMap = ReadonlyMap<string, Money>;

/**
 * Función de lookup para obtener la info de una cuenta dado su ID.
 * Retorna undefined si la cuenta no se conoce en el contexto actual.
 */
export type AccountLookup = (accountId: string) => Account | undefined;

/**
 * Aplica una LedgerTransaction a un mapa de saldos y retorna los NUEVOS saldos.
 *
 * Semántica:
 *  - Inmutable: el mapa original NO se modifica.
 *  - Todo-o-nada: si alguna validación falla, se lanza el error correspondiente
 *    y los saldos originales se mantienen intactos.
 *  - Cuenta sin saldo previo: arranca en Money.zero(currency de la transacción).
 *  - Cuenta desconocida (lookup retorna undefined): lanza UnknownAccountError.
 *    TODAS las cuentas referenciadas por postings deben estar en el lookup.
 *
 * Orden de validaciones:
 *  1. Existencia de cuentas (UnknownAccountError si alguna no está en el lookup).
 *  2. Política de sobregiro (OverdraftError si una CUSTOMER_WALLET quedaría negativa).
 *
 * @throws UnknownAccountError si algún posting referencia una cuenta desconocida.
 * @throws OverdraftError si una CUSTOMER_WALLET quedaría con saldo negativo.
 */
export function applyTransaction(
  balances: BalancesMap,
  tx: LedgerTransaction,
  lookup: AccountLookup
): Map<string, Money> {
  // Obtener la currency de la transacción del primer posting
  const firstPosting = tx.postings[0];
  if (!firstPosting) {
    // No debería ocurrir: createTransaction ya garantiza >= 2 postings
    throw new Error("Transaction has no postings (internal invariant violated)");
  }
  const currency = firstPosting.amount.currency;

  // Validación 1: todas las cuentas referenciadas por postings deben existir en el lookup.
  // Esto va ANTES de calcular saldos candidatos (todo-o-nada: si alguna falta, no se aplica nada).
  for (const posting of tx.postings) {
    const account = lookup(posting.accountId);
    if (account === undefined) {
      throw new UnknownAccountError(posting.accountId);
    }
  }

  // Calcular los nuevos saldos candidatos (sin aplicar aún)
  const draft = new Map<string, Money>(balances);

  for (const posting of tx.postings) {
    const current = draft.get(posting.accountId) ?? Money.zero(currency);
    const newBalance = current.plus(posting.amount);
    draft.set(posting.accountId, newBalance);
  }

  // Validación 2: política de sobregiro para cada cuenta afectada.
  // En este punto sabemos que todas las cuentas existen (validación 1 ya pasó).
  for (const posting of tx.postings) {
    const newBalance = draft.get(posting.accountId);
    if (!newBalance) continue; // no debería ocurrir

    if (newBalance.isNegative()) {
      const account = lookup(posting.accountId);
      // account siempre es defined aquí (validación 1 lo garantiza)
      if (account !== undefined && !account.allowsNegativeBalance()) {
        throw new OverdraftError(posting.accountId);
      }
    }
  }

  return draft;
}
