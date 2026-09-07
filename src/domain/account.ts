/**
 * Entidad Account y su tipo, con política de sobregiro derivada del tipo.
 */

/** Tipos de cuenta soportados por el ledger. */
export const AccountType = {
  /** Billetera de un cliente. No puede quedar con saldo negativo. */
  CUSTOMER_WALLET: "CUSTOMER_WALLET",
  /** Cuenta interna del sistema (ej. cámara de compensación). Puede ser negativa. */
  SYSTEM_CLEARING: "SYSTEM_CLEARING",
  /** Cuenta externa (ej. banco, proveedor). Puede ser negativa. */
  EXTERNAL: "EXTERNAL",
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

/**
 * Entidad que representa una cuenta en el ledger.
 * La política de sobregiro se deriva del tipo de cuenta.
 */
export interface Account {
  readonly id: string;
  readonly currency: string;
  readonly type: AccountType;

  /**
   * Retorna true si la cuenta puede tener saldo negativo.
   * CUSTOMER_WALLET -> false (no se permite sobregiro).
   * SYSTEM_CLEARING, EXTERNAL -> true (pueden operar en negativo).
   */
  allowsNegativeBalance(): boolean;
}

/** Crea una Account con la política de sobregiro correcta para su tipo. */
export function createAccount(
  id: string,
  currency: string,
  type: AccountType
): Account {
  return {
    id,
    currency,
    type,
    allowsNegativeBalance(): boolean {
      return type !== AccountType.CUSTOMER_WALLET;
    },
  };
}
