# ADR 0009 — Persistencia: Postgres, Kysely, migraciones y aislamiento de tests

## Status

Accepted (Fase 3a)

---

## Context

La Fase 2 dejó el núcleo funcional operativo sobre adapters in-memory. La Fase 3a introduce
la capa de persistencia real: adapters Postgres detrás de los mismos puertos que ya definió
la Fase 2 (`AccountRepository`, `TransactionRepository`). Las decisiones acá abarcan el
esquema de DB, el mapeo de tipos, las migraciones, el aislamiento de tests y la estrategia de
contrato.

---

## Decisions

### 1. Esquema: ledger append-only

La tabla `postings` es el núcleo del ledger. No hay `UPDATE` ni `DELETE` sobre postings ni
sobre `ledger_transactions`; el ledger crece solo hacia adelante. Esto preserva el audit
trail completo y es coherente con el invariante de dominio (una `LedgerTransaction` es
inmutable una vez creada).

```sql
-- Tablas principales
accounts (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  type TEXT NOT NULL,
  CHECK (type IN ('CUSTOMER_WALLET', 'SYSTEM_CLEARING', 'EXTERNAL'))
)

ledger_transactions (
  id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)

postings (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id TEXT REFERENCES ledger_transactions(id) NOT NULL,
  account_id     TEXT REFERENCES accounts(id) NOT NULL,
  amount         BIGINT NOT NULL,
  currency       TEXT NOT NULL
)

INDEX postings_account_id_idx ON postings(account_id)
```

### 2. Mapeo bigint ↔ BIGINT de Postgres

`Money.minor` es un `bigint` de JS. Postgres almacena el monto como `BIGINT` (`int8`).
El driver `pg` devuelve columnas `int8` como **string** para evitar perder precisión
(`Number.MAX_SAFE_INTEGER` = 2⁵³−1 < 2⁶³−1). El mapper parsea ese string con `BigInt(str)`
y **nunca** lo convierte a `number`. Esto garantiza que montos grandes (p. ej. cuentas de
compensación de alto volumen) no pierden precisión.

### 3. Kysely + migraciones en código (sin FileMigrationProvider)

Se usa el `Migrator` de Kysely con un provider que devuelve un mapa explícito de migraciones:

```typescript
const migrations: Record<string, Migration> = {
  "0001_init": { up, down },
};
```

**Por qué no `FileMigrationProvider`:** en ESM con `.ts` + `tsx`, el import dinámico de
archivos por directorio (el mecanismo que usa `FileMigrationProvider`) requiere resolución
de extensiones y es inconsistente entre entornos (Node + tsx vs. Jest vs. esbuild). Un mapa
explícito en código es determinista, tipado y no depende de la resolución de sistema de
archivos. Cada migración nueva se registra manualmente en `migrations/index.ts`.

### 4. Aislamiento de tests con testcontainers

Cada ejecución de `npm run test:integration` levanta un Postgres 16 efímero con
`@testcontainers/postgresql`. Las migraciones corren contra ese contenedor al inicio
(`beforeAll`). Entre cada test se hace `TRUNCATE ... CASCADE` para garantizar aislamiento.

**Trade-off vs. alternativas:**

| Alternativa | Pro | Contra |
|---|---|---|
| Testcontainers (elegida) | Postgres real; aislado por corrida; sin estado previo | Requiere Docker; ~10–30s de arranque |
| DB compartida/esquema dedicado | Rápido si ya está arriba | Estado acumulado; interferencia entre devs/CI |
| Rollback de transacción | Rápido; sin truncate | No funciona con tests que usan transacciones propias (como `append`, que abre su propia tx) |
| SQLite in-memory | Sin Docker | Dialecto distinto; no valida comportamiento Postgres real |

La elección de testcontainers valida el comportamiento real de Postgres (tipos, CHECK
constraints, FKs, ORDER BY) a costa de necesitar Docker. En CI (`ubuntu-latest`) Docker está
disponible, por lo que el costo es aceptable.

### 5. Contract test como prueba del puerto hexagonal

Se introduce un contract test reutilizable (`test/adapters/contract/`) que define el
comportamiento esperado de cada puerto. Tanto el adapter in-memory como el de Postgres
ejecutan el mismo contrato:

- `runAccountRepositoryContract(makeRepo)` — save, findById, allowsNegativeBalance, overwrite.
- `runTransactionRepositoryContract(makeRepo, opts)` — append, listAll, listByAccount,
  reconstrucción fiel, preservación de bigint, atomicidad de append.

El adapter in-memory corre el contrato en `npm test` (unit, sin Docker). El adapter Postgres
lo corre en `npm run test:integration` (con testcontainers). Si el contrato pasa en ambos,
queda demostrado que Postgres es un drop-in del puerto: la abstracción hexagonal funciona.

El parámetro `opts.testStableOrder` activa el test de orden determinista solo para Postgres
(que garantiza `ORDER BY occurred_at, id`). El adapter in-memory preserva orden de inserción,
que no necesariamente coincide con `occurred_at`.

### 6. Saldo derivado en Fase 3a (decisión derivado vs. materializado diferida)

En Fase 3a el saldo sigue **derivando** del historial de postings, exactamente como en Fase 2
con el helper `deriveBalance`. Esto implica que `Transfer` llama `listAll()` y carga todo el
ledger para derivar el saldo: es ineficiente con un ledger grande.

Esta ineficiencia es **intencional y documentada**; se resuelve en Fase 3b mediante:
- Índices o agregación SQL para derivar el saldo directamente en DB.
- Locking (`SELECT … FOR UPDATE`) para atomicidad de la secuencia read-check-write.
- Posible saldo materializado (decisión que se toma en 3b).

Ver ADR 0008 para el razonamiento completo sobre derivado vs. materializado.

---

## Consequences

**Positivos:**
- Los puertos de Fase 2 no se modificaron: la inversión de dependencias funciona.
- El contract test demuestra la intercambiabilidad de adapters (principio hexagonal).
- El esquema append-only preserva el audit trail completo.
- El mapeo de `bigint` vía `BigInt(str)` es correcto y no pierde precisión.
- Las migraciones en código son deterministas y fáciles de auditar.

**Negativos / Trade-offs:**
- `listAll()` carga todo el ledger por transferencia: O(N) en número de transacciones. Aceptado
  hasta Fase 3b.
- Los tests de integración requieren Docker y son lentos (~30s para arrancar el contenedor).
- Agregar una migración nueva requiere registrarla manualmente en `migrations/index.ts`
  (vs. auto-descubrimiento de `FileMigrationProvider`, que tiene sus propios problemas en ESM).

---

*Decisiones de idempotencia y concurrencia: ver ADR(s) de Fase 3b.*
*Decisiones de observabilidad: ver ADR de Fase 4.*
