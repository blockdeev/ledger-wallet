import { describe, it, expect, beforeEach } from "vitest";
import { CreateAccount } from "../../src/application/use-cases/create-account.js";
import { InMemoryAccountRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { AccountType } from "../../src/domain/account.js";
import { AccountAlreadyExistsError } from "../../src/application/errors.js";
import { CapturingLogger } from "../support/capturing-logger.js";

describe("CreateAccount use case", () => {
  let accountRepo: InMemoryAccountRepository;
  let logger: CapturingLogger;
  let createAccount: CreateAccount;

  beforeEach(() => {
    accountRepo = new InMemoryAccountRepository();
    logger = new CapturingLogger();
    createAccount = new CreateAccount(accountRepo, logger);
  });

  it("creates and persists a new account", async () => {
    const result = await createAccount.execute({
      id: "wallet-1",
      currency: "ARS",
      type: AccountType.CUSTOMER_WALLET,
    });

    expect(result.id).toBe("wallet-1");
    expect(result.currency).toBe("ARS");
    expect(result.type).toBe(AccountType.CUSTOMER_WALLET);

    // Verify it's actually persisted
    const found = await accountRepo.findById("wallet-1");
    expect(found).toBeDefined();
    expect(found?.id).toBe("wallet-1");
  });

  it("CUSTOMER_WALLET does not allow negative balance", async () => {
    const result = await createAccount.execute({
      id: "w",
      currency: "ARS",
      type: AccountType.CUSTOMER_WALLET,
    });
    expect(result.allowsNegativeBalance()).toBe(false);
  });

  it("SYSTEM_CLEARING allows negative balance", async () => {
    const result = await createAccount.execute({
      id: "clearing",
      currency: "ARS",
      type: AccountType.SYSTEM_CLEARING,
    });
    expect(result.allowsNegativeBalance()).toBe(true);
  });

  it("throws AccountAlreadyExistsError when id is already registered", async () => {
    await createAccount.execute({
      id: "wallet-1",
      currency: "ARS",
      type: AccountType.CUSTOMER_WALLET,
    });

    await expect(
      createAccount.execute({
        id: "wallet-1",
        currency: "USD",
        type: AccountType.EXTERNAL,
      })
    ).rejects.toThrowError(AccountAlreadyExistsError);
  });

  it("allows creating two different accounts with different ids", async () => {
    await createAccount.execute({ id: "a", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
    await createAccount.execute({ id: "b", currency: "USD", type: AccountType.EXTERNAL });

    expect(await accountRepo.findById("a")).toBeDefined();
    expect(await accountRepo.findById("b")).toBeDefined();
  });

  // ── Logging (Fase 4) ──────────────────────────────────────────────────────

  it("logging: emite account.created con campos correctos al crear una cuenta", async () => {
    await createAccount.execute({
      id: "wallet-log",
      currency: "ARS",
      type: AccountType.CUSTOMER_WALLET,
    });

    const entry = logger.firstByEvent("account.created");
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("info");
    expect(entry?.fields).toMatchObject({
      accountId: "wallet-log",
      currency: "ARS",
      type: AccountType.CUSTOMER_WALLET,
    });
  });

  it("logging: emite account.already_exists (warn) al intentar crear id duplicado", async () => {
    await createAccount.execute({ id: "dup", currency: "ARS", type: AccountType.CUSTOMER_WALLET });

    try {
      await createAccount.execute({ id: "dup", currency: "USD", type: AccountType.EXTERNAL });
    } catch {
      // esperado
    }

    const entry = logger.firstByEvent("account.already_exists");
    expect(entry).toBeDefined();
    expect(entry?.level).toBe("warn");
    expect(entry?.fields).toMatchObject({ accountId: "dup" });
  });
});
