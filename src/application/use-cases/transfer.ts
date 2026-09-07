import { Money } from "../../domain/money.js";
import { LedgerTransaction, createTransaction } from "../../domain/ledger-transaction.js";
import { createPosting } from "../../domain/posting.js";
import { applyTransaction } from "../../domain/balances.js";
import { AccountRepository } from "../ports/account-repository.js";
import { TransactionRepository } from "../ports/transaction-repository.js";
import { AccountNotFoundError } from "../errors.js";
import { deriveBalance } from "../balance-derivation.js";

export interface TransferInput {
  /** Id de la LedgerTransaction a crear. */
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: Money;
  occurredAt?: Date;
}

/**
 * Caso de uso: transferir fondos entre dos cuentas.
 *
 * Pasos:
 *  a. Buscar ambas cuentas; si falta alguna → AccountNotFoundError.
 *  b. Construir una LedgerTransaction balanceada (from: -amount, to: +amount).
 *  c. Derivar los saldos actuales de ambas cuentas y aplicar la tx con
 *     applyTransaction (valida sobregiro; OverdraftError si falla).
 *     El BalancesMap se siembra con los saldos derivados reales para que el
 *     chequeo de sobregiro sea correcto.
 *  d. Persistir la tx. Devolver la LedgerTransaction.
 *
 * @throws AccountNotFoundError si alguna de las cuentas no existe.
 * @throws OverdraftError si la cuenta origen es CUSTOMER_WALLET y no tiene fondos.
 */
export class Transfer {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly txRepo: TransactionRepository
  ) {}

  async execute(input: TransferInput): Promise<LedgerTransaction> {
    // a. Buscar ambas cuentas
    const [fromAccount, toAccount] = await Promise.all([
      this.accountRepo.findById(input.fromAccountId),
      this.accountRepo.findById(input.toAccountId),
    ]);

    if (fromAccount === undefined) {
      throw new AccountNotFoundError(input.fromAccountId);
    }
    if (toAccount === undefined) {
      throw new AccountNotFoundError(input.toAccountId);
    }

    // b. Construir la transacción balanceada
    const tx = createTransaction({
      id: input.id,
      postings: [
        createPosting(input.fromAccountId, input.amount.negate()),
        createPosting(input.toAccountId, input.amount),
      ],
      occurredAt: input.occurredAt ?? new Date(),
    });

    // c. Derivar saldos actuales y aplicar la transacción (valida sobregiro)
    const allTxs = await this.txRepo.listAll();
    const fromBalance = deriveBalance(input.fromAccountId, fromAccount, allTxs);
    const toBalance = deriveBalance(input.toAccountId, toAccount, allTxs);

    // Sembrar el mapa con saldos reales (crítico: evita falsos OverdraftError)
    const seedBalances = new Map([
      [input.fromAccountId, fromBalance],
      [input.toAccountId, toBalance],
    ]);

    // Construir el lookup a partir de las cuentas ya buscadas (ambas conocidas)
    const accountLookup = (id: string) => {
      if (id === input.fromAccountId) return fromAccount;
      if (id === input.toAccountId) return toAccount;
      return undefined;
    };

    // Puede lanzar OverdraftError; si lo hace, no persistimos nada
    applyTransaction(seedBalances, tx, accountLookup);

    // d. Persistir y devolver
    await this.txRepo.append(tx);
    return tx;
  }
}
