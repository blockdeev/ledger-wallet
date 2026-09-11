import { describe, it, expect, beforeEach } from "vitest";
import { GetBalance } from "../../src/application/use-cases/get-balance.js";
import { InMemoryAccountRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-transaction-repository.js";
import { createAccount, AccountType } from "../../src/domain/account.js";
import { createTransaction } from "../../src/domain/ledger-transaction.js";
import { createPosting } from "../../src/domain/posting.js";
import { Money } from "../../src/domain/money.js";
import { AccountNotFoundError } from "../../src/application/errors.js";
import { CapturingLogger } from "../support/capturing-logger.js";

describe("GetBalance use case", () => {
  let accountRepo: InMemoryAccountRepository;
  let txRepo: InMemoryTransactionRepository;
  let getBalance: GetBalance;

  beforeEach(() => {
    accountRepo = new InMemoryAccountRepository();
    txRepo = new InMemoryTransactionRepository();
    getBalance = new GetBalance(accountRepo, txRepo, new CapturingLogger());
  });

  it("returns Money.zero for an account with no transactions", async () => {
    const acc = createAccount("wallet-1", "ARS", AccountType.CUSTOMER_WALLET);
    await accountRepo.save(acc);

    const balance = await getBalance.execute({ accountId: "wallet-1" });
    expect(balance.isZero()).toBe(true);
    expect(balance.currency).toBe("ARS");
  });

  it("throws AccountNotFoundError when account does not exist", async () => {
    await expect(
      getBalance.execute({ accountId: "nonexistent" })
    ).rejects.toThrowError(AccountNotFoundError);
  });

  it("correctly sums postings after a single deposit", async () => {
    // System deposits 500 ARS into wallet
    const wallet = createAccount("wallet", "ARS", AccountType.CUSTOMER_WALLET);
    const system = createAccount("system", "ARS", AccountType.SYSTEM_CLEARING);
    await accountRepo.save(wallet);
    await accountRepo.save(system);

    const tx = createTransaction({
      id: "tx-1",
      postings: [
        createPosting("system", Money.fromMinor(-500n, "ARS")),
        createPosting("wallet", Money.fromMinor(500n, "ARS")),
      ],
      occurredAt: new Date(),
    });
    await txRepo.append(tx);

    const balance = await getBalance.execute({ accountId: "wallet" });
    expect(balance.minor).toBe(500n);
    expect(balance.currency).toBe("ARS");
  });

  it("correctly derives balance after multiple transactions", async () => {
    const wallet = createAccount("wallet", "ARS", AccountType.CUSTOMER_WALLET);
    const system = createAccount("system", "ARS", AccountType.SYSTEM_CLEARING);
    await accountRepo.save(wallet);
    await accountRepo.save(system);

    // Deposit 1000
    await txRepo.append(createTransaction({
      id: "tx-1",
      postings: [
        createPosting("system", Money.fromMinor(-1000n, "ARS")),
        createPosting("wallet", Money.fromMinor(1000n, "ARS")),
      ],
      occurredAt: new Date(),
    }));

    // Deposit another 500
    await txRepo.append(createTransaction({
      id: "tx-2",
      postings: [
        createPosting("system", Money.fromMinor(-500n, "ARS")),
        createPosting("wallet", Money.fromMinor(500n, "ARS")),
      ],
      occurredAt: new Date(),
    }));

    // Spend 200
    await txRepo.append(createTransaction({
      id: "tx-3",
      postings: [
        createPosting("wallet", Money.fromMinor(-200n, "ARS")),
        createPosting("system", Money.fromMinor(200n, "ARS")),
      ],
      occurredAt: new Date(),
    }));

    // Expected: 1000 + 500 - 200 = 1300
    const balance = await getBalance.execute({ accountId: "wallet" });
    expect(balance.minor).toBe(1300n);
  });

  it("balance only considers postings for the requested account (not others)", async () => {
    const walletA = createAccount("wallet-a", "ARS", AccountType.CUSTOMER_WALLET);
    const walletB = createAccount("wallet-b", "ARS", AccountType.CUSTOMER_WALLET);
    const system = createAccount("system", "ARS", AccountType.SYSTEM_CLEARING);
    await accountRepo.save(walletA);
    await accountRepo.save(walletB);
    await accountRepo.save(system);

    // Both wallets receive deposits
    await txRepo.append(createTransaction({
      id: "tx-1",
      postings: [
        createPosting("system", Money.fromMinor(-300n, "ARS")),
        createPosting("wallet-a", Money.fromMinor(300n, "ARS")),
      ],
      occurredAt: new Date(),
    }));
    await txRepo.append(createTransaction({
      id: "tx-2",
      postings: [
        createPosting("system", Money.fromMinor(-700n, "ARS")),
        createPosting("wallet-b", Money.fromMinor(700n, "ARS")),
      ],
      occurredAt: new Date(),
    }));

    expect((await getBalance.execute({ accountId: "wallet-a" })).minor).toBe(300n);
    expect((await getBalance.execute({ accountId: "wallet-b" })).minor).toBe(700n);
  });
});

import { CapturingTracer } from "../support/capturing-tracer.js";

describe("GetBalance — tracing (Fase 6)", () => {
  it("abre un span 'balance.get' con accountId como atributo", async () => {
    const repo = new InMemoryAccountRepository();
    const txRepo = new InMemoryTransactionRepository();
    const tracer = new CapturingTracer();
    const uc = new GetBalance(repo, txRepo, new CapturingLogger(), undefined, tracer);

    const acc = createAccount("wallet-trace", "ARS", AccountType.CUSTOMER_WALLET);
    await repo.save(acc);

    await uc.execute({ accountId: "wallet-trace" });

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.firstByName("balance.get");
    expect(span).toBeDefined();
    expect(span?.attributes).toMatchObject({ accountId: "wallet-trace" });
    expect(span?.error).toBe(false);
  });

  it("el span se marca como error cuando la cuenta no existe", async () => {
    const repo = new InMemoryAccountRepository();
    const txRepo = new InMemoryTransactionRepository();
    const tracer = new CapturingTracer();
    const uc = new GetBalance(repo, txRepo, new CapturingLogger(), undefined, tracer);

    await expect(uc.execute({ accountId: "ghost" })).rejects.toThrow();

    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]?.error).toBe(true);
  });
});
