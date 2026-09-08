# ADR 0010 — Concurrencia y atomicidad: Unit of Work, locking `FOR UPDATE` y saldo derivado

## Status

Accepted (Fase 3b)

---

## Context

La Fase 3b expone los casos de uso por HTTP y hace que `Transfer` sea **atómico y seguro
bajo concurrencia**. El problema central: dos transferencias concurrentes que salen de la
misma cuenta pueden leer el saldo simultáneamente, ver fondos suficientes ambas, y ejecutar
ambas escrituras — produciendo un doble-gasto. Esto es el clásico *TOCTOU* (time-of-check
to time-of-use) en bases de datos concurrentes.

Esta decisión también cierra el trade-off abierto en ADR 0008 sobre la estrategia de saldo
(derivado vs materializado) y en ADR 0009 sobre atomicidad de la capa de persistencia.

---

## Decisions

### 1. Puerto `UnitOfWork` en la capa de aplicación

Se introduce un nuevo puerto de salida en `src/application/ports/unit-of-work.ts`:

```typescript
interface TransactionalContext {
  accounts: AccountRepository;
  transactions: TransactionRepository;
  lockAccounts(accountIds: string[]): Promise<void>;
}

interface UnitOfWork {
  transaction<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T>;
}
```

**Por qué un puerto y no acoplamiento directo a Kysely:**
La capa de aplicación no puede importar adaptadores de infraestructura (frontera hexagonal,
ver ADR 0005). El UoW como puerto permite que `Transfer` exprese su necesidad de atomicidad
en términos de dominio/aplicación, sin conocer Postgres, Kysely ni ningún detalle de
transaccionalidad de DB. El adapter concreto (Postgres o in-memory) inyecta la implementación
correcta en el composition root.

**Dos implementaciones:**
- `PostgresUnitOfWork`: abre `db.transaction().execute(trx => …)` en Kysely; cualquier
  excepción lanzada dentro del callback produce rollback automático.
- `InMemoryUnitOfWork`: simplemente ejecuta `work` con los repos in-memory; no hay
  transacciones reales que gestionar (JS es single-threaded).

### 2. Locking pesimista con `SELECT ... FOR UPDATE ORDER BY id`

Dentro de `PostgresUnitOfWork.transaction`, `lockAccounts(ids)` ejecuta:

```sql
SELECT id FROM accounts WHERE id IN (...) ORDER BY id FOR UPDATE
```

**Por qué `FOR UPDATE`:**
Adquiere un lock de fila exclusivo sobre cada fila de `accounts`. Cualquier otra transacción
que intente bloquear las mismas filas (`FOR UPDATE` o `FOR SHARE`) quedará suspendida hasta
que la transacción actual haga commit o rollback. Esto serializa efectivamente las
transferencias concurrentes sobre las mismas cuentas: la segunda transacción no puede derivar
el saldo hasta que la primera haya persistido (o abortado).

**Por qué `ORDER BY id` (crítico para evitar deadlocks):**
Considera dos transferencias concurrentes en sentidos opuestos:
- T1: A → B (bloquea A primero, luego B)
- T2: B → A (bloquea B primero, luego A)

Sin orden canónico, T1 puede bloquear A mientras T2 bloquea B; cada una espera a la otra
→ deadlock. Con `ORDER BY id`, ambas transacciones intentan bloquear `min(A,B)` primero
y `max(A,B)` después. El orden es el mismo para T1 y T2, por lo que una obtiene los dos
locks y avanza, mientras la otra espera — sin deadlock posible.

**Implementación en el adapter in-memory:**
`lockAccounts` es un no-op. JS es single-threaded: aunque se llame a `Promise.allSettled`
con dos transferencias concurrentes, la ejecución es en realidad secuencial (event loop).
No existe carrera real; el chequeo de sobregiro en `Transfer` ya garantiza corrección.

### 3. `Transfer` refactorizado: todo dentro del UoW

El flujo de `Transfer.execute` corre íntegramente dentro de `uow.transaction(ctx => …)`:

```
a. ctx.lockAccounts([fromId, toId])       -- lock en orden canónico
b. ctx.accounts.findById(fromId/toId)     -- buscar cuentas (post-lock)
c. ctx.transactions.listByAccount(...)    -- historial de cada cuenta
   + deriveBalance(...)                   -- derivar saldos actuales
d. createTransaction + applyTransaction  -- construir y validar (OverdraftError)
e. ctx.transactions.append(tx)           -- persistir
```

