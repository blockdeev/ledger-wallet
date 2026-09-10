/**
 * Adapter OpenTelemetry para el puerto Tracer (Fase 6).
 *
 * Implementa la interfaz `Tracer` del puerto de aplicación usando el API de
 * `@opentelemetry/api`. Esta es la ÚNICA clase del proyecto que importa OTel.
 *
 * - Crea spans con `trace.getTracer(...).startActiveSpan(...)`.
 * - Setea los atributos del span al inicio.
 * - Si `fn` lanza, registra la excepción y marca el status ERROR.
 * - Cierra el span en todos los casos (éxito o error) vía bloque finally.
 * - OTel propaga el contexto automáticamente por AsyncLocalStorage: los spans
 *   creados dentro de un span activo se anidan solos, sin reimplementar propagación.
 *
 * Ver ADR 0014 para el razonamiento de diseño.
 */

import { createRequire } from "module";
import type { Tracer } from "../../application/ports/tracer.js";

// Los paquetes OTel son CJS; se importan vía createRequire para compatibilidad con ESM strict.
const require = createRequire(import.meta.url);

const otelApi = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
const { trace, SpanStatusCode } = otelApi;

export class OtelTracer implements Tracer {
  private readonly tracer: import("@opentelemetry/api").Tracer;

  constructor(serviceName = "ledger-wallet") {
    this.tracer = trace.getTracer(serviceName);
  }

  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      // Setear atributos al inicio del span
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }

      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        // Registrar la excepción y marcar el span con status ERROR
        if (err instanceof Error) {
          span.recordException(err);
        }
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
