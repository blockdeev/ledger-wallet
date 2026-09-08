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
 *   Body: { id: string, fromAccountId: string, toAccountId: string,
 *           amount: { minor: string, currency: string } }
 *   `minor` es string para preservar precisión de bigint (NUNCA number).
 *   201: { id, occurredAt, postings: [{ accountId, amount: { minor: string, currency } }] }
 *   404: AccountNotFoundError
 *   422: OverdraftError
 *   400: body inválido (incluye minor no parseable como bigint)
 */
export function registerTransferRoutes(app: FastifyInstance, transfer: Transfer): void {
  app.post("/transfers", async (request, reply) => {
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
        message: "amount.minor must be a string (bigint in unidades mínimas) and amount.currency must be a string",
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
      const tx = await transfer.execute({
        id: body.id,
        fromAccountId: body.fromAccountId,
        toAccountId: body.toAccountId,
        amount: Money.fromMinor(minor, amountObj.currency),
      });

      return await reply.status(201).send({
        id: tx.id,
        occurredAt: tx.occurredAt.toISOString(),
        postings: tx.postings.map((p) => ({
          accountId: p.accountId,
          amount: {
            minor: p.amount.minor.toString(),
            currency: p.amount.currency,
          },
        })),
      });
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });
}
