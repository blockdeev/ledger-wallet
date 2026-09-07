import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAccountRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "../../src/adapters/outbound/persistence/in-memory/in-memory-transaction-repository.js";
import { createAccount, AccountType } from "../../src/domain/account.js";
import { createTransaction } from "../../src/domain/ledger-transaction.js";
import { createPosting } from "../../src/domain/posting.js";
import { Money } from "../../src/domain/money.js";

// ── InMemoryAccountRepository ───────────────────────────────────────────────

describe("InMemoryAccountRepository", () => {
  let repo: InMemoryAccountRepository;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
  });

  it("save and findById: returns saved account", async () => {
    const acc = createAccount("acc-1", "ARS", AccountType.CUSTOMER_WALLET);
    await repo.save(acc);
    const found = await repo.findById("acc-1");
    expect(found).toBeDefined();
    expect(found?.id).toBe("acc-1");
    expect(found?.currency).toBe("ARS");
    expect(found?.type).toBe(AccountType.CUSTOMER_WALLET);
  });

  it("findById returns undefined for unknown id", async () => {
    const result = await repo.findById("nonexistent");
    expect(result).toBeUndefined();
  });

  it("save overwrites an existing account with the same id", async () => {
    const original = createAccount("acc-1", "ARS", AccountType.CUSTOMER_WALLET);
    await repo.save(original);

    const updated = createAccount("acc-1", "USD", AccountType.SYSTEM_CLEARING);
    await repo.save(updated);

    const found = await repo.findById("acc-1");
    expect(found?.currency).toBe("USD");
    expect(found?.type).toBe(AccountType.SYSTEM_CLEARING);
  });

  it("stores multiple accounts independently", async () => {
    await repo.save(createAccount("a", "ARS", AccountType.CUSTOMER_WALLET));
    await repo.save(createAccount("b", "USD", AccountType.EXTERNAL));

    expect((await repo.findById("a"))?.currency).toBe("ARS");
    expect((await repo.findById("b"))?.currency).toBe("USD");
  });
});

// ── InMemoryTransactionRepository ──────────────────────────────────────────

describe("InMemoryTransactionRepository", () => {
  let repo: InMemoryTransactionRepository;

  function makeTx(id: string, fromId: string, toId: string, amount: bigint) {
    return createTransaction({
      id,
      postings: [
        createPosting(fromId, Money.fromMinor(-amount, "ARS")),
        createPosting(toId, Money.fromMinor(amount, "ARS")),
      ],
      occurredAt: new Date("2024-01-01T00:00:00Z"),
    });
  }

  beforeEach(() => {
    repo = new InMemoryTransactionRepository();
  });

  it("listAll returns empty array initially", async () => {
    expect(await repo.listAll()).toEqual([]);
  });

  it("append and listAll: returns all appended transactions", async () => {
    const tx1 = makeTx("tx-1", "a", "b", 100n);
    const tx2 = makeTx("tx-2", "b", "c", 200n);
    await repo.append(tx1);
    await repo.append(tx2);

    const all = await repo.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.id)).toContain("tx-1");
    expect(all.map((t) => t.id)).toContain("tx-2");
  });

  it("listByAccount returns only transactions involving the account", async () => {
    const tx1 = makeTx("tx-1", "acc-a", "acc-b", 100n);
    const tx2 = makeTx("tx-2", "acc-b", "acc-c", 50n);
    const tx3 = makeTx("tx-3", "acc-x", "acc-y", 999n);
    await repo.append(tx1);
    await repo.append(tx2);
    await repo.append(tx3);

    const forB = await repo.listByAccount("acc-b");
    expect(forB).toHaveLength(2);
    expect(forB.map((t) => t.id)).toContain("tx-1");
    expect(forB.map((t) => t.id)).toContain("tx-2");

    const forX = await repo.listByAccount("acc-x");
    expect(forX).toHaveLength(1);
    expect(forX[0]?.id).toBe("tx-3");
  });

  it("listByAccount returns empty array if account has no transactions", async () => {
    const tx = makeTx("tx-1", "a", "b", 100n);
    await repo.append(tx);
    expect(await repo.listByAccount("z")).toEqual([]);
  });

  it("listAll returns a copy (mutations do not affect internal state)", async () => {
    const tx = makeTx("tx-1", "a", "b", 100n);
    await repo.append(tx);

    const all = await repo.listAll();
    all.push(makeTx("tx-fake", "x", "y", 1n));

    expect((await repo.listAll())).toHaveLength(1);
  });
});
