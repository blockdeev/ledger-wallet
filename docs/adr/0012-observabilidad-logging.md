# ADR 0012 — Observabilidad: logging estructurado por puerto + AsyncLocalStorage

**Estado:** Aceptado  
**Fecha:** 2026-09-09  
**Relacionados:** [ADR 0005](0005-arquitectura.md) (arquitectura hexagonal), [ADR 0011](0011-idempotencia.md) (idempotencia)

---

## Contexto

El motor contable necesita logging de eventos de negocio (creación de cuentas,
transferencias, replays, rechazos) para operación, debugging y auditoría.

Requisitos:
- Los eventos deben ser **estructurados** (JSON, campos estables) para facilitar
  búsquedas y alertas en sistemas como Datadog o CloudWatch.
- Los logs de un mismo request HTTP deben poder correlacionarse entre sí usando
  un `requestId` común.
- Las capas de dominio y aplicación deben permanecer **puras**: sin dependencias
  de pino, Fastify ni `node:async_hooks`.

---

## Decisión

### 1. Puerto `Logger` en la capa de aplicación

Se define `src/application/ports/logger.ts` con la interfaz mínima:

```ts
interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}
```

- `event` es un nombre estable con puntos (`"transfer.created"`), nunca una
  interpolación de string.
- `fields` es contexto estructurado; la capa de aplicación nunca interpola ni
  formatea strings para el logger.
- La frontera de lint (`no-restricted-imports`) ya prohíbe que `application/`
  y `domain/` importen pino, Fastify o `node:async_hooks`; el puerto `Logger`
  es la única dependencia de logging permitida en esas capas.

**Por qué `Logger` en `application/` y no en `domain/`:**  
El dominio es puro y no tiene efectos secundarios observables; el logging es
una preocupación de la capa de aplicación que coordina el flujo. Ubicar el
puerto en `application/ports/` mantiene el dominio libre de cualquier noción
de observabilidad.

### 2. Adapter pino + correlación por request con `AsyncLocalStorage`

#### `src/adapters/observability/request-context.ts`

Wraps un `AsyncLocalStorage<{ requestId: string }>` (de `node:async_hooks`)
con dos helpers:

- `runWithRequestId(id, fn)`: ejecuta `fn` dentro de un contexto que lleva el
  `requestId` dado. Todos los callbacks y promesas creados dentro de `fn`
  heredan el mismo contexto gracias a la propagación de ALS en Node.js.
- `getRequestId()`: devuelve el `requestId` del contexto activo, o `undefined`
  si no hay contexto (arranque de la app, workers, etc.).

#### `src/adapters/observability/pino-logger.ts`

`PinoLogger implements Logger`. Recibe una instancia pino por constructor.
En cada `info/warn/error`, arma el payload como:

```ts
{ event, ...(requestId !== undefined ? { requestId } : {}), ...fields }
```

y lo emite al nivel pino correspondiente. El `requestId` se obtiene de
`getRequestId()` (ALS), no de ningún parámetro de método.

#### Hook `onRequest` en `buildApp`

Se agrega un hook Fastify `onRequest` que inicia el contexto ALS para cada
request:

```ts
app.addHook("onRequest", (request, _reply, done) => {
  void runWithRequestId(request.id, () => {
    done();
    return Promise.resolve();
  });
});
```

**Por qué este patrón y no otro:**  
Fastify no ofrece una API de "middleware de envoltura" (como `app.use` de
Express) que permita envolver todo el ciclo de vida de un request en una
función. `onRequest` es el hook más temprano disponible. Al llamar `done()`
dentro del `storage.run()` de ALS, los handlers subsiguientes de Fastify
(route handlers, otros hooks) se encolan desde dentro del contexto ALS activo
y por lo tanto lo heredan. Esta es la forma idiomática de propagar ALS en
Fastify, y está documentada en la comunidad de Node.js / Fastify.

**`request.id`:** Fastify genera automáticamente un `reqId` único por request
(`req-1`, `req-2`, …). Se usa directamente como `requestId` para no duplicar
identificadores.

