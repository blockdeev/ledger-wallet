/**
 * Puerto de métricas de negocio (Fase 5).
 *
 * Expone métodos SEMÁNTICOS: hablan de conceptos de dominio, no de contadores
 * ni histogramas. La capa de aplicación depende SOLO de este puerto; nunca
 * importa prom-client ni ninguna otra librería de telemetría concreta.
 *
 * El adapter concreto (PrometheusMetrics) vive en src/adapters/observability/
 * y es el único que conoce los detalles de exposición.
 *
 * Ver ADR 0013 para la justificación del diseño.
 */

/** Resultado posible de un intento de transferencia. */
export type TransferOutcome =
  | "created"    // Alta nueva exitosa
  | "replayed"   // Replay de una transferencia ya ejecutada (idempotencia)
  | "conflict"   // IdempotencyConflictError: misma clave, payload distinto
  | "overdraft"  // OverdraftError: saldo insuficiente en cuenta origen
  | "not_found"  // AccountNotFoundError: cuenta origen o destino inexistente
  | "error";     // Error inesperado (bug, caída de DB, CurrencyMismatchError, etc.)

export interface MetricsRecorder {
  /** Registra el resultado de un intento de transferencia (counter con label). */
  recordTransfer(outcome: TransferOutcome): void;

  /** Registra la creación exitosa de una cuenta (counter). */
  recordAccountCreated(): void;

  /**
   * Observa la duración de una ejecución de Transfer.execute() en segundos.
   * Se registra SIEMPRE (éxito o error) desde un bloque finally.
   */
  observeTransferDuration(seconds: number): void;
}
