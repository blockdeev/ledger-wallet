import { Money } from "./money.js";
import { Account } from "./account.js";
import { LedgerTransaction } from "./ledger-transaction.js";
import { OverdraftError } from "./errors.js";

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
 *  - Todo-o-nada: si alguna cuenta sin permiso de sobregiro quedaría negativa,
 *    se lanza OverdraftError y los saldos originales se mantienen intactos.
 *  - Cuenta sin saldo previo: arranca en Money.zero(currency de la transacción).
 *  - Cuenta desconocida (lookup retorna undefined): sin info de política, NO se
 *    aplica restricción de sobregiro. Se aplica el cambio sin validar.
 *
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

  // Calcular los nuevos saldos candidatos (sin aplicar aún)
  const draft = new Map<string, Money>(balances);

  for (const posting of tx.postings) {
    const current = draft.get(posting.accountId) ?? Money.zero(currency);
    const newBalance = current.plus(posting.amount);
    draft.set(posting.accountId, newBalance);
  }

  // Validar política de sobregiro para cada cuenta afectada
  for (const posting of tx.postings) {
    const newBalance = draft.get(posting.accountId);
    if (!newBalance) continue; // no debería ocurrir

    if (newBalance.isNegative()) {
      const account = lookup(posting.accountId);
      // Si la cuenta es conocida y NO permite negativos: OverdraftError
      if (account !== undefined && !account.allowsNegativeBalance()) {
        throw new OverdraftError(posting.accountId);
      }
    }
  }

  return draft;
}
