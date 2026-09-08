import { describe, it, expect } from "vitest";
import { AccountRepository } from "../../../src/application/ports/account-repository.js";
import { createAccount, AccountType } from "../../../src/domain/account.js";

/**
 * Contract test reutilizable para AccountRepository.
 *
 * Diseño: exporta una función que recibe un "setup" para crear un repositorio limpio.
 * Tanto el adapter in-memory como el de Postgres pasan este mismo contrato,
 * demostrando que Postgres es un drop-in del puerto (principio hexagonal).
 *
 * Uso:
 *   runAccountRepositoryContract(() => new InMemoryAccountRepository());
 *   runAccountRepositoryContract(() => new PostgresAccountRepository(db));
 */
export function runAccountRepositoryContract(
  makeRepo: () => AccountRepository | Promise<AccountRepository>
): void {
  describe("AccountRepository contract", () => {
    async function getRepo(): Promise<AccountRepository> {
      return makeRepo();
    }

    it("findById returns undefined for unknown id", async () => {
      const repo = await getRepo();
      const result = await repo.findById("does-not-exist");
      expect(result).toBeUndefined();
    });

    it("save and findById: persists and retrieves a CUSTOMER_WALLET account", async () => {
      const repo = await getRepo();
      const acc = createAccount("acc-contract-1", "ARS", AccountType.CUSTOMER_WALLET);
      await repo.save(acc);

      const found = await repo.findById("acc-contract-1");
      expect(found).toBeDefined();
      expect(found?.id).toBe("acc-contract-1");
      expect(found?.currency).toBe("ARS");
      expect(found?.type).toBe(AccountType.CUSTOMER_WALLET);
    });

    it("save and findById: persists a SYSTEM_CLEARING account", async () => {
      const repo = await getRepo();
      const acc = createAccount("acc-contract-2", "USD", AccountType.SYSTEM_CLEARING);
      await repo.save(acc);

      const found = await repo.findById("acc-contract-2");
      expect(found).toBeDefined();
      expect(found?.type).toBe(AccountType.SYSTEM_CLEARING);
    });

    it("save and findById: persists an EXTERNAL account", async () => {
      const repo = await getRepo();
      const acc = createAccount("acc-contract-3", "USD", AccountType.EXTERNAL);
      await repo.save(acc);

      const found = await repo.findById("acc-contract-3");
      expect(found).toBeDefined();
      expect(found?.type).toBe(AccountType.EXTERNAL);
    });

    it("allowsNegativeBalance is correct after round-trip", async () => {
      const repo = await getRepo();
      const wallet = createAccount("acc-contract-wallet", "ARS", AccountType.CUSTOMER_WALLET);
      const clearing = createAccount("acc-contract-clearing", "ARS", AccountType.SYSTEM_CLEARING);

      await repo.save(wallet);
      await repo.save(clearing);

      const foundWallet = await repo.findById("acc-contract-wallet");
      const foundClearing = await repo.findById("acc-contract-clearing");

      expect(foundWallet?.allowsNegativeBalance()).toBe(false);
      expect(foundClearing?.allowsNegativeBalance()).toBe(true);
    });

    it("save overwrites an existing account with the same id", async () => {
      const repo = await getRepo();
      const original = createAccount("acc-contract-overwrite", "ARS", AccountType.CUSTOMER_WALLET);
      await repo.save(original);

      const updated = createAccount("acc-contract-overwrite", "USD", AccountType.SYSTEM_CLEARING);
      await repo.save(updated);

      const found = await repo.findById("acc-contract-overwrite");
      expect(found?.currency).toBe("USD");
      expect(found?.type).toBe(AccountType.SYSTEM_CLEARING);
    });

    it("stores multiple accounts independently", async () => {
      const repo = await getRepo();
      await repo.save(createAccount("acc-contract-multi-a", "ARS", AccountType.CUSTOMER_WALLET));
      await repo.save(createAccount("acc-contract-multi-b", "USD", AccountType.EXTERNAL));

      const a = await repo.findById("acc-contract-multi-a");
      const b = await repo.findById("acc-contract-multi-b");

      expect(a?.currency).toBe("ARS");
      expect(b?.currency).toBe("USD");
    });
  });
}
