import { describe, it, expect } from "vitest";
import {
  DomainError,
  CurrencyMismatchError,
  NonZeroPostingError,
  InsufficientPostingsError,
  UnbalancedTransactionError,
  OverdraftError,
} from "../../src/domain/errors.js";

describe("DomainError hierarchy", () => {
  it("DomainError is an Error", () => {
    const err = new DomainError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.message).toBe("test");
    expect(err.name).toBe("DomainError");
  });

  it("CurrencyMismatchError extends DomainError", () => {
    const err = new CurrencyMismatchError("ARS", "USD");
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(CurrencyMismatchError);
    expect(err.name).toBe("CurrencyMismatchError");
    expect(err.message).toContain("ARS");
    expect(err.message).toContain("USD");
  });

  it("NonZeroPostingError extends DomainError", () => {
    const err = new NonZeroPostingError();
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(NonZeroPostingError);
    expect(err.name).toBe("NonZeroPostingError");
  });

  it("InsufficientPostingsError extends DomainError", () => {
    const err = new InsufficientPostingsError(1);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(InsufficientPostingsError);
    expect(err.name).toBe("InsufficientPostingsError");
    expect(err.message).toContain("1");
  });

  it("UnbalancedTransactionError extends DomainError", () => {
    const err = new UnbalancedTransactionError(100n);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(UnbalancedTransactionError);
    expect(err.name).toBe("UnbalancedTransactionError");
  });

  it("OverdraftError extends DomainError", () => {
    const err = new OverdraftError("acc-1");
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(OverdraftError);
    expect(err.name).toBe("OverdraftError");
    expect(err.message).toContain("acc-1");
  });

  it("all errors have proper stack traces", () => {
    const err = new CurrencyMismatchError("ARS", "USD");
    expect(err.stack).toBeDefined();
  });
});
