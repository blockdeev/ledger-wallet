import { Money } from "../../domain/money.js";
import { AccountRepository } from "../ports/account-repository.js";
import { TransactionRepository } from "../ports/transaction-repository.js";
import { AccountNotFoundError } from "../errors.js";
import { deriveBalance } from "../balance-derivation.js";
import { Logger } from "../ports/logger.js";
import { MetricsRecorder } from "../ports/metrics-recorder.js";
import { Tracer } from "../ports/tracer.js";

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
  private readonly tracer: Tracer;

  constructor(
    accountRepo: AccountRepository,
    txRepo: TransactionRepository,
    // Logger recibido por consistencia con la interfaz app-scoped de la Fase 4.
    // Las lecturas de balance no se instrumentan (generan ruido; fuera de alcance).
    _logger: Logger,
    // MetricsRecorder recibido por consistencia con la API app-scoped de la Fase 5.
    // GetBalance no registra métricas (ver brief y ADR 0013).
    _metrics?: MetricsRecorder,
    tracer?: Tracer
  ) {
    this.accountRepo = accountRepo;
    this.txRepo = txRepo;
    this.tracer = tracer ?? {
      async withSpan<T>(_n: string, _a: Record<string, string | number | boolean>, fn: () => Promise<T>): Promise<T> {
        return fn();
      },
    };
  }

  async execute(input: GetBalanceInput): Promise<Money> {
    return this.tracer.withSpan(
      "balance.get",
      { accountId: input.accountId },
      async () => {
        const account = await this.accountRepo.findById(input.accountId);
        if (account === undefined) {
          throw new AccountNotFoundError(input.accountId);
        }

        const txs = await this.txRepo.listAll();
        return deriveBalance(input.accountId, account, txs);
      }
    );
  }
}
