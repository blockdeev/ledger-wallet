/**
 * Composition root: ensambla todos los adapters y casos de uso.
 *
 * Orden de wiring:
 *   1. loadConfig()   →  AppConfig (fail-fast en arranque)
 *   2. createDb()     →  Kysely<Database>
 *   3. pino + PinoLogger (nivel desde config.logLevel)
 *   4. PrometheusMetrics (registry propio; pasado a casos de uso y a /metrics)
 *   5. OtelTracer (adapter de tracing; inerte si no hay OTEL_EXPORTER_OTLP_ENDPOINT)
 *   6. Repos Postgres directos (usados por CreateAccount y GetBalance)
 *   7. PostgresUnitOfWork (usado por Transfer)
 *   8. Casos de uso (con logger + metrics + tracer inyectados)
 *   9. buildApp({ createAccount, transfer, getBalance, metricsRegistry }, pinoInstance)
 *
 * La app asume la DB ya migrada (Juan corre `npm run migrate` antes de iniciar).
 */

import { AppConfig } from "./config/env.js";
import { createDb } from "./adapters/outbound/persistence/postgres/db.js";
import { PostgresAccountRepository } from "./adapters/outbound/persistence/postgres/postgres-account-repository.js";
import { PostgresTransactionRepository } from "./adapters/outbound/persistence/postgres/postgres-transaction-repository.js";
import { PostgresUnitOfWork } from "./adapters/outbound/persistence/postgres/postgres-unit-of-work.js";
import { CreateAccount } from "./application/use-cases/create-account.js";
import { Transfer } from "./application/use-cases/transfer.js";
import { GetBalance } from "./application/use-cases/get-balance.js";
import { buildApp, AppDependencies } from "./adapters/inbound/http/app.js";
import { PinoLogger } from "./adapters/observability/pino-logger.js";
import { PrometheusMetrics } from "./adapters/observability/prometheus-metrics.js";
import { OtelTracer } from "./adapters/observability/otel-tracer.js";
import { Kysely } from "kysely";
import { Database } from "./adapters/outbound/persistence/postgres/db.js";
import type { FastifyInstance } from "fastify";
import pino from "pino";

export interface CompositionRoot {
  app: FastifyInstance;
  db: Kysely<Database>;
}

export function compose(config: AppConfig): CompositionRoot {
  // 2. DB connection
  const db = createDb(config.databaseUrl);

  // 3. Logging: instancia pino compartida entre Fastify (req logs) y PinoLogger (negocio)
  const pinoInstance = pino({ level: config.logLevel });
  const logger = new PinoLogger(pinoInstance);

  // 4. Métricas: registry propio de Prometheus (no el global; ver ADR 0013)
  const prometheusMetrics = new PrometheusMetrics();

  // 5. Tracing: inerte si no hay OTEL_EXPORTER_OTLP_ENDPOINT (ver ADR 0014)
  const tracer = new OtelTracer();

  // 6. Repos directos para casos de uso sin UoW
  const accountRepo = new PostgresAccountRepository(db);
  const txRepo = new PostgresTransactionRepository(db);

  // 7. Unit of Work para Transfer (transacciones atómicas con locking)
  const uow = new PostgresUnitOfWork(db);

  // 8. Casos de uso (logger + metrics + tracer inyectados)
  const createAccount = new CreateAccount(accountRepo, logger, prometheusMetrics, tracer);
  const transfer = new Transfer(uow, logger, prometheusMetrics, tracer);
  const getBalance = new GetBalance(accountRepo, txRepo, logger, undefined, tracer);

  // 9. App HTTP (recibe pinoInstance para nivel configurable y registry para /metrics)
  const deps: AppDependencies = {
    createAccount,
    transfer,
    getBalance,
    metricsRegistry: prometheusMetrics.registry,
  };
  const app = buildApp(deps, pinoInstance);

  return { app, db };
}
