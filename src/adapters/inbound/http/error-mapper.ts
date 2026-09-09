import { FastifyReply } from "fastify";
import {
  AccountNotFoundError,
  AccountAlreadyExistsError,
  IdempotencyConflictError,
} from "../../../application/errors.js";
import { OverdraftError, CurrencyMismatchError } from "../../../domain/errors.js";

/**
 * Mapea errores de dominio/aplicación a respuestas HTTP.
 *
 * El dominio no conoce HTTP; la responsabilidad de traducción está SOLO aquí,
 * en el adapter de entrada HTTP. Los casos de uso no dependen de esto.
 *
 * Mapeo:
 *   AccountAlreadyExistsError  → 409 Conflict
 *   AccountNotFoundError       → 404 Not Found
 *   OverdraftError             → 422 Unprocessable Entity
 *   IdempotencyConflictError   → 409 Conflict  (misma clave, payload distinto)
 *   CurrencyMismatchError      → 422 Unprocessable Entity
 *   cualquier otro error       → 500 Internal Server Error
 */
export function handleDomainError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof AccountAlreadyExistsError) {
    return reply.status(409).send({ error: "conflict", message: err.message });
  }
  if (err instanceof AccountNotFoundError) {
    return reply.status(404).send({ error: "not_found", message: err.message });
  }
  if (err instanceof OverdraftError) {
    return reply.status(422).send({ error: "overdraft", message: err.message });
  }
  if (err instanceof IdempotencyConflictError) {
    return reply.status(409).send({ error: "idempotency_conflict", message: err.message });
  }
  if (err instanceof CurrencyMismatchError) {
    return reply.status(422).send({ error: "currency_mismatch", message: err.message });
  }
  // Error inesperado: relanzar para que Fastify lo maneje con 500
  throw err;
}
