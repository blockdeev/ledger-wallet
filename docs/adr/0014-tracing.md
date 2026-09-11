# ADR 0014 — Observabilidad: tracing distribuido vía puerto `Tracer` + OpenTelemetry

**Estado**: Aceptado
**Fecha**: 2025-06 (Fase 6)
**Relación**: extiende ADR 0012 (logging) y ADR 0013 (métricas); mismo patrón puerto-adapter

---

## Contexto

Tras el logging estructurado (ADR 0012) y las métricas de negocio (ADR 0013), la última
capa de observabilidad requerida es el **tracing distribuido**: spans que representan la
duración y el contexto de cada operación, correlacionables entre sí y con los logs.

El objetivo de la Fase 6 es instrumentar los tres casos de uso con spans OpenTelemetry
sin contaminar las capas de dominio ni de aplicación con la biblioteca concreta, y añadir
un span raíz por request HTTP para que todos los spans de un ciclo queden como hijos.

---

## Decisión

### 1. Puerto semántico `Tracer` en `src/application/ports/`

Se define una interfaz mínima con un único método:

```typescript
interface Tracer {
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<T>
  ): Promise<T>;
}
```

El diseño intencionalmente esconde la API de OTel (sin `Span`, sin `SpanContext`, sin
`startActiveSpan`): el código de aplicación solo declara _qué_ quiere instrumentar, no
_cómo_. La semántica de inicio/fin, propagación de contexto y registro de errores es
responsabilidad del adapter.

Las capas `domain/` y `application/` dependen **solo** de este puerto. La regla de ESLint
`no-restricted-imports` bloquea `@opentelemetry/*` en `src/application/**` y
`src/domain/**` para garantizarlo.

### 2. Adapter `OtelTracer` en `src/adapters/observability/`

`OtelTracer implements Tracer` usando `@opentelemetry/api`:

- Obtiene un `Tracer` OTel con `trace.getTracer("ledger-wallet")`.
- Implementa `withSpan` con `tracer.startActiveSpan(name, async (span) => { ... })`.
- Setea todos los atributos al inicio del span.
- En el bloque `catch`: `span.recordException(err)` + `span.setStatus(ERROR)`.
- En el bloque `finally`: `span.end()` — garantiza cierre en todos los casos.

Los paquetes OTel son CommonJS; se importan vía `createRequire(import.meta.url)` para
compatibilidad con el proyecto ESM strict (no se usa `esModuleInterop`).

### 3. Bootstrap del SDK — `otel-sdk.ts`

Exporta `startTracing(endpoint?)` y `stopTracing()`:

- `startTracing`: si `endpoint` está definido, inicializa `NodeSDK` con `OTLPTraceExporter`
  hacia ese URL y un `Resource` con `service.name = "ledger-wallet"`.
- Si `endpoint` es `undefined`, no hace nada: el API OTel actúa globalmente como noop.
- `stopTracing`: cierra el SDK gracefully (flush de spans pendientes). Noop si no inició.

El arranque (`startTracing`) ocurre en `main.ts` **antes** de `compose()`, para que el
SDK esté registrado antes del primer span.

### 4. Span raíz por request HTTP (`buildApp`)

El hook `onRequest` de Fastify crea un span raíz con nombre `"METHOD /url"` usando el
API OTel directamente (el adapter HTTP es infraestructura y puede importar OTel).

- Atributo `http.request_id`: el `requestId` de Fastify, para correlacionar trazas con logs.
- Se cierra en el evento `reply.raw.finish` con el status HTTP correspondiente.
- La propagación de contexto OTel (AsyncLocalStorage interno) asegura que los spans de los
  casos de uso abiertos durante el request queden como **hijos automáticos** del span raíz.
- El contexto OTel convive con nuestro propio ALS de correlación de logs (`request-context.ts`):
  `context.with(context.active(), ...)` preserva el contexto OTel, y dentro de él se llama
  `runWithRequestId(...)` para preservar el requestId en el ALS de logs.

### 5. Instrumentación de los tres casos de uso

Cada caso de uso recibe `tracer: Tracer` por constructor (mismo patrón que `Logger` y
`MetricsRecorder`) y envuelve el cuerpo de `execute()` en `this.tracer.withSpan(...)`:

| Caso de uso | Nombre del span | Atributos |
|---|---|---|
| `Transfer` | `"transfer.execute"` | `fromAccountId`, `toAccountId`, `amountMinor`, `currency`, `hasIdempotencyKey` |
| `CreateAccount` | `"account.create"` | `accountId`, `currency`, `type` |
| `GetBalance` | `"balance.get"` | `accountId` |

