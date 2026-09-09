import type { Logger } from "../../src/application/ports/logger.js";

/** Entrada capturada por CapturingLogger. */
export interface CapturedEntry {
  level: "info" | "warn" | "error";
  event: string;
  fields: Record<string, unknown>;
}

/**
 * Doble de test para el puerto Logger.
 *
 * Acumula todas las llamadas a info/warn/error en un array `entries` para
 * que los tests puedan afirmar sobre los eventos de negocio emitidos sin
 * depender de pino ni de salida a stdout.
 *
 * Uso típico:
 *   const logger = new CapturingLogger();
 *   const useCase = new CreateAccount(repo, logger);
 *   await useCase.execute(input);
 *   expect(logger.entries).toContainEqual({ level: "info", event: "account.created", ... });
 */
export class CapturingLogger implements Logger {
  readonly entries: CapturedEntry[] = [];

  info(event: string, fields?: Record<string, unknown>): void {
    this.entries.push({ level: "info", event, fields: fields ?? {} });
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", event, fields: fields ?? {} });
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.entries.push({ level: "error", event, fields: fields ?? {} });
  }

  /** Devuelve todas las entradas con el event dado. */
  findByEvent(event: string): CapturedEntry[] {
    return this.entries.filter((e) => e.event === event);
  }

  /** Devuelve la primera entrada con el event dado, o undefined si no existe. */
  firstByEvent(event: string): CapturedEntry | undefined {
    return this.entries.find((e) => e.event === event);
  }
}
