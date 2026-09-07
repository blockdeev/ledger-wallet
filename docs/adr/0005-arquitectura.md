# 0005 — Arquitectura

## Status

Accepted

## Context

Necesitamos una arquitectura que proteja el dominio de dependencias de infraestructura, facilite el testing unitario, y sea sostenible a medida que el servicio crece. El riesgo es elegir algo demasiado ceremonioso para el tamaño actual, o demasiado plano para las necesidades futuras.

## Decision

Usar **arquitectura hexagonal pragmática** (Ports & Adapters), un único bounded context, con la regla de dependencia apuntando siempre hacia el dominio.

Estructura:

- `domain/`: entidades y lógica de negocio pura, sin dependencias externas.
- `application/ports/`: interfaces (contratos) que el dominio expone o requiere.
- `adapters/inbound/`: drivers (HTTP, CLI, workers) que invocan casos de uso.
- `adapters/outbound/`: driven adapters (repositorios, clientes externos) que implementan los ports.

## Consequences

- **Positivo:** El dominio es testeable en aislamiento. Los adapters son intercambiables (ej. cambiar Fastify por otro framework no toca el dominio). La regla de dependencia explícita previene el anti-patrón de importar Fastify o Kysely desde el dominio.
- **Negativo vs layered plano:** Más carpetas y más indirección que un enfoque MVC clásico. Requiere disciplina del equipo para no hacer imports cruzados.
- **Negativo vs Clean Architecture completa:** Menos ceremonioso: no tiene Use Case classes explícitas ni DTOs de capa de presentación formales en Fase 0. Se añaden cuando el dominio lo justifique.
- **Trade-off asumido:** El costo de la estructura hexagonal es bajo comparado con el beneficio de tener el dominio protegido desde el día 1, especialmente para un motor contable donde la lógica de negocio es el activo más valioso.
