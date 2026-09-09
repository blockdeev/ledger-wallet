import Fastify, { type FastifyInstance } from "fastify";
import type { Logger as PinoInstance } from "pino";
import { CreateAccount } from "../../../application/use-cases/create-account.js";
import { Transfer } from "../../../application/use-cases/transfer.js";
import { GetBalance } from "../../../application/use-cases/get-balance.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerTransferRoutes } from "./routes/transfers.js";
import { registerBalanceRoutes } from "./routes/balance.js";
import { runWithRequestId } from "../../observability/request-context.js";

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
 *
 * @param deps - Casos de uso inyectados (opcional; si se omite, solo /health queda activo).
 * @param pinoInstance - Instancia pino para nivel configurable (opcional).
 *   Si se provee, se usa como loggerInstance de Fastify para compartir nivel con el
 *   composition root. Si no, usa logger:true (default pino de Fastify), preservando
 *   compatibilidad con tests existentes que llaman buildApp sin pino. Ver ADR 0012.
 */
export function buildApp(deps?: AppDependencies, pinoInstance?: PinoInstance): FastifyInstance {
  // Si se pasa una instancia pino concreta, usarla como loggerInstance (comparte nivel
  // configurable). Si no, usar logger:true preservando compatibilidad con tests sin pino.
  // Se usa `as FastifyInstance` para evitar que TS infiera una unión de dos sobrecargas
  // de Fastify con parámetros genéricos distintos, que de lo contrario resulta en un
  // tipo inasignable en ambas ramas (pino Logger vs FastifyBaseLogger).
  const app = (
    pinoInstance
      ? Fastify({ loggerInstance: pinoInstance })
      : Fastify({ logger: true })
  ) as FastifyInstance;

  // Hook onRequest: propaga el requestId de Fastify al AsyncLocalStorage.
  //
  // Fastify no expone una API de middleware de envoltura como Express; onRequest es un
  // hook puntual. El patrón elegido: iniciar runWithRequestId dentro del hook y llamar
  // done() dentro del callback async. Node.js propaga el contexto ALS a todos los
  // callbacks y promesas encadenadas dentro de la misma continuación, incluyendo los
  // handlers de ruta que Fastify encola después de que onRequest resuelve.
  // De este modo, cualquier log emitido por los casos de uso durante ese request lleva
  // automáticamente el mismo requestId. Ver ADR 0012 para justificación detallada.
  app.addHook("onRequest", (request, _reply, done) => {
    // runWithRequestId envuelve done() en el contexto ALS del requestId actual.
    // La función pasada no necesita ser async; done() es síncrono.
    void runWithRequestId(request.id, () => {
      done();
      return Promise.resolve();
    });
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
