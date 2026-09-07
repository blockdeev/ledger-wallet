import { CurrencyMismatchError } from "./errors.js";

/**
 * Value object que representa un monto monetario en unidades mínimas (centavos) como bigint.
 *
 * Decisiones de diseño:
 * - bigint: elimina overflow (vs number) y errores de punto flotante (vs float/Decimal).
 * - Unidades mínimas: un centavo de ARS = 1, un peso = 100. Nunca fraccionamos.
 * - Inmutable: todas las operaciones retornan una nueva instancia.
 * - Lleva su currency para que las operaciones entre monedas distintas fallen rápido.
 *
 * Ver ADR 0006-representacion-monetaria para el razonamiento completo.
 */
export class Money {
  readonly minor: bigint;
  readonly currency: string;

  private constructor(minor: bigint, currency: string) {
    this.minor = minor;
    this.currency = currency;
  }

  /** Crea un Money a partir de unidades mínimas (centavos). */
  static fromMinor(minor: bigint, currency: string): Money {
    return new Money(minor, currency);
  }

  /** Crea un Money con valor cero para la moneda dada. */
  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  // ── Arithmetic ────────────────────────────────────────────────────────────

  /** Suma este monto con otro. Ambos deben tener la misma currency. */
  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  /** Resta otro monto a este. Ambos deben tener la misma currency. */
  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /** Devuelve el opuesto de este monto (cambia de signo). */
  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  /** Devuelve el valor absoluto de este monto. */
  abs(): Money {
    return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency);
  }

  // ── Comparisons ───────────────────────────────────────────────────────────

  /** Retorna true si el monto es exactamente cero. */
  isZero(): boolean {
    return this.minor === 0n;
  }

  /** Retorna true si el monto es estrictamente menor que cero. */
  isNegative(): boolean {
    return this.minor < 0n;
  }

  /** Retorna true si el monto es estrictamente mayor que cero. */
  isPositive(): boolean {
    return this.minor > 0n;
  }

  /**
   * Retorna true si este monto es igual al otro.
   * Lanza CurrencyMismatchError si las currencies difieren.
   */
  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor === other.minor;
  }

  /**
   * Compara este monto con otro.
   * Retorna -1 si this < other, 0 si iguales, 1 si this > other.
   * Lanza CurrencyMismatchError si las currencies difieren.
   */
  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
