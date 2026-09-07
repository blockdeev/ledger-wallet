import { describe, it, expect } from "vitest";
import { applyTransaction } from "../../src/domain/balances.js";
import { createTransaction } from "../../src/domain/ledger-transaction.js";
import { createPosting } from "../../src/domain/posting.js";
import { Money } from "../../src/domain/money.js";
import { Account, AccountType, createAccount } from "../../src/domain/account.js";
import { OverdraftError } from "../../src/domain/errors.js";

// Helper to create a simple 2-way transfer transaction
function makeTransferTx(
  fromId: string,
  toId: string,
  amount: bigint,
  currency = "ARS"
): ReturnType<typeof createTransaction> {
  return createTransaction({
    id: "tx-test",
    postings: [
      createPosting(fromId, Money.fromMinor(-amount, currency)),
      createPosting(toId, Money.fromMinor(amount, currency)),
    ],
    occurredAt: new Date("2024-01-01T00:00:00Z"),
  });
}

// Lookup helper factory
function makeLookup(accounts: Account[]): (id: string) => Account | undefined {
  const map = new Map<string, Account>(accounts.map((a) => [a.id, a]));
  return (id: string): Account | undefined => map.get(id);
}

describe("applyTransaction — normal transfer", () => {
  it("updates two balances correctly", () => {
    const custWallet = createAccount("wallet-1", "ARS", AccountType.CUSTOMER_WALLET);
    const clearing = createAccount("clearing-1", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([custWallet, clearing]);

    // clearing → wallet (customer deposits 1000 ARS)
    const balances = new Map<string, Money>([
      ["wallet-1", Money.fromMinor(5000n, "ARS")],
      ["clearing-1", Money.fromMinor(10000n, "ARS")],
    ]);
    const tx = makeTransferTx("clearing-1", "wallet-1", 1000n);
    const newBalances = applyTransaction(balances, tx, lookup);

    expect(newBalances.get("wallet-1")?.minor).toBe(6000n);
    expect(newBalances.get("clearing-1")?.minor).toBe(9000n);
  });

  it("does not mutate the original balances map", () => {
    const wallet = createAccount("w", "ARS", AccountType.CUSTOMER_WALLET);
    const system = createAccount("s", "ARS", AccountType.SYSTEM_CLEARING);
    const balances = new Map<string, Money>([
      ["w", Money.fromMinor(2000n, "ARS")],
      ["s", Money.fromMinor(5000n, "ARS")],
    ]);
    const tx = makeTransferTx("s", "w", 500n);
    applyTransaction(balances, tx, makeLookup([wallet, system]));

    // Original unchanged
    expect(balances.get("w")?.minor).toBe(2000n);
    expect(balances.get("s")?.minor).toBe(5000n);
  });
});

describe("applyTransaction — new account starts at zero", () => {
  it("account with no prior balance starts at zero", () => {
    const system = createAccount("system", "ARS", AccountType.SYSTEM_CLEARING);
    const newWallet = createAccount("new-wallet", "ARS", AccountType.CUSTOMER_WALLET);
    const lookup = makeLookup([system, newWallet]);

    const balances = new Map<string, Money>([
      ["system", Money.fromMinor(50000n, "ARS")],
      // "new-wallet" has no entry
    ]);
    const tx = makeTransferTx("system", "new-wallet", 1000n);
    const newBalances = applyTransaction(balances, tx, lookup);

    expect(newBalances.get("new-wallet")?.minor).toBe(1000n); // started at 0 + 1000
    expect(newBalances.get("system")?.minor).toBe(49000n);
  });
});

describe("applyTransaction — overdraft protection", () => {
  it("throws OverdraftError when CUSTOMER_WALLET would go negative", () => {
    const wallet = createAccount("wallet", "ARS", AccountType.CUSTOMER_WALLET);
    const clearing = createAccount("clearing", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([wallet, clearing]);

    const balances = new Map<string, Money>([
      ["wallet", Money.fromMinor(500n, "ARS")],    // only 500
      ["clearing", Money.fromMinor(10000n, "ARS")],
    ]);
    // Try to debit 1000 from wallet (it only has 500)
    const tx = makeTransferTx("wallet", "clearing", 1000n);

    expect(() => applyTransaction(balances, tx, lookup)).toThrowError(OverdraftError);
  });

  it("does NOT apply any changes when overdraft occurs (all-or-nothing)", () => {
    const wallet = createAccount("wallet", "ARS", AccountType.CUSTOMER_WALLET);
    const clearing = createAccount("clearing", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([wallet, clearing]);

    const balances = new Map<string, Money>([
      ["wallet", Money.fromMinor(500n, "ARS")],
      ["clearing", Money.fromMinor(10000n, "ARS")],
    ]);
    const tx = makeTransferTx("wallet", "clearing", 1000n);

    try {
      applyTransaction(balances, tx, lookup);
    } catch {
      // Error expected
    }

    // Balances must be unchanged
    expect(balances.get("wallet")?.minor).toBe(500n);
    expect(balances.get("clearing")?.minor).toBe(10000n);
  });

  it("allows SYSTEM_CLEARING to go negative", () => {
    const clearing = createAccount("clearing", "ARS", AccountType.SYSTEM_CLEARING);
    const wallet = createAccount("wallet", "ARS", AccountType.CUSTOMER_WALLET);
    const lookup = makeLookup([clearing, wallet]);

    const balances = new Map<string, Money>([
      ["clearing", Money.fromMinor(100n, "ARS")],  // only 100
      ["wallet", Money.fromMinor(5000n, "ARS")],
    ]);
    // clearing receives debit of 500 (goes to -400), wallet gets +500
    const tx = makeTransferTx("clearing", "wallet", 500n);
    const newBalances = applyTransaction(balances, tx, lookup);

    expect(newBalances.get("clearing")?.minor).toBe(-400n); // negative allowed
    expect(newBalances.get("wallet")?.minor).toBe(5500n);
  });

  it("allows EXTERNAL to go negative", () => {
    const external = createAccount("ext", "ARS", AccountType.EXTERNAL);
    const clearing = createAccount("clearing", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([external, clearing]);

    const balances = new Map<string, Money>([
      ["ext", Money.fromMinor(0n, "ARS")],
      ["clearing", Money.fromMinor(10000n, "ARS")],
    ]);
    const tx = makeTransferTx("ext", "clearing", 300n);
    const newBalances = applyTransaction(balances, tx, lookup);

    expect(newBalances.get("ext")?.minor).toBe(-300n);
    expect(newBalances.get("clearing")?.minor).toBe(10300n);
  });
});

describe("applyTransaction — unknown account (no lookup entry)", () => {
  it("treats unknown account as if it allows negative (no info to enforce)", () => {
    // When a lookup returns undefined, we conservatively assume it's unknown
    // and skip overdraft check. This behavior is documented in Decision section.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const lookup = (_id: string): Account | undefined => undefined;
    const balances = new Map<string, Money>([
      ["acc-a", Money.fromMinor(1000n, "ARS")],
      ["acc-b", Money.fromMinor(1000n, "ARS")],
    ]);
    const tx = makeTransferTx("acc-a", "acc-b", 200n);
    // Should not throw — no account info means no overdraft enforcement
    const newBalances = applyTransaction(balances, tx, lookup);
    expect(newBalances.get("acc-a")?.minor).toBe(800n);
    expect(newBalances.get("acc-b")?.minor).toBe(1200n);
  });
});
