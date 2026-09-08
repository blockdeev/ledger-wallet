/**
 * Corre los contract tests contra los adapters in-memory.
 *
 * Este archivo es la "prueba rápida" del contract: sin Docker, sin DB.
 * Los mismos contracts corren contra Postgres en test/adapters/postgres/
 * (test:integration, con testcontainers).
 *
 * Decisión: se agrega este archivo nuevo en lugar de refactorizar
 * test/adapters/in-memory-repositories.test.ts, para no modificar
 * los tests existentes de Fase 2 (brief dice no tocar in-memory salvo opcional).
 * Los tests originales siguen corriendo; este los complementa con el contrato.
 */
import { InMemoryAccountRepository } from "../../../src/adapters/outbound/persistence/in-memory/in-memory-account-repository.js";
import { InMemoryTransactionRepository } from "../../../src/adapters/outbound/persistence/in-memory/in-memory-transaction-repository.js";
import { runAccountRepositoryContract } from "./account-repository.contract.js";
import { runTransactionRepositoryContract } from "./transaction-repository.contract.js";

// In-memory: cada test recibe su propia instancia (makeRepo crea una nueva)
runAccountRepositoryContract(() => new InMemoryAccountRepository());
runTransactionRepositoryContract(() => new InMemoryTransactionRepository());