Las firmas de `execute()` no cambian. Solo cambian los constructores.

`GetBalance` recibe `tracer` como quinto parámetro **opcional** (con noop interno como
default) para no romper los callers que ya pasaban los cuatro parámetros anteriores y no
necesitan tracing. Los tests de integración (3b/3c) actualizados usan `NoopTracer`.

### 6. Tracing inerte sin `OTEL_EXPORTER_OTLP_ENDPOINT`

Si la variable de entorno no está seteada:

- `startTracing(undefined)` es noop: el SDK OTel nunca se inicializa.
- El API OTel (`trace.getTracer(...).startActiveSpan(...)`) actúa como **noop global**:
  los spans se crean y se cierran sin exportar nada, sin overhead perceptible.
- La app bootea y funciona exactamente igual. Los tests corren sin ningún collector OTel.
- En producción: setear `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318/v1/traces`.

### 7. Dependencias nuevas

Solo las cinco paquetes autorizados en el brief (ver B1):

| Paquete | Propósito |
|---|---|
| `@opentelemetry/api` | API estándar para crear/instrumentar spans (sin SDK) |
| `@opentelemetry/sdk-node` | SDK Node: registra el TracerProvider, maneja el ciclo de vida |
| `@opentelemetry/exporter-trace-otlp-http` | Exporter OTLP HTTP hacia el collector |
| `@opentelemetry/resources` | `resourceFromAttributes()` para definir `service.name` |
| `@opentelemetry/semantic-conventions` | `ATTR_SERVICE_NAME` tipado desde la spec semántica |

### 8. Doble de test `CapturingTracer` / `NoopTracer`

Ambos en `test/support/capturing-tracer.ts`:

- `NoopTracer`: ejecuta `fn()` directamente, sin acumular nada. Para tests donde no importa
  el tracing.
- `CapturingTracer`: ejecuta `fn()` y acumula `{ name, attributes, error }[]`. Permite
  afirmar que se abrió el span correcto con los atributos esperados, sin el SDK OTel real.

---

## Relación con ADR 0012 (logging) y ADR 0013 (métricas)

El patrón es idéntico en las tres capas de observabilidad:

| Capa | Puerto | Adapter | Doble de test |
|---|---|---|---|
| Logging | `Logger` | `PinoLogger` | `CapturingLogger` |
| Métricas | `MetricsRecorder` | `PrometheusMetrics` | `CapturingMetrics` |
| Tracing | `Tracer` | `OtelTracer` | `CapturingTracer` / `NoopTracer` |

**Correlación trazas ↔ logs**: cada span raíz lleva `http.request_id = requestId`. Todos los
logs emitidos durante ese request llevan el mismo `requestId` (via ALS de `request-context.ts`).
En un sistema de observabilidad (Grafana, Jaeger) es posible pasar de una traza a todos sus
logs filtrando por ese ID.

**Tracing vs logging**: el logging da contexto detallado por evento (qué pasó y por qué), el
tracing da latencia y relación causal entre operaciones (cuánto tardó cada parte y qué llamó a qué).
Son complementarios; un span de error puede llevar a los logs detallados vía `requestId`.

---

## Fuera de alcance (Fase 6)

- Auto-instrumentación de librerías (`@opentelemetry/instrumentation-*` para Kysely, pg, Fastify).
- Métricas OTel (se mantiene Prometheus).
- Logs OTel.
- Context propagation entre servicios externos (B3/W3C headers): no hay microservicios todavía.

---

## Consecuencias

**Positivo**:
- Fronteras hexagonales intactas: `domain/` y `application/` sin referencias a OTel.
- Testabilidad: `CapturingTracer` permite afirmar spans sin SDK ni collector.
- Tracing inerte sin configuración: la app no requiere un collector para funcionar.
- Correlación trazas ↔ logs por `requestId`.

**Negativo / tradeoffs**:
- Los paquetes OTel son CJS en un proyecto ESM; se usa `createRequire()` como puente.
  Esto funciona bien en Node 22 pero puede complicar futuros bundlers.
- El span raíz no propaga contexto W3C Trace Context desde headers entrantes (fuera de alcance).
  En un entorno con API Gateway o frontend instrumentado, habría que añadir `propagator`.
- `GetBalance` tiene `tracer` como quinto param opcional (con noop default) en lugar del cuarto
  obligatorio, para preservar compatibilidad con los tests de integración 3b/3c que no pasan
  un tracer. Es un compromiso pragmático; en una refactorización mayor se unificaría la firma.
