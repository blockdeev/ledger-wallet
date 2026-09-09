# ADR 0011 — Idempotencia de transferencias: reserve-first + constraint única

**Estado:** Aceptado  
**Fecha:** 2025-07-09  
**Relacionados:** [ADR 0010](0010-concurrencia-y-atomicidad.md) (concurrencia), [ADR 0008](0008-capa-de-aplicacion.md) (capa de aplicación), [ADR 0009](0009-persistencia.md) (persistencia)

---

## Contexto

`POST /transfers` puede recibir reintentos (cliente con timeout, red inestable,
etc.). Sin idempotencia, cada reintento mueve dinero de nuevo: doble-gasto.

El requisito es: dado un header `Idempotency-Key`, un segundo request con la
misma clave debe devolver la respuesta original **sin mover dinero**, y dos
requests concurrentes con la misma clave deben producir exactamente **una**
escritura (sin doble-gasto), con la perdedora haciendo replay en lugar de
rechazar.

---

## Decisión

### 1. Header `Idempotency-Key` opcional en `POST /transfers`

- **Ausente** → comportamiento idéntico a Fase 3b (sin registro de idempotencia,
  los tests existentes siguen siendo válidos sin cambios).
- **Presente vacío / solo whitespace** → `400 bad_request`.
- **Presente y válido** → semántica de idempotencia descrita abajo.

### 2. Puerto `IdempotencyRepository` en la capa de aplicación

```ts
interface IdempotencyRecord { key: string; transactionId: string; fingerprint: string; }
interface IdempotencyRepository {
  findByKey(key: string): Promise<IdempotencyRecord | undefined>;
  save(record: IdempotencyRecord): Promise<void>; // lanza DuplicateIdempotencyKeyError si ya existe
}
```

El puerto vive en `application/ports/` para que el use case lo use sin acoplarse
a Kysely ni a pg. La traducción del error de DB (SQLSTATE 23505 →
`DuplicateIdempotencyKeyError`) vive en el **adapter Postgres**, no en la capa
de aplicación.

### 3. Tabla `idempotency_keys` sin foreign key

