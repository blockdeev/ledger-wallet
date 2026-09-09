import { Kysely } from "kysely";
import {
  IdempotencyRecord,
  IdempotencyRepository,
} from "../../../../application/ports/idempotency-repository.js";
import { DuplicateIdempotencyKeyError } from "../../../../application/errors.js";
import { Database } from "./db.js";

/**
 * Adapter Postgres del puerto IdempotencyRepository.
 *
 * Construible sobre `Kysely<Database>` (puede ser una transacción Kysely,
 * que extiende `Kysely<Database>`, por lo que el mismo constructor funciona
 * dentro y fuera de una transacción).
 *
 * Decisión de diseño (ver ADR 0011):
 *   `save` hace un INSERT directo; si la fila ya existe, Postgres lanza una
 *   violación de unicidad (SQLSTATE 23505). Esta clase captura ese error
 *   y lo traduce a `DuplicateIdempotencyKeyError` (error de aplicación).
 *   La traducción VIVE AQUÍ, en el adapter, y nunca en la capa de aplicación.
 *
 *   Este diseño es el corazón del mecanismo reserve-first:
 *     - El primero en insertar gana (la constraint resuelve la carrera).
 *     - El perdedor recibe DuplicateIdempotencyKeyError, su transacción
 *       de DB hace ROLLBACK, y el use case reintenta como replay.
 */
export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findByKey(key: string): Promise<IdempotencyRecord | undefined> {
    const row = await this.db
      .selectFrom("idempotency_keys")
      .select(["key", "transaction_id", "fingerprint"])
      .where("key", "=", key)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    return {
      key: row.key,
      transactionId: row.transaction_id,
      fingerprint: row.fingerprint,
    };
  }

  async save(record: IdempotencyRecord): Promise<void> {
    try {
      await this.db
        .insertInto("idempotency_keys")
        .values({
          key: record.key,
          transaction_id: record.transactionId,
          fingerprint: record.fingerprint,
        })
        .execute();
    } catch (err: unknown) {
      // Traducir violación de unicidad de Postgres (SQLSTATE 23505) al error de aplicación.
      // La comprobación vive aquí, en el adapter, sin que la capa de aplicación importe pg.
      if (isUniqueViolation(err)) {
        throw new DuplicateIdempotencyKeyError(record.key);
      }
      throw err;
    }
  }
}

/**
 * Verifica si un error de Kysely/pg corresponde a una violación de unicidad.
 * SQLSTATE 23505 = unique_violation.
 * pg expone el código en `err.code`; Kysely propaga el error original de pg.
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return false;
  }
  return (err as Record<string, unknown>).code === "23505";
}
