/**
 * Puerto de tracing distribuido (Fase 6).
 *
 * Interfaz SEMÁNTICA y mínima: las capas de dominio y aplicación dependen SOLO de
 * este puerto; NUNCA importan `@opentelemetry/*` ni ninguna otra librería de tracing
 * concreta.
 *
 * El adapter concreto (OtelTracer) vive en src/adapters/observability/ y es el único
 * que conoce el stack OpenTelemetry.
 *
 * Mismo patrón puerto-adapter que Logger (ADR 0012) y MetricsRecorder (ADR 0013).
 * Ver ADR 0014 para la justificación del diseño.
 */

export interface Tracer {
  /**
   * Ejecuta `fn` dentro de un span con el nombre y atributos dados.
   *
   * - El span se cierra al resolver/rechazar la promesa.
   * - Si `fn` lanza, el span se marca con status ERROR y se re-lanza el error.
   * - Los atributos deben ser primitivos serializables (string, number, boolean).
   *
   * Los spans creados DENTRO de un span activo (llamadas anidadas) se anidan
   * automáticamente: OTel maneja la propagación de contexto vía AsyncLocalStorage.
   */
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>
  ): Promise<T>;
}
