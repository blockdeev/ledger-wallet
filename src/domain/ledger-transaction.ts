import { Money } from "./money.js";
import { Posting } from "./posting.js";
import {
  CurrencyMismatchError,
  InsufficientPostingsError,
  UnbalancedTransactionError,
} from "./errors.js";

/**
 * LedgerTransaction es el agregado raíz del modelo de partida doble.
 * Un conjunto de Postings que SIEMPRE suman cero, sobre la MISMA moneda.
 *
 * Invariantes (todos verificados al construir):
 *  1. Al menos 2 postings.
 *  2. Todos los postings en la misma currency.
 *  3. Ningún posting con monto cero (garantizado por createPosting, pero re-chequeado).
 *  4. La suma de todos los montos == 0 (transacción balanceada).
 *
 * Ver ADR 0007-modelo-partida-doble.
 */
export interface LedgerTransaction {
  readonly id: string;
  readonly postings: readonly Posting[];
  readonly occurredAt: Date;
}

export interface CreateTransactionInput {
  id: string;
  postings: Posting[];
  occurredAt: Date;
}

/**
 * Construye una LedgerTransaction validando todos los invariantes.
 *
 * @throws InsufficientPostingsError si postings.length < 2
 * @throws CurrencyMismatchError si los postings tienen distintas currencies
 * @throws UnbalancedTransactionError si la suma de montos != 0
 */
export function createTransaction(input: CreateTransactionInput): LedgerTransaction {
  const { id, postings, occurredAt } = input;

  // Invariante 1: mínimo 2 postings
  if (postings.length < 2) {
    throw new InsufficientPostingsError(postings.length);
  }

  // Invariante 2: todos la misma currency
  // El primer posting define la currency de referencia
  const firstPosting = postings[0];
  if (!firstPosting) {
    throw new InsufficientPostingsError(0);
  }
  const referenceCurrency = firstPosting.amount.currency;

  for (const posting of postings) {
    if (posting.amount.currency !== referenceCurrency) {
      throw new CurrencyMismatchError(referenceCurrency, posting.amount.currency);
    }
  }

  // Invariante 4: suma == 0 (balanceada)
  // Invariante 3 (monto != 0) ya se garantiza en createPosting, pero la suma valida el todo
  const sum = postings.reduce((acc, p) => acc + p.amount.minor, 0n);
  if (sum !== 0n) {
    throw new UnbalancedTransactionError(sum);
  }

  return Object.freeze({
    id,
    postings: Object.freeze([...postings]),
    occurredAt,
  });
}

/**
 * Retorna la currency de la transacción (derivada del primer posting).
 * Útil para obtener la currency sin iterar.
 */
export function transactionCurrency(tx: LedgerTransaction): string {
  const first = tx.postings[0];
  if (!first) {
    throw new Error("Transaction has no postings (invariant violated)");
  }
  return first.amount.currency;
}

/**
 * Retorna el monto total de los postings con signo positivo (créditos).
 * En una transacción balanceada, esto es igual al total de débitos en valor absoluto.
 */
export function totalCredits(tx: LedgerTransaction): Money {
  return tx.postings
    .filter((p) => p.amount.isPositive())
    .reduce(
      (acc, p) => acc.plus(p.amount),
      Money.zero(transactionCurrency(tx))
    );
}
