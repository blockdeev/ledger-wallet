/**
 * Adapter de logging: PinoLogger implements el puerto Logger de la aplicación.
 *
 * Responsabilidades:
 *  - Recibir una instancia pino por constructor (no la crea internamente).
 *  - En cada llamada info/warn/error, armar el objeto de log con { event,
 *    requestId?, ...fields } y emitirlo al nivel correspondiente.
 *  - Obtener el requestId desde AsyncLocalStorage (getRequestId()) para que
 *    todo log emitido durante un request HTTP lleve la correlación automática.
 *    Si no hay contexto de request (p. ej. arranque de la app), lo omite.
 *
 * La capa de aplicación NUNCA importa este archivo; solo lo hace el
 * composition root.
 */

import type { Logger as PinoInstance } from "pino";
import type { Logger } from "../../application/ports/logger.js";
import { getRequestId } from "./request-context.js";

export class PinoLogger implements Logger {
  constructor(private readonly pino: PinoInstance) {}

  info(event: string, fields?: Record<string, unknown>): void {
    this.pino.info(this.buildPayload(event, fields));
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.pino.warn(this.buildPayload(event, fields));
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.pino.error(this.buildPayload(event, fields));
  }

  private buildPayload(
    event: string,
    fields?: Record<string, unknown>
  ): Record<string, unknown> {
    const requestId = getRequestId();
    return {
      event,
      ...(requestId !== undefined ? { requestId } : {}),
      ...fields,
    };
  }
}
