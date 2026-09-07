# 0003 — Runner de tests

## Status

Accepted

## Context

TDD es una práctica central del proyecto. El runner de tests debe soportar ESM y TypeScript nativamente, tener feedback rápido en modo watch, y una API familiar para reducir fricción al escribir tests.

## Decision

Usar **Vitest v3**.

## Consequences

- **Positivo:** Soporte nativo de ESM y TypeScript sin configuración adicional (no requiere ts-jest ni babel). Modo watch optimizado para TDD con HMR. API compatible con Jest: la curva de aprendizaje es mínima. Integración con Vite ecosystem para coverage con V8.
- **Negativo:** Jest sigue siendo el estándar de la industria con mayor base de usuarios y más documentación. Algunas librerías de testing tienen mejor soporte explícito para Jest.
- **Trade-off asumido:** En un proyecto ESM+TS puro, la configuración de Jest con ts-jest o babel es significativamente más compleja. Vitest elimina esa fricción, lo cual es crítico para mantener el ritmo de TDD.