```sql
CREATE TABLE idempotency_keys (
  key            TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,    -- SIN REFERENCES ledger_transactions.id
  fingerprint    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Por qué sin FK:** con la estrategia reserve-first (ver punto 5), la fila de
idempotencia se inserta **antes** de que exista la transacción del ledger.
Una FK referencial rechazaría ese INSERT porque la fila aún no existe en
`ledger_transactions`. Todo ocurre dentro de la misma transacción de DB
(todo-o-nada), por lo que Postgres no vería la fila referenciada al validar la FK.

La integridad la garantiza la aplicación: `transaction_id` se escribe desde
`input.id`, el mismo id con que se crea la `LedgerTransaction`, dentro de la
misma transacción de DB. Si la transferencia falla, el rollback deshace también
la reserva → la clave no queda "quemada".

Este es el patrón estándar para tablas de idempotencia (side-log operativo,
no parte del libro contable).

### 4. Fingerprint determinístico

```ts
`${id}|${fromAccountId}|${toAccountId}|${amount.minor}|${amount.currency}`
```

Función pura, testeable por separado. Permite detectar que una misma clave
se usa con un payload distinto y lanzar `IdempotencyConflictError` (409).

### 5. Estrategia RESERVE-FIRST (corazón del diseño)

El orden de operaciones dentro de la transacción de DB es obligatorio:

```
1. ctx.idempotency.save({ key, transactionId, fingerprint })  // ← PRIMERO
2. executeTransfer(ctx, input)                                  // ← DESPUÉS
```

**Por qué este orden es crítico:**

Si la clave se reservara *después* de la transferencia (o si no hubiera reserva),
dos requests concurrentes con la misma clave podrían ambas adquirir el lock de
cuentas, derivar saldos, y ambas ejecutar la transferencia antes de que alguna
escriba el registro de idempotencia → doble-gasto.

Reservando la clave *primero*, la constraint `UNIQUE` de `idempotency_keys`
serializa la carrera **antes** del lock de cuentas:

- **Ganadora:** `INSERT` ok → adquiere lock de cuentas → ejecuta transfer →
  `{ replayed: false }`.
- **Perdedora:** su `INSERT` queda bloqueado (Postgres lock de fila) hasta que
  la ganadora commitea. Luego recibe `DuplicateIdempotencyKeyError`. Su
  transacción de DB hace **ROLLBACK** (no persiste nada → cero doble-gasto).
  El use case captura `DuplicateIdempotencyKeyError` y **reintenta una vez**
  en una nueva transacción: `findByKey` ahora encuentra el registro → valida
  fingerprint → `findById` → `{ replayed: true }`.

Si la transferencia falla **después** de la reserva (p. ej. `OverdraftError`
real), el rollback de la transacción de DB deshace también la reserva → la
clave no queda quemada → un reintento legítimo puede volver a intentar la
operación.

### 6. Emulación de rollback en InMemoryUnitOfWork

Postgres hace rollback nativo cuando lanza una excepción dentro de una
transacción. El adapter in-memory no tenía rollback: `transaction(work)`
simplemente ejecutaba `work`.

Con reserve-first, el rollback es **load-bearing** para los tests unitarios:
si el transfer falla después de reservar la clave, la reserva debe deshacerse.

Solución: antes de ejecutar `work`, se toma un **snapshot** de los tres repos
(accounts, transactions, idempotency); si `work` lanza, se restaura el snapshot
y se re-lanza el error. Cada repo in-memory expone `snapshot()` y `restore()`.

### 7. Errores nuevos (capa de aplicación)

| Error | Semántica | HTTP |
|---|---|---|
| `DuplicateIdempotencyKeyError` | señal interna adapter → use case; la constraint UNIQUE disparó | no llega al HTTP en operación normal |
| `IdempotencyConflictError` | misma clave, fingerprint distinto | 409 `idempotency_conflict` |

### 8. HTTP: 200 vs 201 según `replayed`

- `replayed === false` → **201** Created (alta nueva)
- `replayed === true`  → **200** OK (replay, misma representación)

Esta distinción es observable en los tests HTTP y en el cliente, y es la forma
estándar de señalizar idempotencia en APIs REST. No se usa 202 ni se omite el
body.

---

## Alternativas consideradas

### A. Reserve-after (insertar la clave después de la transferencia)

Rechazada: dos requests concurrentes pueden ambas ejecutar la transferencia
antes de que alguna llegue al `save` → doble-gasto. Exactamente el bug
verificado en el orquestador con la v1 de este brief.

### B. Lockear por clave antes de iniciar la transacción (advisory lock)

Rechazada: añade complejidad (advisory locks de Postgres, timeout management)
y rompe la arquitectura hexagonal (el puerto no puede depender de primitivas
específicas de Postgres). Reserve-first usa solo un `INSERT` y la constraint
`UNIQUE`, que son portátiles.

### C. FK de `transaction_id` a `ledger_transactions.id`

Rechazada: incompatible con reserve-first (ver punto 3). La integridad la
garantiza la aplicación dentro de la misma transacción de DB.

### D. Guardar el body de respuesta completo en `idempotency_keys`

Descartada por el brief: se guarda solo `transactionId` y se reconstruye el
body leyendo la transacción con `findById`. Evita serializar/deserializar
JSON de forma ad hoc y mantiene el modelo de datos limpio.

---

## Consecuencias

- **Positivo:** cero doble-gasto bajo concurrencia verificado con Postgres real.
- **Positivo:** la perdedora hace replay (no rechaza), mejorando la experiencia
  del cliente.
- **Positivo:** `OverdraftError` real no quema la clave (rollback limpio).
- **Negativo:** la lógica del use case gana complejidad (retry, isRetry flag).
- **Deuda técnica conocida:** sin TTL/expiración de claves (fuera de alcance en
  esta fase); idempotencia solo en `POST /transfers` (no en `POST /accounts`).
