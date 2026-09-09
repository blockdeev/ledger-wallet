/**
 * Jerarquía de errores de la capa de aplicación.
 * Representan fallas a nivel caso de uso (cuenta no encontrada en repositorio,
 * duplicados, etc.) — distintos de los DomainError que son invariantes del modelo.
 */

export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    const nodeError = Error as unknown as { captureStackTrace?: (t: object, c: unknown) => void };
    if (typeof nodeError.captureStackTrace === "function") {
      nodeError.captureStackTrace(this, this.constructor);
    }
  }
}

/** Se lanza cuando se busca una cuenta por id y no existe en el repositorio. */
export class AccountNotFoundError extends ApplicationError {
  constructor(accountId: string) {
    super(`Account not found: '${accountId}' does not exist in the repository.`);
  }
}

/** Se lanza cuando se intenta crear una cuenta con un id que ya existe. */
export class AccountAlreadyExistsError extends ApplicationError {
  constructor(accountId: string) {
    super(`Account already exists: '${accountId}' is already registered.`);
  }
}

/**
 * Señal interna: el adapter de idempotencia detectó una violación de unicidad
 * al intentar insertar una clave que ya existe en el backing store.
 *
 * En Postgres se traduce desde SQLSTATE 23505 (unique_violation) dentro del
 * adapter, NUNCA en la capa de aplicación (el puerto no importa pg).
 * El use case Transfer la captura para reintentar el camino de replay.
 * No debe llegar al HTTP en operación normal.
 */
export class DuplicateIdempotencyKeyError extends ApplicationError {
  constructor(key: string) {
    super(`Duplicate idempotency key: '${key}' already exists.`);
  }
}

/**
 * Se lanza cuando se recibe la misma Idempotency-Key con un payload distinto
 * (fingerprint diferente). Indica que el cliente está reutilizando una clave
 * para una operación diferente, lo cual es un error del cliente.
 *
 * → HTTP 409 Conflict (via error-mapper).
 */
export class IdempotencyConflictError extends ApplicationError {
  constructor(key: string) {
    super(
      `Idempotency conflict: key '${key}' was already used with a different payload.`
    );
  }
}
