import { describe, it, expect } from "vitest";
import { Posting, createPosting } from "../../src/domain/posting.js";
import { Money } from "../../src/domain/money.js";
import { NonZeroPostingError } from "../../src/domain/errors.js";

describe("createPosting", () => {
  it("creates a valid posting with positive amount", () => {
    const amount = Money.fromMinor(100n, "ARS");
    const posting: Posting = createPosting("acc-1", amount);
    expect(posting.accountId).toBe("acc-1");
    expect(posting.amount.minor).toBe(100n);
  });

  it("creates a valid posting with negative amount", () => {
    const amount = Money.fromMinor(-100n, "ARS");
    const posting: Posting = createPosting("acc-2", amount);
    expect(posting.amount.minor).toBe(-100n);
  });

  it("throws NonZeroPostingError when amount is zero", () => {
    const zero = Money.zero("ARS");
    expect(() => createPosting("acc-1", zero)).toThrowError(NonZeroPostingError);
  });
});
