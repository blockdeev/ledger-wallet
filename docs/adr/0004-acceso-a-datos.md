# 0004 — Acceso a datos

## Status

Accepted

## Context

El servicio es un motor contable (ledger): integridad de datos, transacciones ACID y constraints a nivel base son no-negociables. Necesitamos acceso a datos type-safe que no filtre abstracciones de infraestructura hacia el dominio.

## Decision

Usar **Kysely** como query builder type-safe, con **PostgreSQL 16** como base de datos.

## Consequences

- **Positivo:** Kysely provee type-safety completa sobre las queries SQL sin ser un ORM pesado. Al vivir exclusivamente en los repository adapters (capa de infraestructura), no contamina el dominio con conceptos de persistencia. PostgreSQL es battle-tested para workloads financieros: ACID, constraints, transacciones serializables, `NUMERIC` para valores monetarios.
- **Negativo:** Kysely requiere definir los tipos de las tablas manualmente (o generarlos). No tiene migrations propias: se integra con herramientas externas (ej. Kysely Migrate, Liquibase).
- **Trade-off asumido:** Un ORM como Prisma o TypeORM facilitaría el scaffolding inicial pero introduce acoplamiento entre el modelo de datos y el dominio que es difícil de deshacer. Para un ledger, el control explícito sobre SQL compensa el overhead.
