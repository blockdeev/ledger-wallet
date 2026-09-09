import {
  IdempotencyRecord,
  IdempotencyRepository,
} from "../../../../application/ports/idempotency-repository.js";
import { DuplicateIdempotencyKeyError } from "../../../../application/errors.js";

/**
 * Implementación in-memory del puerto IdempotencyRepository.
 *
 * Usa un Map<string, IdempotencyRecord> como backing store.
 * `save` lanza DuplicateIdempotencyKeyError si la clave ya existe,
 * emulando la violación de unicidad que Postgres maneja con SQLSTATE 23505.
 *
 * Expone `snapshot()` y `restore()` para que InMemoryUnitOfWork pueda
 * implementar rollback (reserve-first requiere que una reserva fallida
 * se deshaga si la transferencia posterior falla).
 */
export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private store = new Map<string, IdempotencyRecord>();

  async findByKey(key: string): Promise<IdempotencyRecord | undefined> {
    await Promise.resolve();
    return this.store.get(key);
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await Promise.resolve();
    if (this.store.has(record.key)) {
      throw new DuplicateIdempotencyKeyError(record.key);
    }
    this.store.set(record.key, record);
  }

  /** Devuelve una copia superficial del store para snapshot/restore. */
  snapshot(): Map<string, IdempotencyRecord> {
    return new Map(this.store);
  }

  /** Reemplaza el store con el snapshot dado (restaura el estado previo). */
  restore(snap: Map<string, IdempotencyRecord>): void {
    this.store = new Map(snap);
  }
}
