# ledger-wallet

Core de un servicio de ledger/wallet (motor contable) construido con arquitectura hexagonal, TDD y TypeScript estricto.

> **Fase 0 — Walking Skeleton:** el proyecto compila, testea, linta, bootea y buildea en Docker. La lógica de dominio se implementa en fases posteriores.

---

## Stack

| Capa          | Tecnología                              |
| ------------- | --------------------------------------- |
| Runtime       | Node.js 22 LTS                          |
| Lenguaje      | TypeScript 5 (strict + ESM)             |
| HTTP adapter  | Fastify 5                               |
| Tests         | Vitest 3                                |
| Query builder | Kysely + PostgreSQL 16                  |
| Linting       | ESLint 9 (typescript-eslint) + Prettier |
| Contenedores  | Docker multi-stage + docker-compose     |
| CI            | GitHub Actions                          |

---

## Cómo correr

### Desarrollo

```bash
# Instalar dependencias
npm ci

# Levantar en modo watch
npm run dev

# En otra terminal: typecheck continuo
npx tsc --noEmit --watch
```

### Tests

```bash
# Run once
npm test

# Watch mode (TDD)
npm run test:watch
```

### Lint y formato

```bash
npm run lint
npm run format
npm run typecheck
```

### Docker

```bash
# Build de la imagen
docker build .

# Levantar app + postgres
docker compose up

# Verificar health
curl http://localhost:3000/health
# {"status":"ok"}
```

---

## Estructura

```
src/
  domain/                 # Entidades y lógica de negocio (Fase 1+)
  application/
    ports/                # Interfaces/contratos del dominio (Fase 1+)
  adapters/
    inbound/http/         # Fastify app + rutas HTTP
    outbound/persistence/ # Repositorios / Kysely (Fase 1+)
  config/                 # Lectura de variables de entorno
  shared/                 # Utilidades compartidas
  main.ts                 # Entry point
test/                     # Tests de integración/e2e
docs/adr/                 # Architecture Decision Records
.github/workflows/        # CI (GitHub Actions)
```

---

## Variables de entorno

Copiar `.env.example` a `.env` y ajustar:

```bash
cp .env.example .env
```

| Variable       | Default | Descripción                       |
| -------------- | ------- | --------------------------------- |
| `PORT`         | `3000`  | Puerto en que escucha el servidor |
| `DATABASE_URL` | —       | Connection string de PostgreSQL   |

---

## Architecture Decision Records

Las decisiones de arquitectura están documentadas en [`docs/adr/`](docs/adr/):

- [0001 — Runtime y tipado](docs/adr/0001-runtime-y-tipado.md)
- [0002 — Framework HTTP](docs/adr/0002-framework-http.md)
- [0003 — Runner de tests](docs/adr/0003-runner-de-tests.md)
- [0004 — Acceso a datos](docs/adr/0004-acceso-a-datos.md)
- [0005 — Arquitectura](docs/adr/0005-arquitectura.md)
