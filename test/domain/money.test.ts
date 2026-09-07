import { describe, it, expect } from "vitest";
import { Money } from "../../src/domain/money.js";
import { CurrencyMismatchError } from "../../src/domain/errors.js";

describe("Money.fromMinor", () => {
  it("creates a Money with the given minor amount and currency", () => {
    const m = Money.fromMinor(100n, "ARS");
    expect(m.minor).toBe(100n);
    expect(m.currency).toBe("ARS");
  });

  it("accepts negative amounts", () => {
    const m = Money.fromMinor(-50n, "ARS");
    expect(m.minor).toBe(-50n);
  });

  it("accepts zero", () => {
    const m = Money.fromMinor(0n, "ARS");
    expect(m.minor).toBe(0n);
  });

  it("accepts large bigint values without overflow", () => {
    const large = 9_999_999_999_999_999n;
    const m = Money.fromMinor(large, "ARS");
    expect(m.minor).toBe(large);
  });
});

describe("Money.zero", () => {
  it("creates a zero Money for the given currency", () => {
    const m = Money.zero("ARS");
    expect(m.minor).toBe(0n);
    expect(m.currency).toBe("ARS");
    expect(m.isZero()).toBe(true);
  });
});

describe("Money immutability", () => {
  it("plus does not mutate the original", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(50n, "ARS");
    const c = a.plus(b);
    expect(a.minor).toBe(100n); // unchanged
    expect(c.minor).toBe(150n);
  });

  it("minus does not mutate the original", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(30n, "ARS");
    const c = a.minus(b);
    expect(a.minor).toBe(100n);
    expect(c.minor).toBe(70n);
  });

  it("negate does not mutate the original", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = a.negate();
    expect(a.minor).toBe(100n);
    expect(b.minor).toBe(-100n);
  });
});

describe("Money.plus", () => {
  it("sums two Money of same currency", () => {
    const a = Money.fromMinor(300n, "ARS");
    const b = Money.fromMinor(200n, "ARS");
    expect(a.plus(b).minor).toBe(500n);
  });

  it("sum result carries the same currency", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(50n, "ARS");
    expect(a.plus(b).currency).toBe("ARS");
  });

  it("throws CurrencyMismatchError when currencies differ", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(100n, "USD");
    expect(() => a.plus(b)).toThrowError(CurrencyMismatchError);
  });

  it("plus with zero gives the same amount", () => {
    const a = Money.fromMinor(500n, "ARS");
    const zero = Money.zero("ARS");
    expect(a.plus(zero).minor).toBe(500n);
  });
});

describe("Money.minus", () => {
  it("subtracts two Money of same currency", () => {
    const a = Money.fromMinor(500n, "ARS");
    const b = Money.fromMinor(200n, "ARS");
    expect(a.minus(b).minor).toBe(300n);
  });

  it("can result in negative amount", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(200n, "ARS");
    expect(a.minus(b).minor).toBe(-100n);
  });

  it("throws CurrencyMismatchError when currencies differ", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(50n, "USD");
    expect(() => a.minus(b)).toThrowError(CurrencyMismatchError);
  });
});

describe("Money.negate", () => {
  it("negates a positive amount", () => {
    const m = Money.fromMinor(100n, "ARS");
    expect(m.negate().minor).toBe(-100n);
  });

  it("negates a negative amount to positive", () => {
    const m = Money.fromMinor(-100n, "ARS");
    expect(m.negate().minor).toBe(100n);
  });

  it("negate of zero is zero", () => {
    const m = Money.zero("ARS");
    expect(m.negate().minor).toBe(0n);
  });
});

describe("Money.abs", () => {
  it("abs of positive is itself", () => {
    const m = Money.fromMinor(100n, "ARS");
    expect(m.abs().minor).toBe(100n);
  });

  it("abs of negative is positive", () => {
    const m = Money.fromMinor(-100n, "ARS");
    expect(m.abs().minor).toBe(100n);
  });

  it("abs of zero is zero", () => {
    const m = Money.zero("ARS");
    expect(m.abs().minor).toBe(0n);
  });
});

describe("Money.isZero", () => {
  it("returns true for zero", () => {
    expect(Money.zero("ARS").isZero()).toBe(true);
    expect(Money.fromMinor(0n, "ARS").isZero()).toBe(true);
  });

  it("returns false for positive amount", () => {
    expect(Money.fromMinor(1n, "ARS").isZero()).toBe(false);
  });

  it("returns false for negative amount", () => {
    expect(Money.fromMinor(-1n, "ARS").isZero()).toBe(false);
  });
});

describe("Money.isNegative", () => {
  it("returns true for negative amount", () => {
    expect(Money.fromMinor(-1n, "ARS").isNegative()).toBe(true);
  });

  it("returns false for zero", () => {
    expect(Money.zero("ARS").isNegative()).toBe(false);
  });

  it("returns false for positive amount", () => {
    expect(Money.fromMinor(1n, "ARS").isNegative()).toBe(false);
  });
});

describe("Money.isPositive", () => {
  it("returns true for positive amount", () => {
    expect(Money.fromMinor(1n, "ARS").isPositive()).toBe(true);
  });

  it("returns false for zero", () => {
    expect(Money.zero("ARS").isPositive()).toBe(false);
  });

  it("returns false for negative amount", () => {
    expect(Money.fromMinor(-1n, "ARS").isPositive()).toBe(false);
  });
});

describe("Money.equals", () => {
  it("returns true for equal amounts and currency", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(100n, "ARS");
    expect(a.equals(b)).toBe(true);
  });

  it("returns false for different amounts, same currency", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(200n, "ARS");
    expect(a.equals(b)).toBe(false);
  });

  it("throws CurrencyMismatchError for different currencies", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(100n, "USD");
    expect(() => a.equals(b)).toThrowError(CurrencyMismatchError);
  });
});

describe("Money.compareTo", () => {
  it("returns -1 when this < other", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(200n, "ARS");
    expect(a.compareTo(b)).toBe(-1);
  });

  it("returns 0 when this == other", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(100n, "ARS");
    expect(a.compareTo(b)).toBe(0);
  });

  it("returns 1 when this > other", () => {
    const a = Money.fromMinor(200n, "ARS");
    const b = Money.fromMinor(100n, "ARS");
    expect(a.compareTo(b)).toBe(1);
  });

  it("throws CurrencyMismatchError for different currencies", () => {
    const a = Money.fromMinor(100n, "ARS");
    const b = Money.fromMinor(100n, "USD");
    expect(() => a.compareTo(b)).toThrowError(CurrencyMismatchError);
  });

  it("compareTo negative values", () => {
    const a = Money.fromMinor(-100n, "ARS");
    const b = Money.fromMinor(0n, "ARS");
    expect(a.compareTo(b)).toBe(-1);
  });
});
