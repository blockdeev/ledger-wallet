/**
 * Jerarquía de errores de dominio del ledger/wallet.
 * El dominio habla su propio idioma de errores — sin códigos HTTP, sin dependencias de infra.
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Mantiene el stack trace correcto en V8 (captureStackTrace es extensión de V8/Node.js)
    const nodeError = Error as unknown as { captureStackTrace?: (t: object, c: unknown) => void };
    if (typeof nodeError.captureStackTrace === "function") {
      nodeError.captureStackTrace(this, this.constructor);
    }
  }
}

/** Se lanza cuando se intentan operar montos en distintas monedas. */
export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super(
      `Currency mismatch: cannot mix '${expected}' and '${actual}'. All amounts in an operation must share the same currency.`
    );
  }
}

/** Se lanza cuando un Posting tiene monto cero (no tiene sentido económico). */
export class NonZeroPostingError extends DomainError {
  constructor() {
    super("A posting amount must be non-zero.");
  }
}

/** Se lanza cuando una LedgerTransaction tiene menos de 2 postings. */
export class InsufficientPostingsError extends DomainError {
  constructor(count: number) {
    super(
      `A transaction requires at least 2 postings; got ${count.toString()}.`
    );
  }
}

/** Se lanza cuando la suma de los postings en una LedgerTransaction no es cero. */
export class UnbalancedTransactionError extends DomainError {
  constructor(sum: bigint) {
    super(
      `Transaction is unbalanced: postings sum to ${sum.toString()} instead of 0. ` +
        `Double-entry requires debits == credits.`
    );
  }
}

/** Se lanza cuando aplicar una transacción dejaría una cuenta sin permiso de sobregiro con saldo negativo. */
export class OverdraftError extends DomainError {
  constructor(accountId: string) {
    super(
      `Overdraft violation: account '${accountId}' does not allow negative balances.`
    );
  }
}
