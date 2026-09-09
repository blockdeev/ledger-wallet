/**
 * Contexto de request propagado vía AsyncLocalStorage.
 *
 * Permite que los casos de uso emitan logs con el requestId del request HTTP
 * que los invocó, sin que la capa de aplicación sepa nada de Fastify ni de
 * async_hooks. Solo los adapters y el composition root importan este módulo.
 *
 * Uso típico:
 *   - En el hook onRequest de Fastify: runWithRequestId(request.id, async () => { … })
 *   - En PinoLogger: getRequestId() para enriquecer cada línea de log.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Ejecuta `fn` dentro de un contexto que lleva el requestId dado.
 * Todo código async que corra dentro de `fn` (incluidas llamadas downstream
 * a casos de uso) verá el mismo requestId al llamar a getRequestId().
 */
export function runWithRequestId<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ requestId }, fn);
}

/**
 * Devuelve el requestId del contexto activo, o undefined si no hay contexto
 * (p. ej. logs emitidos fuera de un ciclo de request HTTP).
 */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
