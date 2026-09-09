/**
 * Tests HTTP para los tres endpoints de negocio + /health.
 *
 * Usa `app.inject` de Fastify (sin red real) + adapters in-memory.
 * Cubre:
 *   - Contratos de request/response (status codes y shapes)
 *   - Mapeo de errores: 409 / 404 / 422 / 400
 *   - Que `minor` viaja como string en ambas direcciones
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/adapters/inbound/http/app.js";
import { InMemoryAccountRepository } from "../../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "../../../src/adapters/outbound/persistence/in-memory/in-memory-transaction-repository.js";
import { InMemoryUnitOfWork } from "../../../src/adapters/outbound/persistence/in-memory/in-memory-unit-of-work.js";
import { InMemoryIdempotencyRepository } from "../../../src/adapters/outbound/persistence/in-memory/in-memory-idempotency-repository.js";
import { CreateAccount } from "../../../src/application/use-cases/create-account.js";
import { Transfer } from "../../../src/application/use-cases/transfer.js";
import { GetBalance } from "../../../src/application/use-cases/get-balance.js";
import { AccountType } from "../../../src/domain/account.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

function makeApp(): FastifyInstance {
  const accountRepo = new InMemoryAccountRepository();
  const txRepo = new InMemoryTransactionRepository();
  const idempotencyRepo = new InMemoryIdempotencyRepository();
  const uow = new InMemoryUnitOfWork(accountRepo, txRepo, idempotencyRepo);

  const createAccount = new CreateAccount(accountRepo);
  const transfer = new Transfer(uow);
  const getBalance = new GetBalance(accountRepo, txRepo);

  return buildApp({ createAccount, transfer, getBalance });
}

describe("HTTP endpoints", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /health ────────────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("200 with status ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });
  });

  // ── POST /accounts ─────────────────────────────────────────────────────────

  describe("POST /accounts", () => {
    it("201: creates a CUSTOMER_WALLET account", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "wallet-1", currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; currency: string; type: string }>();
      expect(body.id).toBe("wallet-1");
      expect(body.currency).toBe("ARS");
      expect(body.type).toBe(AccountType.CUSTOMER_WALLET);
    });

    it("201: creates a SYSTEM_CLEARING account", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "system", currency: "ARS", type: AccountType.SYSTEM_CLEARING },
      });
      expect(res.statusCode).toBe(201);
    });

    it("201: creates an EXTERNAL account", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "ext-1", currency: "USD", type: AccountType.EXTERNAL },
      });
      expect(res.statusCode).toBe(201);
    });

    it("409: AccountAlreadyExistsError when id is taken", async () => {
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "dup", currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "dup", currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe("conflict");
    });

    it("400: missing id field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400: invalid type value", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "x", currency: "ARS", type: "INVALID_TYPE" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400: missing currency", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "x", type: AccountType.CUSTOMER_WALLET },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /transfers ────────────────────────────────────────────────────────

  describe("POST /transfers", () => {
    // Seed common accounts and initial funds before each transfer test
    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "sys", currency: "ARS", type: AccountType.SYSTEM_CLEARING },
      });
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "w-a", currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "w-b", currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });

      // Fund w-a with 10000 ARS from sys
      await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "seed-wa",
          fromAccountId: "sys",
          toAccountId: "w-a",
          amount: { minor: "10000", currency: "ARS" },
        },
      });
    });

    it("201: transfers funds and returns correct shape", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-http-1",
          fromAccountId: "w-a",
          toAccountId: "w-b",
          amount: { minor: "3000", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{
        id: string;
        occurredAt: string;
        postings: { accountId: string; amount: { minor: string; currency: string } }[];
      }>();
      expect(body.id).toBe("tx-http-1");
      expect(typeof body.occurredAt).toBe("string");
      expect(body.postings).toHaveLength(2);

      // minor es string (nunca number)
      const waPosting = body.postings.find((p) => p.accountId === "w-a");
      expect(waPosting?.amount.minor).toBe("-3000");
      expect(typeof waPosting?.amount.minor).toBe("string");
    });

    it("404: AccountNotFoundError for unknown fromAccount", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-404",
          fromAccountId: "ghost",
          toAccountId: "w-b",
          amount: { minor: "100", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe("not_found");
    });

    it("404: AccountNotFoundError for unknown toAccount", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-404b",
          fromAccountId: "w-a",
          toAccountId: "ghost",
          amount: { minor: "100", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("422: OverdraftError when CUSTOMER_WALLET lacks funds", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-422",
          fromAccountId: "w-a",
          toAccountId: "w-b",
          amount: { minor: "99999999", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe("overdraft");
    });

    it("400: missing id field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          fromAccountId: "w-a",
          toAccountId: "w-b",
          amount: { minor: "100", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400: amount.minor is not a valid integer string", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-bad",
          fromAccountId: "w-a",
          toAccountId: "w-b",
          amount: { minor: "12.5", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400: amount.minor must be a string, not a JS number", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-bad2",
          fromAccountId: "w-a",
          toAccountId: "w-b",
          amount: { minor: 100, currency: "ARS" }, // number, not string
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400: amount.minor must be positive", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-bad3",
          fromAccountId: "w-a",
          toAccountId: "w-b",
          amount: { minor: "0", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400: missing amount object", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-bad4",
          fromAccountId: "w-a",
          toAccountId: "w-b",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /accounts/:id/balance ──────────────────────────────────────────────

  describe("GET /accounts/:id/balance", () => {
    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "sys", currency: "ARS", type: AccountType.SYSTEM_CLEARING },
      });
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "w-c", currency: "ARS", type: AccountType.CUSTOMER_WALLET },
      });
    });

    it("200: returns zero balance for new account with no transactions", async () => {
      const res = await app.inject({ method: "GET", url: "/accounts/w-c/balance" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accountId: string; balance: { minor: string; currency: string } }>();
      expect(body.accountId).toBe("w-c");
      expect(body.balance.minor).toBe("0");
      expect(typeof body.balance.minor).toBe("string");
      expect(body.balance.currency).toBe("ARS");
    });

    it("200: returns correct balance after a transfer", async () => {
      await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "seed-wc",
          fromAccountId: "sys",
          toAccountId: "w-c",
          amount: { minor: "5000", currency: "ARS" },
        },
      });

      const res = await app.inject({ method: "GET", url: "/accounts/w-c/balance" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accountId: string; balance: { minor: string; currency: string } }>();
      expect(body.balance.minor).toBe("5000");
    });

    it("404: AccountNotFoundError for unknown account", async () => {
      const res = await app.inject({ method: "GET", url: "/accounts/nobody/balance" });
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe("not_found");
    });

    it("balance.minor is always a string (never a JS number), even for large values", async () => {
      await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "seed-wc2",
          fromAccountId: "sys",
          toAccountId: "w-c",
          amount: { minor: "9007199254740993", currency: "ARS" }, // > MAX_SAFE_INTEGER
        },
      });

      const res = await app.inject({ method: "GET", url: "/accounts/w-c/balance" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ accountId: string; balance: { minor: string; currency: string } }>();
      expect(body.balance.minor).toBe("9007199254740993");
      expect(typeof body.balance.minor).toBe("string");
    });
  });

  // ── Aislamiento entre tests ─────────────────────────────────────────────────

  it("state is isolated between tests: no leaked data from other describe blocks", async () => {
    // makeApp() en beforeEach crea una instancia fresca; no hay datos de otros tests
    const res = await app.inject({ method: "GET", url: "/accounts/isolation-check/balance" });
    expect(res.statusCode).toBe(404);
  });

  // ── Idempotencia HTTP (Fase 3c) ────────────────────────────────────────────

  describe("POST /transfers — Idempotency-Key (Fase 3c)", () => {
    async function seedAccounts() {
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "sys", currency: "ARS", type: "SYSTEM_CLEARING" },
      });
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "wa", currency: "ARS", type: "CUSTOMER_WALLET" },
      });
      await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { id: "wb", currency: "ARS", type: "CUSTOMER_WALLET" },
      });
      // Fondear wa con 2000 ARS desde sys
      await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "seed-http",
          fromAccountId: "sys",
          toAccountId: "wa",
          amount: { minor: "2000", currency: "ARS" },
        },
      });
    }

    it("201: alta sin header Idempotency-Key sigue funcionando igual que 3b", async () => {
      await seedAccounts();
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        payload: {
          id: "tx-no-key-http",
          fromAccountId: "wa",
          toAccountId: "wb",
          amount: { minor: "100", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      expect(body.id).toBe("tx-no-key-http");
    });

    it("201: alta con Idempotency-Key nueva", async () => {
      await seedAccounts();
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-001" },
        payload: {
          id: "tx-http-idem-1",
          fromAccountId: "wa",
          toAccountId: "wb",
          amount: { minor: "200", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      expect(body.id).toBe("tx-http-idem-1");
    });

    it("200: replay — segunda petición con misma clave retorna mismo body", async () => {
      await seedAccounts();
      const payload = {
        id: "tx-http-replay",
        fromAccountId: "wa",
        toAccountId: "wb",
        amount: { minor: "300", currency: "ARS" },
      };

      const r1 = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-replay" },
        payload,
      });
      expect(r1.statusCode).toBe(201);

      const r2 = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-replay" },
        payload,
      });
      expect(r2.statusCode).toBe(200);

      // Mismo body
      expect(r2.json()).toEqual(r1.json());
    });

    it("200: replay devuelve los postings originales correctos", async () => {
      await seedAccounts();
      const payload = {
        id: "tx-http-replay-postings",
        fromAccountId: "wa",
        toAccountId: "wb",
        amount: { minor: "150", currency: "ARS" },
      };

      await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-replay-postings" },
        payload,
      });

      const r2 = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-replay-postings" },
        payload,
      });
      expect(r2.statusCode).toBe(200);
      const body = r2.json<{ postings: { accountId: string; amount: { minor: string } }[] }>();
      const toPosting = body.postings.find((p) => p.accountId === "wb");
      expect(toPosting?.amount.minor).toBe("150");
    });

    it("409: misma clave con payload distinto → idempotency_conflict", async () => {
      await seedAccounts();

      await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-conflict" },
        payload: {
          id: "tx-conflict-orig",
          fromAccountId: "wa",
          toAccountId: "wb",
          amount: { minor: "100", currency: "ARS" },
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "http-key-conflict" },
        payload: {
          id: "tx-conflict-orig",
          fromAccountId: "wa",
          toAccountId: "wb",
          amount: { minor: "999", currency: "ARS" }, // distinto
        },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe("idempotency_conflict");
    });

    it("400: Idempotency-Key vacío → bad_request", async () => {
      await seedAccounts();
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "" },
        payload: {
          id: "tx-empty-key",
          fromAccountId: "wa",
          toAccountId: "wb",
          amount: { minor: "100", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe("bad_request");
    });

    it("400: Idempotency-Key solo whitespace → bad_request", async () => {
      await seedAccounts();
      const res = await app.inject({
        method: "POST",
        url: "/transfers",
        headers: { "idempotency-key": "   " },
        payload: {
          id: "tx-ws-key",
          fromAccountId: "wa",
          toAccountId: "wb",
          amount: { minor: "100", currency: "ARS" },
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
