# 0008 — Capa de aplicación: puertos, casos de uso, y derivación de saldo

- **Status**: Accepted
- **Date**: 2025-01-01

---

## Context

La Fase 1 estableció el núcleo de dominio puro (`src/domain/`): modelos inmutables,
invariantes validados en construcción, y lógica contable libre de infraestructura.
Para que ese dominio sea útil, necesitamos orquestar casos de uso concretos: crear cuentas,
transferir fondos, consultar saldos.

La arquitectura hexagonal (ADR 0005) exige que estos casos de uso no dependan directamente
de infraestructura (DB, HTTP, mensajería). La capa de aplicación es la que los implementa,
dependiendo únicamente de abstracciones (puertos).

---

## Decision

### 1. Puertos de salida (Interfaces) — Inversión de Dependencias (DIP)

Los casos de uso dependen de interfaces (`AccountRepository`, `TransactionRepository`),
no de implementaciones concretas. Las implementaciones (adapters) se inyectan por
constructor.

```
CreateAccount(accountRepo: AccountRepository)
Transfer(accountRepo: AccountRepository, txRepo: TransactionRepository)
GetBalance(accountRepo: AccountRepository, txRepo: TransactionRepository)
```

**Por qué constructor injection:** es la forma más simple y explícita de DI sin necesitar
un contenedor IoC. Cada caso de uso declara exactamente sus dependencias en la firma.
Los tests pueden inyectar adapters in-memory sin ningún framework de mocking.

### 2. El saldo se DERIVA del historial, no se guarda como columna mutable

`GetBalance` y `Transfer` calculan el saldo sumando todos los postings de una cuenta
sobre el log de transacciones (`deriveBalance`), en lugar de leer un campo `balance`
actualizado de forma incremental.

**Por qué:**

- **Correctness / auditabilidad:** el saldo es siempre derivable y verificable a partir
  del historial. No hay riesgo de inconsistencia entre el log y una columna mutable
  (que podría desincronizarse por bugs, migraciones, o rollbacks parciales).
- **Ledger semántico:** en contabilidad de doble entrada, el saldo ES la suma del
  historial. Almacenar un saldo por separado sería denormalización.
- **Trade-off aceptado (performance):** para volúmenes grandes, recalcular desde el
  principio es O(N) por consulta. Esto es aceptable para la Fase 2 (in-memory, sin DB).
- **Resolución en Fase 3:** cuando se integre Postgres, se optará por una de estas
  estrategias:
  - **Balance column** actualizada en la misma transacción de DB que el `append`
    (ACID), con el historial como fuente de verdad para auditoría y reconciliación.
  - **Snapshot periódico** más replay desde el último snapshot (CQRS-lite).
  La decisión concreta quedará en ADR 0009.

### 3. Helper puro de derivación — `balance-derivation.ts`

La función `deriveBalance(accountId, account, txs): Money` es una función pura,
sin efectos secundarios, reutilizada por `GetBalance` y `Transfer`. Esto evita
duplicación y garantiza que ambos casos de uso calculen el saldo de la misma manera.

### 4. Adapters in-memory ahora, DB en Fase 3

`InMemoryAccountRepository` e `InMemoryTransactionRepository` implementan los puertos
con estructuras en memoria (Map + array). Esto permite:

- **Testear los casos de uso end-to-end** (aplicación completa, sin mock de dominio)
  sin levantar ninguna base de datos.
- **Validar el diseño de los puertos** antes de comprometerse con una implementación
  de DB, que es costosa de cambiar.
- **CI rápido:** los tests de aplicación corren en milisegundos.

Este es el **payoff central** de la arquitectura hexagonal: los casos de uso son
completamente testeables sin infraestructura real.

### 5. Errores de aplicación separados de errores de dominio

`ApplicationError` → `AccountNotFoundError`, `AccountAlreadyExistsError` representan
fallas a nivel caso de uso (lookup en repositorio, duplicados). Son distintos de
`DomainError` → `OverdraftError`, `UnknownAccountError`, etc., que representan
violaciones de invariantes del modelo contable.

Esta separación permite que las capas superiores (HTTP, mensajería) manejen cada
tipo de error de forma apropiada (ej: 404 vs 409 vs 422).

---

## Consequences

**Positivas:**
- Casos de uso testeables sin DB: tests rápidos, deterministas, sin estado compartido.
- El dominio sigue sin contaminar: `src/application/**` puede importar `src/domain/**`
  pero no al revés. Los adapters tampoco "se cuelan" en la aplicación.
- `deriveBalance` es la única implementación del cálculo de saldo: trivial de auditar.
- Los puertos son contratos explícitos: agregar un adapter de Postgres en Fase 3
  es solo implementar dos interfaces sin tocar casos de uso.

**Negativas / Trade-offs:**
- `deriveBalance` es O(N) sobre el log completo. Aceptable ahora, requiere atención
  en Fase 3 bajo carga real.
- Los adapters in-memory no tienen persistencia real: se pierden al reiniciar. Son
  explícitamente un instrumento de test, no de producción.
- La inyección por constructor requiere que el "compositor" (main, test setup) conozca
  y conecte todas las dependencias manualmente. Sin contenedor IoC esto escala mal con
  muchos casos de uso; se revisará si llega a ser un problema.
