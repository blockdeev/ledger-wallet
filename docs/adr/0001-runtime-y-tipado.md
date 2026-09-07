# 0001 — Runtime y tipado

## Status

Accepted

## Context

Necesitamos un runtime para el servicio de ledger/wallet que sea estable, ampliamente soportado y con buen soporte de tipado estático. Un motor contable requiere exactitud: los errores de tipo en runtime son costosos.

## Decision

Usar **Node.js LTS** (v22 al momento de escribir) con **TypeScript estricto** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`) y módulos **ESM** (`module: NodeNext`).

## Consequences

- **Positivo:** Los errores de tipo se detectan en compilación, no en producción. ESM es el estándar futuro de Node. El tooling moderno (Vitest, tsx) lo soporta nativamente sin transpilación extra.
- **Negativo:** ESM requiere extensiones `.js` explícitas en los imports, lo que sorprende a desarrolladores acostumbrados a CommonJS. Algunos paquetes legacy del ecosistema siguen siendo CJS-only.
- **Mitigación:** `tsx` para dev/watch; en producción se corre el JS compilado directamente.
