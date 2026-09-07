import { Account } from "../../../../domain/account.js";
import { AccountRepository } from "../../../../application/ports/account-repository.js";

/**
 * Implementación in-memory del puerto AccountRepository.
 * Usada en tests de casos de uso; sin dependencias externas.
 */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly store = new Map<string, Account>();

  async save(account: Account): Promise<void> {
    await Promise.resolve();
    this.store.set(account.id, account);
  }

  async findById(id: string): Promise<Account | undefined> {
    await Promise.resolve();
    return this.store.get(id);
  }
}
