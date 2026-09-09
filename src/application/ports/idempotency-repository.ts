/**
 * Puerto de salida: repositorio de claves de idempotencia.
 *
 * Permite al caso de uso Transfer registrar y consultar claves de idempotencia
 * sin conocer detalles de persistencia (Postgres, in-memory, etc.).
 *
 * Decisión de diseño (ver ADR 0011):
 *   - `findByKey` devuelve `undefined` si la clave no existe (no lanza).
 *   - `save` lanza `DuplicateIdempotencyKeyError` si la clave ya existe.
 *     En Postgres esto se traduce desde la violación UNIQUE (SQLSTATE 23505);
 *     en in-memory se implementa con un Map y una comprobación explícita.
 *   - La traducción del error de DB vive en el ADAPTER Postgres, nunca aquí.
 */

export interface IdempotencyRecord {
  /** La clave de idempotencia provista por el cliente. */
  key: string;
  /** Id de la LedgerTransaction creada. */
  transactionId: string;
  /**
   * Fingerprint determinístico del input original.
   * Permite detectar dos requests con la misma clave pero body distinto
   * y lanzar IdempotencyConflictError.
   */
  fingerprint: string;
}

export interface IdempotencyRepository {
  /** Busca un registro por clave. Devuelve `undefined` si no existe. */
  findByKey(key: string): Promise<IdempotencyRecord | undefined>;
  /**
   * Persiste un nuevo registro.
   * @throws DuplicateIdempotencyKeyError si la clave ya existe.
   */
  save(record: IdempotencyRecord): Promise<void>;
}
