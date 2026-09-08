/**
 * Composition root: ensambla todos los adapters y casos de uso.
 *
 * Orden de wiring:
 *   1. loadConfig()  →  AppConfig (fail-fast en arranque)
 *   2. createDb()    →  Kysely<Database>
 *   3. Repos Postgres directos (usados por CreateAccount y GetBalance)
 *   4. PostgresUnitOfWork (usado por Transfer)
 *   5. Casos de uso
 *   6. buildApp({ createAccount, transfer, getBalance })
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
import { Kysely } from "kysely";
import { Database } from "./adapters/outbound/persistence/postgres/db.js";
import type { FastifyInstance } from "fastify";

export interface CompositionRoot {
  app: FastifyInstance;
  db: Kysely<Database>;
}

export function compose(config: AppConfig): CompositionRoot {
  // 2. DB connection
  const db = createDb(config.databaseUrl);

  // 3. Repos directos para casos de uso sin UoW
  const accountRepo = new PostgresAccountRepository(db);
  const txRepo = new PostgresTransactionRepository(db);

  // 4. Unit of Work para Transfer (transacciones atómicas con locking)
  const uow = new PostgresUnitOfWork(db);

  // 5. Casos de uso
  const createAccount = new CreateAccount(accountRepo);
  const transfer = new Transfer(uow);
  const getBalance = new GetBalance(accountRepo, txRepo);

  // 6. App HTTP
  const deps: AppDependencies = { createAccount, transfer, getBalance };
  const app = buildApp(deps);

  return { app, db };
}
