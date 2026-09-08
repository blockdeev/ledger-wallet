import { FastifyInstance } from "fastify";
import { GetBalance } from "../../../../application/use-cases/get-balance.js";
import { handleDomainError } from "../error-mapper.js";

interface BalanceParams {
  id: string;
}

/**
 * Registra la ruta de consulta de saldo en la instancia de Fastify.
 *
 * GET /accounts/:id/balance
 *   200: { accountId: string, balance: { minor: string, currency: string } }
 *        `minor` es string para preservar precisión de bigint (NUNCA number).
 *   404: AccountNotFoundError
 */
export function registerBalanceRoutes(app: FastifyInstance, getBalance: GetBalance): void {
  app.get("/accounts/:id/balance", async (request, reply) => {
    const { id: accountId } = request.params as BalanceParams;

    try {
      const balance = await getBalance.execute({ accountId });
      return await reply.status(200).send({
        accountId,
        balance: {
          minor: balance.minor.toString(),
          currency: balance.currency,
        },
      });
    } catch (err) {
      return handleDomainError(err, reply);
    }
  });
}
