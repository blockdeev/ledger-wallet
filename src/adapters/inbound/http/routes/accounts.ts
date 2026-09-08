import { FastifyInstance } from "fastify";
import { CreateAccount } from "../../../../application/use-cases/create-account.js";
import { AccountType } from "../../../../domain/account.js";
import { handleDomainError } from "../error-mapper.js";

interface CreateAccountBody {
  id?: unknown;
  currency?: unknown;
  type?: unknown;
}

/**
 * Registra las rutas de cuentas en la instancia de Fastify.
 *
 * POST /accounts
 *   Body: { id: string, currency: string, type: AccountType }
 *   201: { id, currency, type }
 *   409: AccountAlreadyExistsError
 *   400: body inválido
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  createAccount: CreateAccount
): void {
  app.post("/accounts", async (request, reply) => {
    const body = request.body as CreateAccountBody;

    if (typeof body.id !== "string" || typeof body.currency !== "string" || typeof body.type !== "string") {
      return reply.status(400).send({
        error: "bad_request",
        message: "Body must contain string fields: id, currency, type",
      });
    }

    const validTypes: string[] = Object.values(AccountType);
    if (!validTypes.includes(body.type)) {
      return reply.status(400).send({
        error: "bad_request",
        message: `Invalid account type. Must be one of: ${validTypes.join(", ")}`,
      });
    }

    try {
      const account = await createAccount.execute({
        id: body.id,
        currency: body.currency,
        type: body.type as AccountType,
      });
      return await reply.status(201).send({
        id: account.id,
        currency: account.currency,
        type: account.type,
      });
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });
}
