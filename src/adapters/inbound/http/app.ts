import Fastify, { type FastifyInstance } from "fastify";
import { CreateAccount } from "../../../application/use-cases/create-account.js";
import { Transfer } from "../../../application/use-cases/transfer.js";
import { GetBalance } from "../../../application/use-cases/get-balance.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerTransferRoutes } from "./routes/transfers.js";
import { registerBalanceRoutes } from "./routes/balance.js";

/**
 * Dependencias inyectadas en la app HTTP.
 * Permite usar adapters distintos en tests (in-memory) vs producción (Postgres).
 */
export interface AppDependencies {
  createAccount: CreateAccount;
  transfer: Transfer;
  getBalance: GetBalance;
}

/**
 * Construye y configura la instancia de Fastify.
 *
 * Registra todas las rutas:
 *   GET  /health
 *   POST /accounts
 *   POST /transfers
 *   GET  /accounts/:id/balance
 *
 * Si se omiten las dependencias (para tests del health check), los endpoints
 * de negocio no se registran.
 */
export function buildApp(deps?: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", () => {
    return { status: "ok" };
  });

  if (deps !== undefined) {
    registerAccountRoutes(app, deps.createAccount);
    registerTransferRoutes(app, deps.transfer);
    registerBalanceRoutes(app, deps.getBalance);
  }

  return app;
}
