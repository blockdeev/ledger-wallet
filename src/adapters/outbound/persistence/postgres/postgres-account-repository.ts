import { Kysely } from "kysely";
import { Account } from "../../../../domain/account.js";
import { AccountRepository } from "../../../../application/ports/account-repository.js";
import { Database } from "./db.js";
import { accountToRow, rowToAccount } from "./mapper.js";

/**
 * Adapter Postgres del puerto AccountRepository.
 * Implementa los mismos contratos que InMemoryAccountRepository.
 *
 * Decisión de save(): usa INSERT simple (no upsert).
 * La unicidad del id la garantiza el caso de uso CreateAccount,
 * que ya chequea existencia antes de llamar save(). En Fase 3b,
 * si se agrega idempotencia de endpoints, se evaluará ON CONFLICT.
 */
export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async save(account: Account): Promise<void> {
    const row = accountToRow(account);
    await this.db
      .insertInto("accounts")
      .values(row)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          currency: row.currency,
          type: row.type,
        })
      )
      .execute();
  }

  async findById(id: string): Promise<Account | undefined> {
    const row = await this.db
      .selectFrom("accounts")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    return rowToAccount(row);
  }
}
