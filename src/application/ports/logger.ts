/**
 * Puerto de logging estructurado.
 *
 * Depende SOLO de este módulo: dominio y aplicación nunca importan pino,
 * Fastify ni node:async_hooks. El adapter concreto (PinoLogger) vive en
 * src/adapters/observability/.
 *
 * Convención de uso:
 *   - `event` es un nombre estable con puntos (p. ej. "transfer.created").
 *   - `fields` es contexto estructurado; NUNCA interpolaciones de strings.
 *   - El requestId de correlación se inyecta automáticamente en el adapter
 *     vía AsyncLocalStorage (infraestructura), sin cambiar esta interfaz.
 */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}
