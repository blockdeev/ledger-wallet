import { FastifyInstance } from "fastify";
import { Transfer } from "../../../../application/use-cases/transfer.js";
import { Money } from "../../../../domain/money.js";
import { handleDomainError } from "../error-mapper.js";

interface AmountBody {
  minor?: unknown;
  currency?: unknown;
}

interface TransferBody {
  id?: unknown;
  fromAccountId?: unknown;
  toAccountId?: unknown;
  amount?: unknown;
}

/**
 * Registra las rutas de transferencias en la instancia de Fastify.
 *
 * POST /transfers
 *   Header:  Idempotency-Key (opcional)
 *   Body: { id: string, fromAccountId: string, toAccountId: string,
 *           amount: { minor: string, currency: string } }
 *   `minor` es string para preservar precisión de bigint (NUNCA number).
 *
 * Semántica del header Idempotency-Key:
 *   - Ausente → comportamiento idéntico a Fase 3b (201 siempre).
 *   - Presente y vacío/solo whitespace → 400 bad_request.
 *   - Presente y válido:
 *       Alta nueva  → 201 { id, occurredAt, postings }
 *       Replay      → 200 { id, occurredAt, postings }  (mismo body, sin mover dinero)
 *       Conflicto   → 409 { error: "idempotency_conflict" }  (misma clave, body distinto)
 *
 * Nota: Fastify normaliza los nombres de header a minúscula (HTTP/2 semántica),
 * por lo que se accede como `request.headers["idempotency-key"]`.
 */
export function registerTransferRoutes(app: FastifyInstance, transfer: Transfer): void {
  app.post("/transfers", async (request, reply) => {
    // Leer y validar Idempotency-Key header
    const rawKey = request.headers["idempotency-key"];
    // Fastify puede devolver string | string[] | undefined
    const idempotencyKeyRaw =
      rawKey === undefined ? undefined : Array.isArray(rawKey) ? rawKey[0] : rawKey;

    let idempotencyKey: string | undefined;
    if (idempotencyKeyRaw !== undefined) {
      const trimmed = idempotencyKeyRaw.trim();
      if (trimmed === "") {
        return reply.status(400).send({
          error: "bad_request",
          message: "Idempotency-Key header is present but empty or whitespace.",
        });
      }
      idempotencyKey = trimmed;
    }

    // Validar body
    const body = request.body as TransferBody;

    if (
      typeof body.id !== "string" ||
      typeof body.fromAccountId !== "string" ||
      typeof body.toAccountId !== "string" ||
      typeof body.amount !== "object" ||
      body.amount === null
    ) {
      return reply.status(400).send({
        error: "bad_request",
        message: "Body must contain: id, fromAccountId, toAccountId, amount: { minor, currency }",
      });
    }

    const amountObj = body.amount as AmountBody;
    if (typeof amountObj.minor !== "string" || typeof amountObj.currency !== "string") {
      return reply.status(400).send({
        error: "bad_request",
        message: "amount.minor must be a string (bigint en unidades mínimas) and amount.currency must be a string",
      });
    }

    let minor: bigint;
    try {
      minor = BigInt(amountObj.minor);
    } catch {
      return reply.status(400).send({
        error: "bad_request",
        message: `amount.minor is not a valid integer string: "${amountObj.minor}"`,
      });
    }

    if (minor <= 0n) {
      return reply.status(400).send({
        error: "bad_request",
        message: "amount.minor must be a positive integer",
      });
    }

    try {
      const transferInput = {
        id: body.id,
        fromAccountId: body.fromAccountId,
        toAccountId: body.toAccountId,
        amount: Money.fromMinor(minor, amountObj.currency),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      };
      const result = await transfer.execute(transferInput);

      const { transaction: tx, replayed } = result;
      const responseBody = {
        id: tx.id,
        occurredAt: tx.occurredAt.toISOString(),
        postings: tx.postings.map((p) => ({
          accountId: p.accountId,
          amount: {
            minor: p.amount.minor.toString(),
            currency: p.amount.currency,
          },
        })),
      };

      // Decisión deliberada (ADR 0011): replay → 200, alta → 201.
      const status = replayed ? 200 : 201;
      return await reply.status(status).send(responseBody);
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });
}
