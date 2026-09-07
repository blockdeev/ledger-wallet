import { describe, it, expect } from "vitest";
import { applyTransaction } from "../../src/domain/balances.js";
import { createTransaction } from "../../src/domain/ledger-transaction.js";
import { createPosting } from "../../src/domain/posting.js";
import { Money } from "../../src/domain/money.js";
import { Account, AccountType, createAccount } from "../../src/domain/account.js";
import { UnknownAccountError } from "../../src/domain/errors.js";

function makeTransferTx(
  fromId: string,
  toId: string,
  amount: bigint,
  currency = "ARS"
) {
  return createTransaction({
    id: "tx-unknown-test",
    postings: [
      createPosting(fromId, Money.fromMinor(-amount, currency)),
      createPosting(toId, Money.fromMinor(amount, currency)),
    ],
    occurredAt: new Date("2024-01-01T00:00:00Z"),
  });
}

function makeLookup(accounts: Account[]) {
  const map = new Map<string, Account>(accounts.map((a) => [a.id, a]));
  return (id: string): Account | undefined => map.get(id);
}

describe("applyTransaction — UnknownAccountError (Tarea 0)", () => {
  it("throws UnknownAccountError when a posting references an account not in lookup", () => {
    // Only one account registered in lookup; the other is unknown
    const knownAccount = createAccount("acc-a", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([knownAccount]);

    const balances = new Map<string, Money>([
      ["acc-a", Money.fromMinor(1000n, "ARS")],
      ["acc-b", Money.fromMinor(1000n, "ARS")],
    ]);
    const tx = makeTransferTx("acc-a", "acc-b", 200n);

    expect(() => applyTransaction(balances, tx, lookup)).toThrowError(UnknownAccountError);
  });

  it("throws UnknownAccountError even when the unknown account would NOT go negative (positive balance result)", () => {
    // acc-b would end up with 1200 (positive), but it's still unknown → error
    const knownAccount = createAccount("acc-a", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([knownAccount]);

    const balances = new Map<string, Money>([
      ["acc-a", Money.fromMinor(1000n, "ARS")],
      ["acc-b", Money.fromMinor(1000n, "ARS")],
    ]);
    const tx = makeTransferTx("acc-a", "acc-b", 200n); // acc-b goes from 1000 → 1200

    expect(() => applyTransaction(balances, tx, lookup)).toThrowError(UnknownAccountError);
  });

  it("throws UnknownAccountError when both accounts are unknown", () => {
    const lookup = (_id: string): Account | undefined => undefined;
    const balances = new Map<string, Money>([
      ["x", Money.fromMinor(500n, "ARS")],
      ["y", Money.fromMinor(500n, "ARS")],
    ]);
    const tx = makeTransferTx("x", "y", 100n);

    expect(() => applyTransaction(balances, tx, lookup)).toThrowError(UnknownAccountError);
  });

  it("does NOT apply any changes when UnknownAccountError is thrown (all-or-nothing)", () => {
    const knownAccount = createAccount("acc-a", "ARS", AccountType.SYSTEM_CLEARING);
    const lookup = makeLookup([knownAccount]);

    const balances = new Map<string, Money>([
      ["acc-a", Money.fromMinor(1000n, "ARS")],
      ["acc-b", Money.fromMinor(500n, "ARS")],
    ]);
    const tx = makeTransferTx("acc-a", "acc-b", 200n);

    try {
      applyTransaction(balances, tx, lookup);
    } catch {
      // expected
    }

    // original map MUST be unchanged
    expect(balances.get("acc-a")?.minor).toBe(1000n);
    expect(balances.get("acc-b")?.minor).toBe(500n);
  });

  it("does NOT throw when all accounts in postings are known to the lookup", () => {
    const accA = createAccount("acc-a", "ARS", AccountType.SYSTEM_CLEARING);
    const accB = createAccount("acc-b", "ARS", AccountType.CUSTOMER_WALLET);
    const lookup = makeLookup([accA, accB]);

    const balances = new Map<string, Money>([
      ["acc-a", Money.fromMinor(1000n, "ARS")],
      ["acc-b", Money.fromMinor(500n, "ARS")],
    ]);
    const tx = makeTransferTx("acc-a", "acc-b", 100n);

    expect(() => applyTransaction(balances, tx, lookup)).not.toThrow();
  });
});
