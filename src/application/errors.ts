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
