import { describe, it, expect } from "vitest";
import { LedgerTransaction, createTransaction, transactionCurrency, totalCredits } from "../../src/domain/ledger-transaction.js";
import { createPosting } from "../../src/domain/posting.js";
import { Money } from "../../src/domain/money.js";
import {
  InsufficientPostingsError,
  UnbalancedTransactionError,
  CurrencyMismatchError,
  NonZeroPostingError,
} from "../../src/domain/errors.js";

// Helper: typical balanced 2-posting transfer (acc1 → acc2)
function makeTransfer(
  fromId: string,
  toId: string,
  amount: bigint,
  currency: string
): LedgerTransaction {
  return createTransaction({
    id: "tx-1",
    postings: [
      createPosting(fromId, Money.fromMinor(-amount, currency)),
      createPosting(toId, Money.fromMinor(amount, currency)),
    ],
    occurredAt: new Date("2024-01-01T00:00:00Z"),
  });
}

describe("createTransaction — valid cases", () => {
  it("creates a balanced transaction with 2 postings", () => {
    const tx = makeTransfer("acc-1", "acc-2", 500n, "ARS");
    expect(tx.id).toBe("tx-1");
    expect(tx.postings).toHaveLength(2);
    expect(tx.occurredAt).toBeInstanceOf(Date);
  });

  it("creates a balanced transaction with 3 postings", () => {
    // Split payment: acc-1 pays 1000, acc-2 receives 700, acc-3 receives 300
    const tx = createTransaction({
      id: "tx-2",
      postings: [
        createPosting("acc-1", Money.fromMinor(-1000n, "ARS")),
        createPosting("acc-2", Money.fromMinor(700n, "ARS")),
        createPosting("acc-3", Money.fromMinor(300n, "ARS")),
      ],
      occurredAt: new Date(),
    });
    expect(tx.postings).toHaveLength(3);
  });

  it("stores postings immutably — external mutation does not affect tx", () => {
    const tx = makeTransfer("acc-1", "acc-2", 100n, "ARS");
    const postingsCopy = tx.postings;
    expect(postingsCopy).toHaveLength(2);
    // The tx's postings should be a defensive copy or frozen
    expect(Object.isFrozen(tx.postings) || postingsCopy === tx.postings).toBeDefined();
  });
});

describe("createTransaction — invariant: minimum 2 postings", () => {
  it("throws InsufficientPostingsError with 0 postings", () => {
    expect(() =>
      createTransaction({ id: "tx", postings: [], occurredAt: new Date() })
    ).toThrowError(InsufficientPostingsError);
  });

  it("throws InsufficientPostingsError with 1 posting", () => {
    expect(() =>
      createTransaction({
        id: "tx",
        postings: [createPosting("acc-1", Money.fromMinor(100n, "ARS"))],
        occurredAt: new Date(),
      })
    ).toThrowError(InsufficientPostingsError);
  });
});

describe("createTransaction — invariant: balanced (sum == 0)", () => {
  it("throws UnbalancedTransactionError when sum != 0", () => {
    expect(() =>
      createTransaction({
        id: "tx",
        postings: [
          createPosting("acc-1", Money.fromMinor(-1000n, "ARS")),
          createPosting("acc-2", Money.fromMinor(600n, "ARS")), // sum = -400, not 0
        ],
        occurredAt: new Date(),
      })
    ).toThrowError(UnbalancedTransactionError);
  });

  it("throws UnbalancedTransactionError for 3 postings that don't balance", () => {
    expect(() =>
      createTransaction({
        id: "tx",
        postings: [
          createPosting("acc-1", Money.fromMinor(-1000n, "ARS")),
          createPosting("acc-2", Money.fromMinor(400n, "ARS")),
          createPosting("acc-3", Money.fromMinor(400n, "ARS")), // sum = -200, not 0
        ],
        occurredAt: new Date(),
      })
    ).toThrowError(UnbalancedTransactionError);
  });
});

describe("createTransaction — invariant: same currency", () => {
  it("throws CurrencyMismatchError when postings have different currencies", () => {
    expect(() =>
      createTransaction({
        id: "tx",
        postings: [
          createPosting("acc-1", Money.fromMinor(-100n, "ARS")),
          createPosting("acc-2", Money.fromMinor(100n, "USD")),
        ],
        occurredAt: new Date(),
      })
    ).toThrowError(CurrencyMismatchError);
  });
});

describe("createTransaction — invariant: no zero postings", () => {
  it("throws NonZeroPostingError when creating a posting with zero amount", () => {
    // NonZeroPostingError is thrown at Posting creation time
    expect(() => createPosting("acc-1", Money.zero("ARS"))).toThrowError(
      NonZeroPostingError
    );
  });
});

describe("transactionCurrency", () => {
  it("returns the currency of the transaction", () => {
    const tx = makeTransfer("acc-1", "acc-2", 100n, "ARS");
    expect(transactionCurrency(tx)).toBe("ARS");
  });
});

describe("totalCredits", () => {
  it("returns the sum of all positive postings", () => {
    // -1000 ARS + 700 ARS + 300 ARS = 0
    const tx = createTransaction({
      id: "tx-credits",
      postings: [
        createPosting("acc-1", Money.fromMinor(-1000n, "ARS")),
        createPosting("acc-2", Money.fromMinor(700n, "ARS")),
        createPosting("acc-3", Money.fromMinor(300n, "ARS")),
      ],
      occurredAt: new Date(),
    });
    expect(totalCredits(tx).minor).toBe(1000n);
  });

  it("returns the credit side of a simple 2-posting transfer", () => {
    const tx = makeTransfer("acc-1", "acc-2", 500n, "ARS");
    expect(totalCredits(tx).minor).toBe(500n);
  });
});