Si en el paso (d) `applyTransaction` lanza `OverdraftError`, la excepción sale del callback
del UoW → Kysely hace rollback automático → nada persiste. El test de concurrencia verifica
esto: de dos transferencias simultáneas sobre la misma cuenta con fondos para una sola,
exactamente una tiene éxito y la otra falla con `OverdraftError`, y el saldo final es
consistente (0, sin doble-gasto).

### 4. Saldo derivado dentro de la transacción con lock (estrategia resuelta)

ADR 0008 dejó abierto el trade-off entre saldo derivado (event-sourcing) y saldo
materializado (columna de saldo en `accounts`).

**Decisión para Fase 3b:** saldo derivado **dentro de la transacción con las cuentas
bloqueadas**.

- `ctx.transactions.listByAccount(id)` obtiene el historial de la cuenta **desde la misma
  transacción de DB**, por lo que refleja el estado consistente en el momento del lock.
- `deriveBalance` suma los postings (función pura, helper existente).
- La derivación es O(historial de la cuenta), lo que es aceptable en esta fase dado el
  volumen esperado y la simplicidad que aporta.

**Saldo materializado: considerado y diferido.**
Un saldo materializado (columna `balance` en `accounts` actualizada atómicamente junto con
los postings) reduciría el costo de derivación de O(historial) a O(1). Sin embargo:

- Requiere que cada `append` de una transacción también haga `UPDATE accounts SET balance
  = balance + posting.amount WHERE id = ?`, complejizando el adapter de persistencia.
- Introduce un invariante adicional: columna `balance` debe estar siempre sincronizada con
  los postings. Un bug en el update o una migración mal coordinada puede dejar datos
  inconsistentes.
- La fuente de verdad sería el saldo materializado, no los postings — conflicto con el
  modelo append-only y el principio de auditabilidad.

El saldo materializado se considera una optimización de rendimiento que se implementará
cuando los perfiles de carga lo justifiquen. Se documentará en una futura Fase o ADR
dedicado.

### 5. Mapeo de errores dominio → HTTP en el adapter de entrada

El dominio y la aplicación no conocen códigos HTTP. El adapter HTTP (`error-mapper.ts`)
traduce:

| Error de dominio/aplicación    | HTTP status | Código JSON    |
|--------------------------------|-------------|----------------|
| `AccountAlreadyExistsError`    | 409         | `conflict`     |
| `AccountNotFoundError`         | 404         | `not_found`    |
| `OverdraftError`               | 422         | `overdraft`    |
| cualquier otro                 | 500         | (re-throw)     |

`minor` viaja siempre como `string` en JSON (nunca como `number`) para preservar la
precisión de `bigint` en valores que superan `Number.MAX_SAFE_INTEGER`.

---

## Alternatives Considered

### Locking optimista (versiones / CAS)
Agregar una columna `version` a `accounts` y hacer `UPDATE ... WHERE version = ?`. Si la
fila fue modificada, el `UPDATE` afecta 0 filas → reintentar la transacción. Requiere lógica
de retry en la capa de aplicación y puede producir inanición bajo alta contención. El locking
pesimista es más simple de razonar y correcto por construcción; se prefiere en esta fase.

### Saldo materializado con lock optimista
Similar al punto anterior. Diferido (ver Decisión 4).

### Locking a nivel de aplicación (mutex en Node.js)
Un `Map<accountId, Promise>` de colas por cuenta en memoria. No escala a múltiples instancias
de la app (no distribuido) y agrega complejidad de gestión de estado en la capa HTTP.
Descartado: la DB ya ofrece primitivas de locking robustas y distribuibles.

---

## Consequences

- `Transfer` ya no recibe `AccountRepository` + `TransactionRepository` directamente;
  recibe solo `UnitOfWork`. Tests de unidad que antes inyectaban repos directos ahora
  inyectan `InMemoryUnitOfWork`.
- `CreateAccount` y `GetBalance` no usan UoW: su patrón de acceso no genera condiciones de
  carrera (crear una cuenta es idempotente por construcción; leer un saldo es una lectura
  pura).
- El test de integración de concurrencia (en `test/adapters/postgres/fase-3b.integration.test.ts`)
  es el artefacto verificable de esta decisión: siembra fondos para una sola transferencia,
  dispara dos concurrentes con `Promise.allSettled`, y afirma que exactamente una gana y el
  saldo final es 0 (sin doble-gasto).

---

## Links

- ADR 0005 — Arquitectura hexagonal (fronteras de capa)
- ADR 0007 — Modelo de partida doble (postings con signo)
- ADR 0008 — Capa de aplicación: puertos y casos de uso (trade-off de saldo abierto)
- ADR 0009 — Persistencia: Postgres, Kysely, migraciones (atomicidad de `append`)
