import { describe, it, expect } from "vitest";
import { AccountType, createAccount } from "../../src/domain/account.js";

describe("AccountType", () => {
  it("has CUSTOMER_WALLET type", () => {
    expect(AccountType.CUSTOMER_WALLET).toBeDefined();
  });

  it("has SYSTEM_CLEARING type", () => {
    expect(AccountType.SYSTEM_CLEARING).toBeDefined();
  });

  it("has EXTERNAL type", () => {
    expect(AccountType.EXTERNAL).toBeDefined();
  });
});

describe("Account.allowsNegativeBalance", () => {
  it("CUSTOMER_WALLET does NOT allow negative balance", () => {
    const account = createAccount("acc-1", "ARS", AccountType.CUSTOMER_WALLET);
    expect(account.allowsNegativeBalance()).toBe(false);
  });

  it("SYSTEM_CLEARING allows negative balance", () => {
    const account = createAccount("acc-2", "ARS", AccountType.SYSTEM_CLEARING);
    expect(account.allowsNegativeBalance()).toBe(true);
  });

  it("EXTERNAL allows negative balance", () => {
    const account = createAccount("acc-3", "ARS", AccountType.EXTERNAL);
    expect(account.allowsNegativeBalance()).toBe(true);
  });

  it("account has correct id and currency", () => {
    const account = createAccount("my-acc", "ARS", AccountType.CUSTOMER_WALLET);
    expect(account.id).toBe("my-acc");
    expect(account.currency).toBe("ARS");
    expect(account.type).toBe(AccountType.CUSTOMER_WALLET);
  });
});
