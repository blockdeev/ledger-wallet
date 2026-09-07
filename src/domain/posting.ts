import { Money } from "./money.js";
import { NonZeroPostingError } from "./errors.js";

/**
 * Un Posting representa la incidencia de una transacción sobre UNA cuenta.
 * El monto tiene signo: positivo suma al saldo, negativo lo resta.
 * El monto nunca puede ser cero (no tiene efecto económico).
 *
 * Ver ADR 0007-modelo-partida-doble para el razonamiento sobre débito/crédito firmado.
 */
export interface Posting {
  readonly accountId: string;
  readonly amount: Money;
}

/**
 * Crea un Posting validando el invariante de monto no-cero.
 * @throws NonZeroPostingError si amount es cero.
 */
export function createPosting(accountId: string, amount: Money): Posting {
  if (amount.isZero()) {
    throw new NonZeroPostingError();
  }
  return Object.freeze({ accountId, amount });
}
