import { Account, AccountType, createAccount } from "../../domain/account.js";
import { AccountRepository } from "../ports/account-repository.js";
import { AccountAlreadyExistsError } from "../errors.js";
import { Logger } from "../ports/logger.js";

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
    private readonly logger: Logger
  ) {}

  async execute(input: CreateAccountInput): Promise<Account> {
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
    return account;
  }
}
