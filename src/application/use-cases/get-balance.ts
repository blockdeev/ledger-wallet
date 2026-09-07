import { Money } from "../../domain/money.js";
import { AccountRepository } from "../ports/account-repository.js";
import { TransactionRepository } from "../ports/transaction-repository.js";
import { AccountNotFoundError } from "../errors.js";
import { deriveBalance } from "../balance-derivation.js";

export interface GetBalanceInput {
  accountId: string;
}

/**
 * Caso de uso: obtener el saldo actual de una cuenta.
 *
 * El saldo se DERIVA del historial de transacciones (event-sourcing lite),
 * no se lee de una columna mutable. Garantiza auditabilidad y consistencia.
 *
 * Reglas:
 *  - Si la cuenta no existe → AccountNotFoundError.
 *  - Si existe pero no tiene movimientos → Money.zero(currency).
 *  - Si tiene movimientos → suma de todos los postings para esa cuenta.
 *
 * @throws AccountNotFoundError si la cuenta no existe.
 */
export class GetBalance {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly txRepo: TransactionRepository
  ) {}

  async execute(input: GetBalanceInput): Promise<Money> {
    const account = await this.accountRepo.findById(input.accountId);
    if (account === undefined) {
      throw new AccountNotFoundError(input.accountId);
    }

    const txs = await this.txRepo.listAll();
    return deriveBalance(input.accountId, account, txs);
  }
}
