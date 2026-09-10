import type { Tracer } from "../../src/application/ports/tracer.js";

/** Span capturado por CapturingTracer. */
export interface CapturedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  /** true si la función lanzó una excepción */
  error: boolean;
}

/**
 * Doble de test para el puerto Tracer.
 *
 * Ejecuta `fn` directamente (para que la lógica del caso de uso corra) y acumula
 * los spans creados (`{ name, attributes, error }`) para que los tests puedan
 * afirmar que se abrió el span correcto con los atributos correctos.
 *
 * No depende del SDK OTel — es TypeScript puro y funciona sin ningún collector.
 *
 * Uso típico:
 *   const tracer = new CapturingTracer();
 *   const useCase = new Transfer(uow, logger, metrics, tracer);
 *   await useCase.execute(input);
 *   expect(tracer.spans[0]).toMatchObject({ name: "transfer.execute", attributes: { ... } });
 */
export class CapturingTracer implements Tracer {
  readonly spans: CapturedSpan[] = [];

  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>
  ): Promise<T> {
    let error = false;
    try {
      const result = await fn();
      return result;
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.spans.push({ name, attributes, error });
    }
  }

  // ── Helpers de conveniencia ───────────────────────────────────────────────

  /** Filtra spans por nombre. */
  byName(name: string): CapturedSpan[] {
    return this.spans.filter((s) => s.name === name);
  }

  /** Devuelve el primer span con el nombre dado, o undefined si no existe. */
  firstByName(name: string): CapturedSpan | undefined {
    return this.spans.find((s) => s.name === name);
  }
}

/**
 * Doble de test mínimo para el puerto Tracer: ejecuta `fn` directamente
 * sin capturar nada. Útil cuando el test no necesita afirmar sobre spans.
 */
export class NoopTracer implements Tracer {
  async withSpan<T>(
    _name: string,
    _attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>
  ): Promise<T> {
    return fn();
  }
}
