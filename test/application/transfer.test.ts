import { describe, it, expect, beforeEach } from "vitest";
import { Transfer } from "../../src/application/use-cases/transfer.js";
import { GetBalance } from "../../src/application/use-cases/get-balance.js";
import { CreateAccount } from "../../src/application/use-cases/create-account.js";
import { InMemoryAccountRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-transaction-repository.js";
import { InMemoryUnitOfWork } from "../../src/adapters/outbound/persistence/in-memory/in-memory-unit-of-work.js";
import { AccountType } from "../../src/domain/account.js";
import { Money } from "../../src/domain/money.js";
import { AccountNotFoundError } from "../../src/application/errors.js";
import { OverdraftError } from "../../src/domain/errors.js";

describe("Transfer use case", () => {
  let accountRepo: InMemoryAccountRepository;
  let txRepo: InMemoryTransactionRepository;
  let uow: InMemoryUnitOfWork;
  let transfer: Transfer;
  let getBalance: GetBalance;
  let createAccount: CreateAccount;

  beforeEach(() => {
    accountRepo = new InMemoryAccountRepository();
    txRepo = new InMemoryTransactionRepository();
    uow = new InMemoryUnitOfWork(accountRepo, txRepo);
    transfer = new Transfer(uow);
    getBalance = new GetBalance(accountRepo, txRepo);
    createAccount = new CreateAccount(accountRepo);
  });

  // ── Helper ────────────────────────────────────────────────────────────────

  async function fundAccount(accountId: string, fundingAccountId: string, minor: bigint) {
    // Seed funds from funding account (SYSTEM_CLEARING) into accountId
    await transfer.execute({
      id: `seed-${accountId}-${minor.toString()}`,
      fromAccountId: fundingAccountId,
      toAccountId: accountId,
      amount: Money.fromMinor(minor, "ARS"),
    });
  }

  // ── Happy path ────────────────────────────────────────────────────────────

  it("happy path: moves balance from one account to another", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet-a", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
    await createAccount.execute({ id: "wallet-b", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    // Fund wallet-a with 1000 ARS
    await fundAccount("wallet-a", "system", 1000n);

    // Transfer 300 from wallet-a to wallet-b
    const tx = await transfer.execute({
      id: "tx-transfer",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(300n, "ARS"),
    });

    expect(tx.id).toBe("tx-transfer");
    expect(tx.postings).toHaveLength(2);

    const balanceA = await getBalance.execute({ accountId: "wallet-a" });
    const balanceB = await getBalance.execute({ accountId: "wallet-b" });
    expect(balanceA.minor).toBe(700n);  // 1000 - 300
    expect(balanceB.minor).toBe(300n);  // 0 + 300
  });

  it("happy path: transfer persists in transaction repository", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    await fundAccount("wallet", "system", 500n);

    await transfer.execute({
      id: "tx-1",
      fromAccountId: "wallet",
      toAccountId: "system",
      amount: Money.fromMinor(200n, "ARS"),
    });

    const all = await txRepo.listAll();
    // 1 seed + 1 transfer
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.id)).toContain("tx-1");
  });

  // ── AccountNotFoundError ──────────────────────────────────────────────────

  it("throws AccountNotFoundError when fromAccount does not exist", async () => {
    await createAccount.execute({ id: "wallet-b", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    await expect(
      transfer.execute({
        id: "tx-fail",
        fromAccountId: "nonexistent",
        toAccountId: "wallet-b",
        amount: Money.fromMinor(100n, "ARS"),
      })
    ).rejects.toThrowError(AccountNotFoundError);
  });

  it("throws AccountNotFoundError when toAccount does not exist", async () => {
    await createAccount.execute({ id: "wallet-a", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    await expect(
      transfer.execute({
        id: "tx-fail",
        fromAccountId: "wallet-a",
        toAccountId: "nonexistent",
        amount: Money.fromMinor(100n, "ARS"),
      })
    ).rejects.toThrowError(AccountNotFoundError);
  });

  it("throws AccountNotFoundError when both accounts do not exist", async () => {
    await expect(
      transfer.execute({
        id: "tx-fail",
        fromAccountId: "ghost-a",
        toAccountId: "ghost-b",
        amount: Money.fromMinor(100n, "ARS"),
      })
    ).rejects.toThrowError(AccountNotFoundError);
  });

  // ── OverdraftError ────────────────────────────────────────────────────────

  it("throws OverdraftError when CUSTOMER_WALLET lacks sufficient funds", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    // Fund wallet with only 100
    await fundAccount("wallet", "system", 100n);

    // Try to transfer 500 (more than available)
    await expect(
      transfer.execute({
        id: "tx-overdraft",
        fromAccountId: "wallet",
        toAccountId: "system",
        amount: Money.fromMinor(500n, "ARS"),
      })
    ).rejects.toThrowError(OverdraftError);
  });

  it("does NOT persist transaction when OverdraftError occurs (all-or-nothing)", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    await fundAccount("wallet", "system", 100n);
    const countBefore = (await txRepo.listAll()).length;

    try {
      await transfer.execute({
        id: "tx-overdraft",
        fromAccountId: "wallet",
        toAccountId: "system",
        amount: Money.fromMinor(500n, "ARS"),
      });
    } catch {
      // expected
    }

    const countAfter = (await txRepo.listAll()).length;
    expect(countAfter).toBe(countBefore); // no new tx persisted
  });

  it("balance is unchanged after failed OverdraftError transfer", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    await fundAccount("wallet", "system", 100n);

    try {
      await transfer.execute({
        id: "tx-fail",
        fromAccountId: "wallet",
        toAccountId: "system",
        amount: Money.fromMinor(500n, "ARS"),
      });
    } catch {
      // expected
    }

    const balance = await getBalance.execute({ accountId: "wallet" });
    expect(balance.minor).toBe(100n); // unchanged
  });

  // ── Negative-balance-allowed accounts ────────────────────────────────────

  it("SYSTEM_CLEARING can go negative (no OverdraftError)", async () => {
    await createAccount.execute({ id: "clearing", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "external", currency: "ARS", type: AccountType.EXTERNAL });

    // clearing starts at 0, transfer will push it to -500
    await expect(
      transfer.execute({
        id: "tx-negative",
        fromAccountId: "clearing",
        toAccountId: "external",
        amount: Money.fromMinor(500n, "ARS"),
      })
    ).resolves.toBeDefined();

    const balance = await getBalance.execute({ accountId: "clearing" });
    expect(balance.minor).toBe(-500n);
  });

  it("EXTERNAL can go negative (no OverdraftError)", async () => {
    await createAccount.execute({ id: "external", currency: "ARS", type: AccountType.EXTERNAL });
    await createAccount.execute({ id: "clearing", currency: "ARS", type: AccountType.SYSTEM_CLEARING });

    await expect(
      transfer.execute({
        id: "tx-ext-negative",
        fromAccountId: "external",
        toAccountId: "clearing",
        amount: Money.fromMinor(1000n, "ARS"),
      })
    ).resolves.toBeDefined();
  });

  // ── occurredAt optional ───────────────────────────────────────────────────

  it("uses provided occurredAt if given", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    const date = new Date("2025-01-15T10:00:00Z");
    const tx = await transfer.execute({
      id: "tx-dated",
      fromAccountId: "system",
      toAccountId: "wallet",
      amount: Money.fromMinor(100n, "ARS"),
      occurredAt: date,
    });

    expect(tx.occurredAt).toEqual(date);
  });

  // ── Multiple sequential transfers ─────────────────────────────────────────

  it("balance is correct after multiple sequential transfers", async () => {
    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    // Deposit 3 times
    await fundAccount("wallet", "system", 1000n);
    await fundAccount("wallet", "system", 500n);
    await fundAccount("wallet", "system", 250n);

    // Withdraw once
    await transfer.execute({
      id: "tx-out",
      fromAccountId: "wallet",
      toAccountId: "system",
      amount: Money.fromMinor(300n, "ARS"),
    });

    const balance = await getBalance.execute({ accountId: "wallet" });
    expect(balance.minor).toBe(1450n); // 1000 + 500 + 250 - 300
  });
});
