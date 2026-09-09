import { describe, it, expect, beforeEach } from "vitest";
import { Transfer } from "../../src/application/use-cases/transfer.js";
import { GetBalance } from "../../src/application/use-cases/get-balance.js";
import { CreateAccount } from "../../src/application/use-cases/create-account.js";
import { InMemoryAccountRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-transaction-repository.js";
import { InMemoryUnitOfWork } from "../../src/adapters/outbound/persistence/in-memory/in-memory-unit-of-work.js";
import { InMemoryIdempotencyRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-idempotency-repository.js";
import { AccountType } from "../../src/domain/account.js";
import { Money } from "../../src/domain/money.js";
import { AccountNotFoundError } from "../../src/application/errors.js";
import { OverdraftError } from "../../src/domain/errors.js";

describe("Transfer use case", () => {
  let accountRepo: InMemoryAccountRepository;
  let txRepo: InMemoryTransactionRepository;
  let idempotencyRepo: InMemoryIdempotencyRepository;
  let uow: InMemoryUnitOfWork;
  let transfer: Transfer;
  let getBalance: GetBalance;
  let createAccount: CreateAccount;

  beforeEach(() => {
    accountRepo = new InMemoryAccountRepository();
    txRepo = new InMemoryTransactionRepository();
    idempotencyRepo = new InMemoryIdempotencyRepository();
    uow = new InMemoryUnitOfWork(accountRepo, txRepo, idempotencyRepo);
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
    const { transaction: tx, replayed } = await transfer.execute({
      id: "tx-transfer",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(300n, "ARS"),
    });

    expect(replayed).toBe(false);
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
    const { transaction: tx } = await transfer.execute({
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

// ═══════════════════════════════════════════════════════════════════════════
// FASE 3c — Tests de idempotencia
// ═══════════════════════════════════════════════════════════════════════════

import { computeFingerprint } from "../../src/application/use-cases/transfer.js";
import {
  IdempotencyConflictError,
} from "../../src/application/errors.js";

describe("computeFingerprint (pure function)", () => {
  it("produces a deterministic string from the input fields", () => {
    const input = {
      id: "tx-1",
      fromAccountId: "acc-a",
      toAccountId: "acc-b",
      amount: Money.fromMinor(500n, "ARS"),
    };
    const fp1 = computeFingerprint(input);
    const fp2 = computeFingerprint(input);
    expect(fp1).toBe(fp2);
  });

  it("changes when id changes", () => {
    const base = { id: "tx-1", fromAccountId: "a", toAccountId: "b", amount: Money.fromMinor(100n, "ARS") };
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, id: "tx-2" })
    );
  });

  it("changes when amount changes", () => {
    const base = { id: "tx-1", fromAccountId: "a", toAccountId: "b", amount: Money.fromMinor(100n, "ARS") };
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, amount: Money.fromMinor(200n, "ARS") })
    );
  });

  it("changes when currency changes", () => {
    const base = { id: "tx-1", fromAccountId: "a", toAccountId: "b", amount: Money.fromMinor(100n, "ARS") };
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, amount: Money.fromMinor(100n, "USD") })
    );
  });
});

