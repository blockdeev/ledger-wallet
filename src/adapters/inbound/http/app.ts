import Fastify, { type FastifyInstance } from "fastify";
import type { Logger as PinoInstance } from "pino";
import type { Registry } from "prom-client";
import { createRequire } from "module";
import { CreateAccount } from "../../../application/use-cases/create-account.js";
import { Transfer } from "../../../application/use-cases/transfer.js";
import { GetBalance } from "../../../application/use-cases/get-balance.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerTransferRoutes } from "./routes/transfers.js";
import { registerBalanceRoutes } from "./routes/balance.js";
import { runWithRequestId } from "../../observability/request-context.js";

// El adapter HTTP es infraestructura y puede importar OTel directamente (ADR 0014).
// El span raíz por request se crea aquí para que los spans de los casos de uso sean sus hijos.
const require = createRequire(import.meta.url);
const otelApi = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
const { trace, SpanStatusCode, context } = otelApi;

/**
 * Dependencias inyectadas en la app HTTP.
 * Permite usar adapters distintos en tests (in-memory) vs producción (Postgres).
 */
export interface AppDependencies {
  createAccount: CreateAccount;
  transfer: Transfer;
  getBalance: GetBalance;
  /**
   * Registry de Prometheus para exponer métricas en GET /metrics.
   * Opcional: si se omite, la ruta /metrics no se registra.
   * En producción lo provee compose(); en tests se puede omitir o pasar uno propio.
   */
  metricsRegistry?: Registry;
}

/**
 * Construye y configura la instancia de Fastify.
 *
 * Registra todas las rutas:
 *   GET  /health
 *   GET  /metrics  (solo si deps.metricsRegistry está presente)
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
  const app = (
    pinoInstance
      ? Fastify({ loggerInstance: pinoInstance })
      : Fastify({ logger: true })
  ) as FastifyInstance;

  app.addHook("onRequest", (request, reply, done) => {
    // Span raíz por request HTTP: nombre "METHOD /route", atributo requestId para
    // correlacionar trazas con logs (ADR 0014). El span raíz envuelve el ciclo del
    // request; los spans de los casos de uso anidan automáticamente por contexto OTel.
    const spanName = `${request.method} ${request.url}`;
    const httpTracer = trace.getTracer("ledger-wallet-http");

    httpTracer.startActiveSpan(spanName, (rootSpan) => {
      rootSpan.setAttribute("http.request_id", request.id);

      // Cerrar el span raíz cuando la respuesta se envíe
      reply.raw.once("finish", () => {
        const statusCode = reply.statusCode;
        if (statusCode >= 500) {
          rootSpan.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          rootSpan.setStatus({ code: SpanStatusCode.OK });
        }
        rootSpan.setAttribute("http.status_code", statusCode);
        rootSpan.end();
      });

      // Ejecutar el ciclo del request dentro del contexto OTel activo + ALS de requestId.
      // context.with preserva el contexto OTel en el ALS interno de OTel;
      // runWithRequestId preserva el requestId en nuestro propio ALS de correlación.
      void context.with(context.active(), () => {
        return runWithRequestId(request.id, () => {
          done();
          return Promise.resolve();
        });
      });
    });
  });

  app.get("/health", () => {
    return { status: "ok" };
  });

  if (deps !== undefined) {
    // GET /metrics: endpoint de scraping Prometheus (sin auth; ver ADR 0013).
    // Solo se registra si se provee un registry; en tests sin métricas se puede omitir.
    if (deps.metricsRegistry !== undefined) {
      const registry = deps.metricsRegistry;
      app.get("/metrics", async (_request, reply) => {
        const body = await registry.metrics();
        await reply
          .header("Content-Type", registry.contentType)
          .send(body);
      });
    }

    registerAccountRoutes(app, deps.createAccount);
    registerTransferRoutes(app, deps.transfer);
    registerBalanceRoutes(app, deps.getBalance);
  }

  return app;
}
