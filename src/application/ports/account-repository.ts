import { Account } from "../../domain/account.js";

/**
 * Puerto de salida: abstracción de persistencia de cuentas.
 * Los casos de uso dependen de esta interfaz; los adapters la implementan.
 */
export interface AccountRepository {
  /** Persiste una cuenta. Si ya existe con el mismo id, la sobreescribe. */
  save(account: Account): Promise<void>;
  /** Busca una cuenta por id. Retorna undefined si no existe. */
  findById(id: string): Promise<Account | undefined>;
}
