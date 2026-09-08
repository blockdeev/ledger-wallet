import { Money } from "../../domain/money.js";
import { LedgerTransaction, createTransaction } from "../../domain/ledger-transaction.js";
import { createPosting } from "../../domain/posting.js";
import { applyTransaction } from "../../domain/balances.js";
import { UnitOfWork } from "../ports/unit-of-work.js";
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
 * Caso de uso: transferir fondos entre dos cuentas de forma atómica y segura
 * bajo concurrencia.
 *
 * Todo el bloque corre dentro de `uow.transaction(ctx => …)`. El adapter Postgres
 * del UoW abre una transacción de DB y adquiere locks de fila sobre las cuentas
 * antes de derivar saldos, garantizando que dos transferencias concurrentes sobre
 * las mismas cuentas se serialicen correctamente.
 *
 * Pasos (dentro de la transacción):
 *  a. `ctx.lockAccounts([fromId, toId])` — lock pesimista en orden canónico.
 *  b. Buscar ambas cuentas; si falta alguna → AccountNotFoundError.
 *  c. Derivar saldos actuales de ambas cuentas con listByAccount + deriveBalance.
 *  d. Construir la LedgerTransaction y aplicar con applyTransaction (valida sobregiro).
 *     Si lanza OverdraftError, el throw aborta la transacción → rollback automático.
 *  e. Persistir la tx. Devolver la LedgerTransaction.
 *
 * @throws AccountNotFoundError si alguna de las cuentas no existe.
 * @throws OverdraftError si la cuenta origen es CUSTOMER_WALLET y no tiene fondos.
 */
export class Transfer {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: TransferInput): Promise<LedgerTransaction> {
    return this.uow.transaction(async (ctx) => {
      // a. Lock pesimista en orden canónico (evita deadlocks A→B vs B→A concurrentes)
      await ctx.lockAccounts([input.fromAccountId, input.toAccountId]);

      // b. Buscar ambas cuentas
      const [fromAccount, toAccount] = await Promise.all([
        ctx.accounts.findById(input.fromAccountId),
        ctx.accounts.findById(input.toAccountId),
      ]);

      if (fromAccount === undefined) {
        throw new AccountNotFoundError(input.fromAccountId);
      }
      if (toAccount === undefined) {
        throw new AccountNotFoundError(input.toAccountId);
      }

      // c. Derivar saldos actuales de las cuentas involucradas
      const [fromTxs, toTxs] = await Promise.all([
        ctx.transactions.listByAccount(input.fromAccountId),
        ctx.transactions.listByAccount(input.toAccountId),
      ]);

      const fromBalance = deriveBalance(input.fromAccountId, fromAccount, fromTxs);
      const toBalance = deriveBalance(input.toAccountId, toAccount, toTxs);

      // Sembrar el mapa con saldos reales (crítico: evita falsos OverdraftError)
      const seedBalances = new Map([
        [input.fromAccountId, fromBalance],
        [input.toAccountId, toBalance],
      ]);

      // d. Construir la transacción balanceada
      const tx = createTransaction({
        id: input.id,
        postings: [
          createPosting(input.fromAccountId, input.amount.negate()),
          createPosting(input.toAccountId, input.amount),
        ],
        occurredAt: input.occurredAt ?? new Date(),
      });

      // Lookup de las cuentas ya buscadas (ambas conocidas)
      const accountLookup = (id: string) => {
        if (id === input.fromAccountId) return fromAccount;
        if (id === input.toAccountId) return toAccount;
        return undefined;
      };

      // Puede lanzar OverdraftError; si lo hace, el throw aborta la transacción de DB → rollback
      applyTransaction(seedBalances, tx, accountLookup);

      // e. Persistir y devolver
      await ctx.transactions.append(tx);
      return tx;
    });
  }
}
