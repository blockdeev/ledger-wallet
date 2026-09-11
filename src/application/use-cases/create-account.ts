import { Account, AccountType, createAccount } from "../../domain/account.js";
import { AccountRepository } from "../ports/account-repository.js";
import { AccountAlreadyExistsError } from "../errors.js";
import { Logger } from "../ports/logger.js";
import { MetricsRecorder } from "../ports/metrics-recorder.js";
import { Tracer } from "../ports/tracer.js";

export interface CreateAccountInput {
  id: string;
  currency: string;
  type: AccountType;
}

/**
 * Caso de uso: crear una nueva cuenta en el ledger.
 *
 * Reglas:
 *  - Si ya existe una cuenta con el mismo id → AccountAlreadyExistsError.
 *  - Si no existe, crea la cuenta con createAccount y la persiste.
 *
 * @throws AccountAlreadyExistsError si el id ya está registrado.
 */
export class CreateAccount {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly logger: Logger,
    private readonly metrics: MetricsRecorder,
    private readonly tracer: Tracer
  ) {}

  async execute(input: CreateAccountInput): Promise<Account> {
    return this.tracer.withSpan(
      "account.create",
      {
        accountId: input.id,
        currency: input.currency,
        type: input.type,
      },
      async () => {
        const existing = await this.accountRepo.findById(input.id);
        if (existing !== undefined) {
          this.logger.warn("account.already_exists", { accountId: input.id });
          throw new AccountAlreadyExistsError(input.id);
        }

        const account = createAccount(input.id, input.currency, input.type);
        await this.accountRepo.save(account);
        this.logger.info("account.created", {
          accountId: account.id,
          currency: account.currency,
          type: account.type,
        });
        this.metrics.recordAccountCreated();
        return account;
      }
    );
  }
}
