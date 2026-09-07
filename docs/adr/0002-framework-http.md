# 0002 — Framework HTTP

## Status

Accepted

## Context

El servicio expone una API HTTP. Necesitamos un framework que tenga soporte TypeScript de primera clase, validación de schemas integrada, y buen rendimiento. En arquitectura hexagonal, el framework HTTP es un _adapter de entrada_ intercambiable.

## Decision

Usar **Fastify v5**.

## Consequences

- **Positivo:** TypeScript first-class (tipos para rutas y schemas). Validación vía JSON Schema integrada. Rendimiento superior a Express en benchmarks. Plugin ecosystem maduro. Separación clara entre app (instancia Fastify) y bootstrap (main.ts) facilita tests con `app.inject()` sin levantar un puerto real.
- **Negativo:** Express tiene mayor ubicuidad y más recursos en comunidad; algunos devs tienen más experiencia con él. Fastify v5 introdujo cambios breaking respecto a v4.
- **Trade-off asumido:** La curva de aprendizaje de Fastify es menor que el costo de trabajar sin tipos en Express. Como adapter, puede reemplazarse sin tocar el dominio.