describe("Transfer use case — idempotencia (Fase 3c)", () => {
  let accountRepo: InMemoryAccountRepository;
  let txRepo: InMemoryTransactionRepository;
  let idempotencyRepo: InMemoryIdempotencyRepository;
  let uow: InMemoryUnitOfWork;
  let transfer: Transfer;
  let getBalance: GetBalance;
  let createAccount: CreateAccount;

  beforeEach(async () => {
    accountRepo = new InMemoryAccountRepository();
    txRepo = new InMemoryTransactionRepository();
    idempotencyRepo = new InMemoryIdempotencyRepository();
    uow = new InMemoryUnitOfWork(accountRepo, txRepo, idempotencyRepo);
    transfer = new Transfer(uow);
    getBalance = new GetBalance(accountRepo, txRepo);
    createAccount = new CreateAccount(accountRepo);

    await createAccount.execute({ id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING });
    await createAccount.execute({ id: "wallet-a", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
    await createAccount.execute({ id: "wallet-b", currency: "ARS", type: AccountType.CUSTOMER_WALLET });
    // Fondear wallet-a con 1000 ARS
    await transfer.execute({
      id: "seed-1",
      fromAccountId: "system",
      toAccountId: "wallet-a",
      amount: Money.fromMinor(1000n, "ARS"),
    });
  });

  // ── Sin clave: comportamiento de 3b intacto ───────────────────────────────

  it("sin idempotencyKey: devuelve { transaction, replayed:false } igual que 3b", async () => {
    const result = await transfer.execute({
      id: "tx-no-key",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(200n, "ARS"),
    });

    expect(result.replayed).toBe(false);
    expect(result.transaction.id).toBe("tx-no-key");

    const balanceA = await getBalance.execute({ accountId: "wallet-a" });
    expect(balanceA.minor).toBe(800n);
  });

  it("sin idempotencyKey: NO escribe registro de idempotencia", async () => {
    await transfer.execute({
      id: "tx-no-key-2",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(100n, "ARS"),
    });

    const record = await idempotencyRepo.findByKey("any-key");
    expect(record).toBeUndefined();
  });

  // ── Alta nueva con clave ──────────────────────────────────────────────────

  it("con idempotencyKey nueva: alta, replayed=false, saldo movido", async () => {
    const result = await transfer.execute({
      id: "tx-idem-1",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(300n, "ARS"),
      idempotencyKey: "key-001",
    });

    expect(result.replayed).toBe(false);
    expect(result.transaction.id).toBe("tx-idem-1");

    const balanceA = await getBalance.execute({ accountId: "wallet-a" });
    expect(balanceA.minor).toBe(700n);
  });

  it("con idempotencyKey nueva: escribe el registro de idempotencia", async () => {
    await transfer.execute({
      id: "tx-idem-2",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(100n, "ARS"),
      idempotencyKey: "key-002",
    });

    const record = await idempotencyRepo.findByKey("key-002");
    expect(record).toBeDefined();
    expect(record?.transactionId).toBe("tx-idem-2");
  });

  // ── Replay (misma clave + mismo payload) ─────────────────────────────────

  it("replay: misma clave y payload → replayed=true, mismo body, NO mueve dinero", async () => {
    const input = {
      id: "tx-idem-3",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(400n, "ARS"),
      idempotencyKey: "key-replay",
    };

    const primera = await transfer.execute(input);
    expect(primera.replayed).toBe(false);

    const segunda = await transfer.execute(input);
    expect(segunda.replayed).toBe(true);
    expect(segunda.transaction.id).toBe(primera.transaction.id);
    expect(segunda.transaction.occurredAt).toEqual(primera.transaction.occurredAt);

    // Solo se movió dinero UNA vez
    const balanceA = await getBalance.execute({ accountId: "wallet-a" });
    expect(balanceA.minor).toBe(600n); // 1000 - 400, no 1000 - 800
  });

  it("replay: el cuerpo reconstruido incluye los postings correctos", async () => {
    const input = {
      id: "tx-idem-4",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(150n, "ARS"),
      idempotencyKey: "key-replay-postings",
    };

    await transfer.execute(input);
    const { transaction: tx } = await transfer.execute(input);

    expect(tx.postings).toHaveLength(2);
    const toPosting = tx.postings.find((p) => p.accountId === "wallet-b");
    expect(toPosting?.amount.minor).toBe(150n);
  });

  it("replay: múltiples reintentos son idempotentes (3 llamadas = 1 escritura)", async () => {
    const input = {
      id: "tx-idem-5",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(100n, "ARS"),
      idempotencyKey: "key-multi-replay",
    };

    const r1 = await transfer.execute(input);
    const r2 = await transfer.execute(input);
    const r3 = await transfer.execute(input);

    expect(r1.replayed).toBe(false);
    expect(r2.replayed).toBe(true);
    expect(r3.replayed).toBe(true);

    const balanceA = await getBalance.execute({ accountId: "wallet-a" });
    expect(balanceA.minor).toBe(900n); // solo se descontó 100 una vez
  });

  // ── Conflicto (misma clave, payload distinto) ─────────────────────────────

  it("conflicto: misma clave con amount distinto → IdempotencyConflictError", async () => {
    await transfer.execute({
      id: "tx-conflict-1",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(200n, "ARS"),
      idempotencyKey: "key-conflict",
    });

    await expect(
      transfer.execute({
        id: "tx-conflict-2",
        fromAccountId: "wallet-a",
        toAccountId: "wallet-b",
        amount: Money.fromMinor(999n, "ARS"), // distinto
        idempotencyKey: "key-conflict",
      })
    ).rejects.toThrowError(IdempotencyConflictError);
  });

  it("conflicto: misma clave con id distinto → IdempotencyConflictError", async () => {
    await transfer.execute({
      id: "tx-orig",
      fromAccountId: "wallet-a",
      toAccountId: "wallet-b",
      amount: Money.fromMinor(100n, "ARS"),
      idempotencyKey: "key-conflict-id",
    });

    await expect(
      transfer.execute({
        id: "tx-distinto", // id diferente → fingerprint diferente
        fromAccountId: "wallet-a",
        toAccountId: "wallet-b",
        amount: Money.fromMinor(100n, "ARS"),
        idempotencyKey: "key-conflict-id",
      })
    ).rejects.toThrowError(IdempotencyConflictError);
  });

  // ── Regresión de rollback (dec. 6 del brief) ─────────────────────────────

  it("rollback: overdraft con clave → rechaza Y la clave NO queda persistida", async () => {
    const key = "key-overdraft-rollback";

    // Intentar transferir más de lo que hay (1000) → OverdraftError
    try {
      await transfer.execute({
        id: "tx-overdraft-with-key",
        fromAccountId: "wallet-a",
        toAccountId: "wallet-b",
        amount: Money.fromMinor(9999n, "ARS"),
        idempotencyKey: key,
      });
    } catch {
      // esperado
    }

    // La clave NO debe haber quedado persistida (rollback deseshizo la reserva)
    const record = await idempotencyRepo.findByKey(key);
    expect(record).toBeUndefined();

    // Un segundo intento con la misma clave se comporta como primero, no como replay
    // Si la cuenta ahora tiene fondos suficientes, debe poder ejecutar la transferencia
    const result = await transfer.execute({
      id: "tx-overdraft-with-key",
      fromAccountId: "system",    // system puede ir negativo
      toAccountId: "wallet-b",
      amount: Money.fromMinor(100n, "ARS"),
      idempotencyKey: key,
    });
    expect(result.replayed).toBe(false); // es un alta, no un replay
    expect(result.transaction.id).toBe("tx-overdraft-with-key");
  });

  it("rollback: overdraft con clave NO persiste la transacción", async () => {
    const txCountBefore = (await txRepo.listAll()).length;

    try {
      await transfer.execute({
        id: "tx-overdraft-persist-check",
        fromAccountId: "wallet-a",
        toAccountId: "wallet-b",
        amount: Money.fromMinor(9999n, "ARS"),
        idempotencyKey: "key-overdraft-persist",
      });
    } catch {
      // esperado
    }

    const txCountAfter = (await txRepo.listAll()).length;
    expect(txCountAfter).toBe(txCountBefore); // sin tx nueva
  });
});
