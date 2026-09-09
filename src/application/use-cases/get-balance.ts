import { Money } from "../../domain/money.js";
import { AccountRepository } from "../ports/account-repository.js";
import { TransactionRepository } from "../ports/transaction-repository.js";
import { AccountNotFoundError } from "../errors.js";
import { deriveBalance } from "../balance-derivation.js";
import { Logger } from "../ports/logger.js";

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
  private readonly accountRepo: AccountRepository;
  private readonly txRepo: TransactionRepository;

  constructor(
    accountRepo: AccountRepository,
    txRepo: TransactionRepository,
    // Logger recibido por consistencia con la interfaz app-scoped de la Fase 4.
    // Las lecturas de balance no se instrumentan (generan ruido; fuera de alcance).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _logger: Logger
  ) {
    this.accountRepo = accountRepo;
    this.txRepo = txRepo;
  }

  async execute(input: GetBalanceInput): Promise<Money> {
    const account = await this.accountRepo.findById(input.accountId);
    if (account === undefined) {
      throw new AccountNotFoundError(input.accountId);
    }

    const txs = await this.txRepo.listAll();
    return deriveBalance(input.accountId, account, txs);
  }
}
