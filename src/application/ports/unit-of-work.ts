import { AccountRepository } from "./account-repository.js";
import { TransactionRepository } from "./transaction-repository.js";

/**
 * Contexto transaccional: versiones de los repositorios ligadas a una transacción de DB.
 *
 * `lockAccounts` adquiere un lock pesimista sobre las filas de cuentas dadas.
 * En el adapter Postgres utiliza `SELECT ... FOR UPDATE ORDER BY id` para evitar
 * deadlocks entre transferencias concurrentes en sentidos opuestos (A→B y B→A).
 * En el adapter in-memory es un no-op (JS es single-threaded; no hay carrera real).
 */
export interface TransactionalContext {
  accounts: AccountRepository;
  transactions: TransactionRepository;
  lockAccounts(accountIds: string[]): Promise<void>;
}

/**
 * Puerto de salida: Unit of Work.
 *
 * Permite que los casos de uso ejecuten un bloque de lógica de manera atómica
 * sin conocer los detalles de la transacción de base de datos.
 *
 * Decisión de diseño (ver ADR 0010):
 *   - El puerto vive en la capa de aplicación para que Transfer pueda depender de él
 *     sin acoplarse a Kysely, pg, ni ningún adapter concreto.
 *   - `transaction<T>` envuelve todo el trabajo en una única transacción de DB:
 *     si `work` lanza, se hace rollback automático.
 *   - `lockAccounts` se llama DENTRO de `work`, con los ids en orden canónico,
 *     para serializar transferencias concurrentes sobre las mismas cuentas.
 */
export interface UnitOfWork {
  transaction<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T>;
}