### 3. Inyección por constructor; firma de `execute()` sin cambios

Los casos de uso (`CreateAccount`, `Transfer`, `GetBalance`) reciben `logger:
Logger` por constructor (app-scoped). La firma de sus métodos `execute()` no
cambia. Esto es deliberado:

- **Evita romper llamadores:** los tests de integración de fases anteriores
  (Postgres, HTTP) instancian los casos de uso sin pasar logger; cambiar
  `execute()` habría requerido tocar todos esos tests.
- **Correlación transparente:** el `requestId` llega a los logs vía ALS, no
  como parámetro explícito. Los casos de uso no necesitan saber que existe un
  request HTTP.

Para tests: se inyecta `CapturingLogger` (doble de test), que acumula eventos
en memoria para que los tests puedan afirmar sobre ellos sin stdout.

### 4. Eventos de negocio instrumentados

| Evento | Nivel | Cuándo | Campos |
|---|---|---|---|
| `account.created` | info | CreateAccount OK | `accountId`, `currency`, `type` |
| `account.already_exists` | warn | AccountAlreadyExistsError | `accountId` |
| `transfer.created` | info | transfer nuevo (replayed=false) | `transactionId`, `fromAccountId`, `toAccountId`, `amountMinor` (string), `currency`, `idempotencyKey?` |
| `transfer.replayed` | info | replay (replayed=true) | `transactionId`, `idempotencyKey` |
| `transfer.conflict` | warn | IdempotencyConflictError | `idempotencyKey` |
| `transfer.overdraft_rejected` | warn | OverdraftError | `fromAccountId`, `amountMinor`, `currency` |
| `transfer.account_not_found` | warn | AccountNotFoundError en transfer | `accountId` |

`GetBalance` no emite eventos (las lecturas generan ruido; diferido a fase
posterior si se necesita).

### 5. Datos sensibles

En este ledger, `accountId`, montos en minor units (string) e `idempotencyKey`
son OK de loguear: son tokens internos del sistema sin PII (nombres, tarjetas,
secretos). No se loguea el body completo del request ni campos sensibles.

### 6. `LOG_LEVEL` configurable

Se agrega `logLevel` a `AppConfig`, leído de `process.env.LOG_LEVEL` (default
`"info"`). Se valida contra los niveles pino válidos en `loadConfig()` con
fail-fast. El composition root crea la instancia pino con ese nivel y la pasa
tanto a `buildApp` (como `loggerInstance`) como al `PinoLogger`.

---

## Alternativas consideradas

**¿Por qué ALS y no pasar `requestId` como parámetro en `execute()`?**  
Pasar el `requestId` por parámetro habría requerido cambiar las firmas de
`execute()` en los tres casos de uso, rompiendo los tests de integración de
fases anteriores y añadiendo un concepto HTTP (requestId) a la capa de
aplicación. ALS es la solución idiomática en Node.js para propagar contexto
cross-cutting (logging, tracing) sin contaminar las firmas de las funciones.

**¿Por qué no un logger global/singleton?**  
Un singleton dificultaría la inyección de dobles de test y violaría el
principio de inversión de dependencias. La inyección por constructor preserva
la testeabilidad y la claridad del grafo de dependencias.

**¿Por qué pino y no winston/bunyan?**  
Pino ya viene incluido con Fastify (sin dependencia de runtime adicional). Es
el logger de mayor rendimiento en el ecosistema Node.js y produce JSON limpio
por defecto.

---

## Consecuencias

- **Positivas:** logging estructurado con correlación automática por request;
  fronteras hexagonales intactas; testeabilidad con `CapturingLogger`; nivel
  configurable sin cambios de código.
- **Neutrales:** ALS añade overhead mínimo (nanosegundos por request) medido
  en benchmarks de Node.js; irrelevante a esta escala.
- **Diferidas:** métricas / endpoint `/metrics` (Fase 5); tracing distribuido
  / OpenTelemetry (Fase 6); TTL de `idempotency_keys`; instrumentación de
  `GetBalance`.
